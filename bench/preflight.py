"""Exercise the built plugin in real DSH and grade a reference chart, without LLM calls."""

import json, os, shutil, subprocess, uuid
from pathlib import Path
from common import ROOT, runtime, write_json
from config import patch_for
from evaluate import evaluate


def main():
    cfg = runtime()
    output = ROOT / ".local/runs" / ("preflight-" + uuid.uuid4().hex[:8])
    results = []
    for arm in ["full", "selective"]:
        folder = output / arm
        work = folder / "data"
        shutil.copytree(ROOT / ".local/datasets/market-chart-report", work)
        patch = patch_for({"id": "preflight"}, arm, work, folder, offline=True)
        entries = next(r["insert"] for r in patch if "insert" in r)
        entries.append(
            {
                "id": "preflight",
                "name": str(ROOT / "bench/smoke.mjs"),
                "config": {
                    "arm": arm,
                    "work": str(work),
                    "reference": str(ROOT / "bench/reference-chart.js"),
                    "evidence": str(folder / "evidence.json"),
                    "forbidden": str(ROOT / ".local/dataset-source.json"),
                },
            }
        )
        write_json(folder / "config.json", patch)
        env = {
            "HOME": str(Path.home()),
            "LANG": "C.UTF-8",
            "DSH_HOME": cfg["harnessHome"],
            "DSH_TOOLS_MODE": "ptc",
            "DSH_TELEMETRY_DISABLED": "1",
            "PATH": str(Path(cfg["node"]).parent) + ":/usr/bin:/bin",
        }
        with (
            (folder / "stdout.log").open("w") as out,
            (folder / "stderr.log").open("w") as err,
        ):
            r = subprocess.run(
                [
                    cfg["node"],
                    str(Path(cfg["source"]) / "apps/cli/lib/bin.js"),
                    "--profile",
                    "benchmark",
                    "--patch",
                    str(folder / "config.json"),
                ],
                cwd=work,
                env=env,
                stdout=out,
                stderr=err,
                timeout=120,
            )
        if r.returncode:
            raise RuntimeError(
                "Preflight failed; inspect " + str(folder / "stderr.log")
            )
        result = json.loads((folder / "evidence.json").read_text())
        result["grading"] = evaluate("market-chart-report", work)
        assert result["grading"]["passed"]
        assert not json.loads((folder / "policy-trace.json").read_text())["calls"]
        results.append(result)
        print(
            json.dumps(
                {
                    "arm": arm,
                    "modelCalls": 0,
                    "tools": result["tools"],
                    "sdkBytes": result["sdkBytes"],
                    "passed": True,
                }
            ),
            flush=True,
        )
    write_json(ROOT / ".local/preflight.json", results)


if __name__ == "__main__":
    main()
