import json
import sys
from pathlib import Path
from common import ROOT, runtime


def patch_for(task, arm, work, folder, remaining=19, offline=False):
    if not offline and remaining < 1.5:
        raise ValueError("A complete attempt requires a 1.5 CNY allowance")
    cfg = runtime()
    schemas = json.loads((ROOT / "bench/tools.json").read_text())["tools"]
    entries = [
        {
            "id": "benchmark-mcp-" + server,
            "name": str(ROOT / "lib/mcp-client-documented.mjs"),
            "config": {
                "serverName": server,
                "transport": "stdio",
                "command": sys.executable,
                "args": [str(ROOT / "bench/sandbox.py"), server, str(work)],
                "cwd": str(work),
                "env": {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
                "toolCallTimeoutMs": 90000,
                "failOnStartupError": True,
            },
        }
        for server in ["filesystem", "excel", "pdf", "memory"]
    ]
    entries += [
        {
            "id": "benchmark-policy",
            "name": str(ROOT / "bench/policy.mjs"),
            "config": {
                "taskId": task["id"],
                "arm": arm,
                "allowedTools": [t["name"] for t in schemas] + ["tool_help"],
                "dataDirectory": str(work),
                "tracePath": str(folder / "policy-trace.json"),
                "maxModelCalls": 80,
                "maxToolCalls": 400,
                "maxCostPeakCny": 1.5,
                "maxInputBytes": 400000,
            },
        },
        {
            "id": "benchmark-sdk",
            "name": str(ROOT / "lib/tool-docs.mjs"),
            "config": {
                **json.loads((ROOT / "bench/docs-config.json").read_text()),
                "presentation": arm,
            },
        },
    ]
    return [
        {
            "id": "agent-default-model",
            "config": {
                "provider": "deepseek-official",
                "model": "deepseek-flash",
                "reasoningEffort": "high",
            },
        },
        {
            "id": "llm-deepseek",
            "config": {
                "reasoningEffort": "high",
                "maxTokens": 65536,
                "retryPolicy": {"mode": "normal", "maxRetries": 0},
            },
        },
        {"id": "session-title-llm", "disabled": True},
        {"id": "session-telemetry-otel", "disabled": True},
        {"id": "spill-policy", "config": {"maxInlineTokens": 12500}},
        {
            "id": "spill-local",
            "config": {"root": str(work / ".cache/dsh-spill"), "cleanupPeriodDays": 0},
        },
        *(
            [
                {"id": "headless-startup", "disabled": True},
                {"id": "headless-runner", "disabled": True},
            ]
            if offline
            else []
        ),
        {"insert": entries},
        {
            "id": "sandbox",
            "config": {
                "runnerCommand": [
                    sys.executable,
                    str(ROOT / "bench/sandbox.py"),
                    "ptc",
                    str(work),
                ],
                "runnerFailureSignatures": ["benchmark-sandbox:", "bwrap:"],
            },
        },
    ]
