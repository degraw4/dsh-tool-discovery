"""Prepare ignored, local benchmark dependencies. Does not call a model."""

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path
from common import ROOT, write_json
from prepare import prepare


def run(args, **kwargs):
    subprocess.run([str(x) for x in args], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--toolathlon", type=Path)
    args = parser.parse_args()
    cfg = json.loads((ROOT / ".local/runtime.json").read_text())
    uv = shutil.which("uv")
    bwrap = shutil.which("bwrap")
    if not uv or not bwrap:
        raise RuntimeError(
            "Linux reference evaluation requires uv and bubblewrap on PATH"
        )
    source = prepare(args.toolathlon)
    envs = {}
    for name in ["excel", "eval"]:
        directory = ROOT / ".local" / ("python-" + name)
        if not directory.exists():
            run([uv, "venv", "--python", "3.13", directory])
        python = directory / "bin/python"
        # uv may use a home-directory alias in this link. Mount the canonical
        # interpreter path in the isolated subprocess, without mounting home.
        if python.is_symlink():
            interpreter = python.resolve()
            python.unlink()
            python.symlink_to(interpreter)
        run(
            [
                uv,
                "pip",
                "sync",
                "--python",
                python,
                ROOT / "bench" / ("requirements-" + name + ".txt"),
            ]
        )
        base = subprocess.check_output(
            [str(python), "-c", "import sys;print(sys.base_prefix)"], text=True
        ).strip()
        envs[name] = {"directory": str(directory), "python": str(python), "base": base}
    packages = json.loads((ROOT / "bench/node-servers.json").read_text())
    node_modules = ROOT / ".local/mcp-node"
    npm = Path(cfg["node"]).parent / "npm"
    env = dict(os.environ)
    env["PATH"] = str(Path(cfg["node"]).parent) + ":" + env.get("PATH", "")
    write_json(
        node_modules / "package.json",
        {
            "private": True,
            "dependencies": {v["name"]: v["version"] for v in packages.values()},
        },
    )
    shutil.copyfile(
        ROOT / "bench/node-package-lock.json", node_modules / "package-lock.json"
    )
    run([npm, "ci", "--prefix", node_modules, "--no-audit", "--no-fund"], env=env)
    overlay = ROOT / ".local/excel-overlay"
    if overlay.exists():
        shutil.rmtree(overlay)
    package = subprocess.check_output(
        [
            envs["excel"]["python"],
            "-c",
            "import excel_mcp;print(next(iter(excel_mcp.__path__)))",
        ],
        text=True,
    ).strip()
    shutil.copytree(
        package, overlay / "excel_mcp", ignore=shutil.ignore_patterns("__pycache__")
    )
    run(
        [
            "patch",
            "--batch",
            "-p1",
            "-d",
            overlay,
            "-i",
            ROOT / "patches/excel-inspection.patch",
        ]
    )
    home = ROOT / ".local/harness-home"
    profile = home / "profiles/benchmark"
    profile.mkdir(parents=True, exist_ok=True)
    write_json(
        profile / "package.json",
        {
            "name": "dsh-profile-benchmark",
            "private": True,
            "dependencies": {},
            "dsh": {
                "profile": {
                    "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless"]
                }
            },
        },
    )
    (profile / "cordis.patch.yml").write_text("[]\n")
    write_json(
        ROOT / ".local/bench-runtime.json",
        {
            **cfg,
            "toolathlon": str(source),
            "bwrap": str(Path(bwrap).resolve()),
            "harnessHome": str(home),
            "pythonExcel": envs["excel"],
            "pythonEval": envs["eval"],
            "excelOverlay": str(overlay),
            "mcpNodeRoot": str(node_modules),
            "filesystemEntry": str(
                node_modules
                / "node_modules/@modelcontextprotocol/server-filesystem/dist/index.js"
            ),
            "memoryEntry": str(
                node_modules
                / "node_modules/@modelcontextprotocol/server-memory/dist/index.js"
            ),
        },
    )
    print("Benchmark runtime ready; no model calls made")


if __name__ == "__main__":
    main()
