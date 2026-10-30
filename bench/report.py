"""Recompute first-success and complete-attempt accounting; no API calls."""

import argparse
import json
from decimal import Decimal
from pathlib import Path
from common import ROOT, write_json

FIELDS = ("inputTokens", "cacheReadTokens", "cacheWriteTokens", "outputTokens")
ARMS = ("full", "selective")


def validate_usage(usage):
    for field in FIELDS:
        value = usage.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("Invalid token count: " + field)
    if usage.get("unknownCalls", 0) != 0:
        raise ValueError("Unknown usage; complete accounting is unavailable")


def summarize(rows):
    out = {}
    for arm in ["full", "selective"]:
        r = [x for x in rows if x["arm"] == arm]
        u = {
            k: sum(x["usage"][k] for x in r)
            for k in [
                "inputTokens",
                "cacheReadTokens",
                "cacheWriteTokens",
                "outputTokens",
            ]
        }
        fee = (
            Decimal(2) * u["inputTokens"]
            + Decimal(".04") * u["cacheReadTokens"]
            + Decimal(2) * u["cacheWriteTokens"]
            + Decimal(8) * u["outputTokens"]
        ) / 1000000
        out[arm] = {
            "runs": len(r),
            "passed": sum(x["passed"] for x in r),
            "modelCalls": sum(x["modelCalls"] for x in r),
            "durationMs": sum(x["durationMs"] for x in r),
            "costCny": str(fee),
            "usage": u,
        }
    return out


def analyze(rows, repeats):
    if not rows or repeats < 1:
        raise ValueError("Records and positive repeats are required")
    tasks = sorted({r["taskId"] for r in rows})
    slots, ids = {}, set()
    for r in rows:
        validate_usage(r["usage"])
        if r["runId"] in ids or r["arm"] not in ARMS:
            raise ValueError("Duplicate run ID or invalid strategy")
        ids.add(r["runId"])
        if r["passed"] and r["state"] != "completed":
            raise ValueError("A successful execution must complete normally")
        ordinal = r.get("attempt", 1)
        if isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 1:
            raise ValueError("Invalid attempt ordinal")
        key = (r["taskId"], r["arm"], r["repeat"])
        attempts = slots.setdefault(key, {})
        if ordinal in attempts:
            raise ValueError("Duplicate attempt in a task slot")
        attempts[ordinal] = r
    expected = {(task, arm, repeat) for task in tasks for arm in ARMS for repeat in range(1, repeats + 1)}
    if set(slots) != expected:
        raise ValueError("Incomplete paired task schedule")
    selected, initial, unresolved = [], [], []
    for key, attempts in sorted(slots.items()):
        if sorted(attempts) != list(range(1, len(attempts) + 1)):
            raise ValueError("Missing earlier attempt record")
        initial.append(attempts[1])
        successful = next((attempts[i] for i in sorted(attempts) if attempts[i]["passed"]), None)
        if successful is None:
            unresolved.append({"taskId": key[0], "arm": key[1], "repeat": key[2]})
        else:
            selected.append(successful)
    return {
        "successfulExecutions": summarize(selected),
        "initialAttempts": summarize(initial),
        "allAttempts": summarize(rows),
        "selection": {"rule": "first normally completed and grader-passing attempt per task, strategy and repeat",
                      "complete": not unresolved, "selectedCount": len(selected), "recordedCount": len(rows),
                      "runIds": [r["runId"] for r in selected], "unresolved": unresolved},
        "byTask": {
            task: {
                "successfulExecutions": summarize([r for r in selected if r["taskId"] == task]),
                "initialAttempts": summarize([r for r in initial if r["taskId"] == task]),
                "allAttempts": summarize([r for r in rows if r["taskId"] == task]),
            }
            for task in tasks
        },
    }


def check_requests(rows, requests):
    indexed = {r["runId"]: [] for r in rows}
    for request in requests:
        if request["runId"] not in indexed:
            raise ValueError("Request does not belong to a recorded attempt")
        validate_usage(request["usage"])
        indexed[request["runId"]].append(request)
    for row in rows:
        calls = indexed[row["runId"]]
        if sorted(c["step"] for c in calls) != list(range(1, row["modelCalls"] + 1)):
            raise ValueError("Missing or duplicate request ordinal")
        for field in FIELDS:
            if sum(c["usage"][field] for c in calls) != row["usage"][field]:
                raise ValueError("Request usage does not match attempt usage")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--runs", type=Path, default=ROOT / "results/runs.json")
    p.add_argument("--repeats", type=int, default=10)
    p.add_argument("--output", type=Path)
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    rows = json.loads(args.runs.read_text())
    result = analyze(rows, args.repeats)
    if args.check:
        assert result == json.loads((ROOT / "results/summary.json").read_text()), (
            "Recorded summary differs"
        )
        requests = [
            json.loads(x)
            for x in (ROOT / "results/requests.jsonl").read_text().split("\n")
            if x
        ]
        check_requests(rows, requests)
        print(f"Accounting verified: {len(rows)} attempts, {len(requests)} requests, {result['selection']['selectedCount']} first-success executions")
    elif args.output:
        write_json(args.output, result)
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
