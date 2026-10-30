"""Reference paired runner. Paid calls require --execute and an explicit budget."""

import argparse, contextlib, fcntl, hashlib, json, math, os, shutil, signal, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
from common import ROOT, runtime, tasks, write_json, digest
from config import patch_for

TOKEN_FIELDS = ("inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens")
POLICY_LIMITS = (
    "MCP_ATLAS_MODEL_CALL_CEILING",
    "MCP_ATLAS_COST_CEILING",
    "MCP_ATLAS_INPUT_CEILING",
)
PROXY_FIELDS = (
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
)
BATCH_PEAK_CNY = 0


def usage_of(trace):
    calls = trace.get("calls", [])
    return {
        **{
            k: sum(c["usage"].get(k, 0) for c in calls if c.get("usage"))
            for k in TOKEN_FIELDS
        },
        "knownCalls": sum(c.get("usage") is not None for c in calls),
        "unknownCalls": sum(c.get("usage") is None for c in calls),
    }


def now():
    return datetime.now(timezone.utc).isoformat()


def run_id(job):
    return f"{job['taskId']}-{job['arm']}-r{job['repeat']}"


@contextlib.contextmanager
def batch_lock(output):
    """A persistent sibling lock protects planning, resume and the entire run."""
    output.parent.mkdir(parents=True, exist_ok=True)
    lock_path = output.parent / ("." + output.name + ".lock")
    with lock_path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("Another controller owns this batch") from exc
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def validate_token_usage(usage):
    if not isinstance(usage, dict):
        raise ValueError("Missing request usage")
    for field in TOKEN_FIELDS:
        value = usage.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("Missing or invalid token field: " + field)
        if not math.isfinite(value) or value < 0 or int(value) != value:
            raise ValueError("Invalid token count: " + field)


def peak_cost(usage):
    validate_token_usage(usage)
    return (
        2 * usage["inputTokens"]
        + 0.04 * usage["cacheReadTokens"]
        + 2 * usage["cacheWriteTokens"]
        + 8 * usage["outputTokens"]
    ) / 1e6


def account_usage(trace):
    calls = trace.get("calls", [])
    if not calls:
        raise ValueError("No model request usage; budget is unknown")
    for call in calls:
        validate_token_usage(call.get("usage"))
    usage = usage_of(trace)
    return usage, peak_cost(usage)


def trace_stop_reason(trace):
    """An unfinished request may have no usage; a settled one may not."""
    for call in trace.get("calls", []):
        if call.get("usage") is not None:
            try:
                validate_token_usage(call["usage"])
            except ValueError:
                return "Invalid request usage; stop for inspection"
        elif "elapsedMs" in call:
            return "Settled request has no usage; stop for inspection"
    return None


def budget_allows(cost):
    return math.isfinite(cost) and 0 <= cost and cost + 1.5 <= BATCH_PEAK_CNY


def validate_resume(output, manifest, progress, current_sources, expected_jobs):
    if manifest.get("sources") != current_sources:
        raise ValueError("Frozen inputs changed; refuse to mix versions")
    jobs = progress.get("jobs", [])
    identity = lambda job: (job["taskId"], job["arm"], job["repeat"])
    identities = [identity(job) for job in jobs]
    if identities != [identity(job) for job in expected_jobs] or len(
        set(identities)
    ) != len(identities):
        raise ValueError("Job schedule changed or contains duplicates")
    total = 0.0
    sessions = set()
    for job in jobs:
        status = job["status"]
        if status == "pending":
            if "runId" in job or (output / "runs" / run_id(job)).exists():
                raise ValueError(
                    "Pending job has prior artifacts; inspect before resuming"
                )
            continue
        if status in {"running", "infrastructure_failure"}:
            raise ValueError(
                "Ambiguous or infrastructure-failed attempt requires inspection"
            )
        if status not in {"completed", "task_failure", "timeout", "budget_exhausted"}:
            raise ValueError("Unrecognized job state")
        if job.get("runId") != run_id(job):
            raise ValueError("Run ID does not match scheduled task")
        folder = output / "runs" / job["runId"]
        result_path = folder / "result.json"
        if not result_path.is_file() or digest(result_path) != job.get("resultSha256"):
            raise ValueError("Completed result is absent or its hash changed")
        result = json.loads(result_path.read_text())
        if identity(result) != identity(job) or result.get("state") != status:
            raise ValueError("Result does not match scheduled task or status")
        usage = result["usage"]
        if usage.get("unknownCalls") != 0 or usage.get("knownCalls", 0) < 1:
            raise ValueError("Completed result has incomplete usage")
        if usage["knownCalls"] != result["modelCalls"]:
            raise ValueError("Usage count does not match requests")
        cost = peak_cost(usage)
        saved_cost = result.get("estimatedPeakCny")
        if not isinstance(saved_cost, (int, float)) or not math.isclose(
            saved_cost, cost, abs_tol=1e-12
        ):
            raise ValueError("Saved budget differs from usage")
        for relative, expected in result.get("evidenceHashes", {}).items():
            path = folder / relative
            if (
                not path.resolve().is_relative_to(folder.resolve())
                or not path.is_file()
                or digest(path) != expected
            ):
                raise ValueError("Archived evidence changed or is missing")
        session_id = (result.get("sessionMetrics") or {}).get("sessionId")
        if session_id:
            if session_id in sessions:
                raise ValueError("Two runs reused the same Session")
            sessions.add(session_id)
        total += cost
    return total


def read_events(path):
    events = []
    for line in path.read_text().split("\n"):
        try:
            events.append(json.loads(line))
        except ValueError:
            pass
    return events


def terminate(process):
    if process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run_process(command, work, env, folder):
    started = time.monotonic()
    timed_out, stop_reason = False, None
    with (
        (folder / "stdout.jsonl").open("w") as stdout,
        (folder / "stderr.log").open("w") as stderr,
    ):
        process = subprocess.Popen(
            command,
            cwd=work,
            env=env,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
        try:
            while process.poll() is None:
                if time.monotonic() - started >= 1800:
                    timed_out = True
                    terminate(process)
                    break
                trace_path = folder / "policy-trace.json"
                if trace_path.exists():
                    stop_reason = trace_stop_reason(json.loads(trace_path.read_text()))
                    if stop_reason:
                        terminate(process)
                        break
                time.sleep(0.25)
        except BaseException:
            terminate(process)
            raise
    return (
        process.returncode,
        timed_out,
        stop_reason,
        round((time.monotonic() - started) * 1000),
    )


def configure_egress():
    # Scoped to this experiment process; keep all other destinations unchanged.
    for name in ("no_proxy", "NO_PROXY"):
        items = [
            item.strip() for item in os.environ.get(name, "").split(",") if item.strip()
        ]
        if "api.deepseek.com" not in items:
            items.append("api.deepseek.com")
        os.environ[name] = ",".join(items)


def source_hashes(cfg):
    paths = []
    for name in ["src", "lib", "bench", "patches", "scripts"]:
        paths.extend(
            p
            for p in (ROOT / name).rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        )
    paths.extend(p for p in (ROOT / ".local/datasets").rglob("*") if p.is_file())
    paths.extend(
        [ROOT / ".local/bench-runtime.json", ROOT / "package.json", Path(cfg["node"])]
    )
    for relative in [
        "apps/cli/lib/bin.js",
        "packages/core/agent-loop/lib/index.js",
        "packages/core/tools/lib/index.js",
    ]:
        paths.append(Path(cfg["source"]) / relative)
    return {str(p): digest(p) for p in sorted(set(paths))}


def make_jobs(task_ids, repeats):
    return [
        {"taskId": task, "arm": arm, "repeat": repeat, "status": "pending"}
        for repeat in range(1, repeats + 1)
        for index, task in enumerate(task_ids)
        for arm in (
            ["full", "selective"] if (repeat + index) % 2 else ["selective", "full"]
        )
    ]


def perform(job, task, index, folder, batch, cfg, remaining):
    work = batch / "workspaces" / run_id(job) / "data"
    shutil.copytree(ROOT / ".local/datasets" / task["id"], work)
    patch = folder / "config.patch.json"
    write_json(patch, patch_for(task, job["arm"], work, folder, remaining))
    key = os.environ.get("DEEPSEEK_API_KEY_" + job["arm"].upper()) or os.environ.get(
        "DEEPSEEK_API_KEY"
    )
    if not key:
        raise RuntimeError(
            "Set DEEPSEEK_API_KEY or a per-arm DEEPSEEK_API_KEY_FULL / DEEPSEEK_API_KEY_SELECTIVE"
        )
    env = {
        "HOME": str(Path.home()),
        "LANG": "C.UTF-8",
        "DSH_HOME": cfg["harnessHome"],
        "DSH_TOOLS_MODE": "ptc",
        "DSH_TELEMETRY_DISABLED": "1",
        "PATH": str(Path(cfg["node"]).parent) + ":/usr/bin:/bin",
    }
    env.update({k: os.environ[k] for k in PROXY_FIELDS if k in os.environ})
    env["DEEPSEEK_API_KEY"] = key
    command = [
        cfg["node"],
        str(Path(cfg["source"]) / "apps/cli/lib/bin.js"),
        "--profile",
        "benchmark",
        "--patch",
        str(patch),
        "--json",
        task["prompt"],
    ]
    write_json(
        folder / "execution.json",
        {
            "command": command,
            "cwd": str(work),
            "patchSha256": digest(patch),
            "inputHashes": {
                str(p.relative_to(work)): digest(p)
                for p in work.rglob("*")
                if p.is_file()
            },
        },
    )
    code, timeout, stop, duration = run_process(command, work, env, folder)
    events = read_events(folder / "stdout.jsonl")
    session = next((x["sessionId"] for x in events if x.get("type") == "session"), None)
    terminal = next(
        (x.get("reason") for x in reversed(events) if x.get("phase") == "turn_end"),
        None,
    )
    trace = (
        json.loads((folder / "policy-trace.json").read_text())
        if (folder / "policy-trace.json").exists()
        else {"calls": [], "tools": []}
    )
    issues = []
    estimated = None
    usage = usage_of(trace)
    try:
        usage, estimated = account_usage(trace)
    except ValueError as error:
        issues.append(str(error))
    if stop:
        issues.append(stop)
    if any(c.get("error") for c in trace["calls"]):
        issues.append("Provider failure; inspect preserved attempt")
    state = (
        "timeout"
        if timeout
        else "budget_exhausted"
        if any(s in json.dumps(terminal) for s in POLICY_LIMITS)
        else "completed"
        if code == 0 and terminal == {"kind": "completed"}
        else "task_failure"
    )
    if session is None or terminal is None:
        issues.append("Missing Session identity or terminal event")
    try:
        from evaluate import evaluate

        evaluation = evaluate(task["id"], work)
    except Exception as error:
        evaluation = {
            "passed": False,
            "error": type(error).__name__ + ": " + str(error),
        }
        issues.append("Unexpected evaluator error")
    if issues:
        state = "infrastructure_failure"
    artifacts = folder / "artifacts"
    artifacts.mkdir()
    for path in work.rglob("*"):
        rel = path.relative_to(work)
        if rel.parts[0] in [".cache", ".pdf_tools_tempfiles"]:
            continue
        if path.is_symlink():
            raise ValueError("Artifact symlinks are not supported")
        if path.is_file():
            target = artifacts / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    result = {
        **job,
        "runId": run_id(job),
        "state": state,
        "passed": state == "completed" and bool(evaluation["passed"]),
        "exitCode": code,
        "terminalReason": terminal,
        "durationMs": duration,
        "usage": usage,
        "modelCalls": len(trace["calls"]),
        "helpCalls": sum(t["name"] == "tool_help" for t in trace["tools"]),
        "estimatedPeakCny": estimated,
        "evaluation": evaluation,
        "sessionMetrics": {"sessionId": session},
        "infrastructureIssues": issues,
    }
    result["evidenceHashes"] = {
        str(p.relative_to(folder)): digest(p) for p in folder.rglob("*") if p.is_file()
    }
    write_json(folder / "result.json", result)
    return result


def main():
    global BATCH_PEAK_CNY
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--max-cost-cny", type=float)
    parser.add_argument("--resume", type=Path)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("repeats must be positive")
    if args.execute and (
        args.max_cost_cny is None
        or not math.isfinite(args.max_cost_cny)
        or args.max_cost_cny < 3.5
    ):
        parser.error(
            "--execute requires at least 3.5 CNY: a complete 1.5 CNY attempt and a 2 CNY in-flight reserve"
        )
    cfg = runtime()
    selected = tasks()
    jobs = make_jobs([x["id"] for x in selected], args.repeats)
    if not args.execute:
        print(
            json.dumps(
                {
                    "jobs": len(jobs),
                    "execute": False,
                    "tasks": [x["id"] for x in selected],
                }
            )
        )
        return
    configure_egress()
    BATCH_PEAK_CNY = args.max_cost_cny - 2
    output = (
        args.resume.resolve()
        if args.resume
        else ROOT
        / ".local/runs"
        / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    )
    if not output.is_relative_to((ROOT / ".local/runs").resolve()):
        raise ValueError("Output must stay under .local/runs")
    with batch_lock(output):
        current = source_hashes(cfg)
        if args.resume:
            manifest = json.loads((output / "manifest.json").read_text())
            progress = json.loads((output / "progress.json").read_text())
            if (
                manifest["repeats"] != args.repeats
                or manifest["maxCostCny"] != args.max_cost_cny
            ):
                raise ValueError("Resume settings changed")
        else:
            output.mkdir(parents=True, exist_ok=False)
            manifest = {
                "sources": current,
                "repeats": args.repeats,
                "tasks": [t["id"] for t in selected],
                "maxCostCny": args.max_cost_cny,
                "createdAt": now(),
            }
            progress = {"status": "planned", "jobs": jobs}
            write_json(output / "manifest.json", manifest)
            write_json(output / "progress.json", progress)
        spent = validate_resume(output, manifest, progress, current, jobs)
        for index, job in enumerate(progress["jobs"]):
            if job["status"] != "pending":
                continue
            if not budget_allows(spent):
                progress["status"] = "budget_stopped"
                break
            if source_hashes(cfg) != manifest["sources"]:
                raise RuntimeError("Frozen sources changed")
            folder = output / "runs" / run_id(job)
            folder.mkdir(parents=True, exist_ok=False)
            job.update(runId=run_id(job), status="running")
            progress["status"] = "running"
            write_json(output / "progress.json", progress)
            result = perform(
                job,
                next(t for t in selected if t["id"] == job["taskId"]),
                index,
                folder,
                output,
                cfg,
                1.5,
            )
            job.update(
                status=result["state"], resultSha256=digest(folder / "result.json")
            )
            write_json(output / "progress.json", progress)
            print(
                json.dumps(
                    {
                        "runId": job["runId"],
                        "state": result["state"],
                        "passed": result["passed"],
                        "estimatedPeakCny": result["estimatedPeakCny"],
                    }
                ),
                flush=True,
            )
            if result["state"] == "infrastructure_failure":
                progress["status"] = "halted"
                break
            spent += result["estimatedPeakCny"]
        else:
            progress["status"] = "completed"
        records = [
            json.loads((output / "runs" / j["runId"] / "result.json").read_text())
            for j in progress["jobs"]
            if "resultSha256" in j
        ]
        observed = sum(peak_cost(r["usage"]) for r in records)
        progress["knownRecordedCostCny"] = observed
        progress["unknownUsageRequests"] = sum(
            r["usage"]["unknownCalls"] for r in records
        )
        write_json(output / "progress.json", progress)
        write_json(output / "runs.json", records)
        print(
            json.dumps(
                {
                    "status": progress["status"],
                    "output": str(output),
                    "knownCostCny": observed,
                    "unknownUsageRequests": progress["unknownUsageRequests"],
                }
            )
        )


if __name__ == "__main__":
    main()
