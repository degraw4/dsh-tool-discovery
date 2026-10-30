"""Fetch or verify only the pinned upstream task material needed for this benchmark."""

import argparse
import json
import shutil
import subprocess
from pathlib import Path
from common import ROOT, TOOLATHLON_REVISION, digest, write_json


def prepare(source=None):
    if source is None:
        source = ROOT / ".local/toolathlon"
        if not source.exists():
            subprocess.run(
                [
                    "git",
                    "clone",
                    "--filter=blob:none",
                    "--no-checkout",
                    "https://github.com/hkust-nlp/Toolathlon.git",
                    str(source),
                ],
                check=True,
            )
            subprocess.run(
                ["git", "sparse-checkout", "init", "--cone"], cwd=source, check=True
            )
            subprocess.run(
                [
                    "git",
                    "sparse-checkout",
                    "set",
                    "tasks/finalpool/excel-market-research",
                    "tasks/finalpool/excel-data-transformation",
                ],
                cwd=source,
                check=True,
            )
            subprocess.run(
                ["git", "checkout", "--detach", TOOLATHLON_REVISION],
                cwd=source,
                check=True,
            )
    source = Path(source).resolve()
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=source, text=True
    ).strip()
    if head != TOOLATHLON_REVISION:
        raise ValueError("Toolathlon revision mismatch")
    manifest = json.loads((ROOT / "bench/dataset-manifest.json").read_text())
    for name, expected in manifest["files"].items():
        if digest(source / name) != expected:
            raise ValueError("Dataset file mismatch: " + name)
    output = ROOT / ".local/datasets"
    for task in json.loads((ROOT / "bench/tasks.json").read_text())["tasks"]:
        target = output / task["id"]
        if target.exists():
            expected = (
                source / "tasks/finalpool" / task["inputTask"] / "initial_workspace"
            )
            if {p.name: digest(p) for p in target.iterdir() if p.is_file()} != {
                p.name: digest(p) for p in expected.iterdir() if p.is_file()
            }:
                raise ValueError("Prepared task data changed; use a fresh checkout")
            continue
        shutil.copytree(
            source / "tasks/finalpool" / task["inputTask"] / "initial_workspace", target
        )
    write_json(
        ROOT / ".local/dataset-source.json", {"source": str(source), "commit": head}
    )
    return source


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path)
    args = parser.parse_args()
    prepare(args.source)
    print("Pinned public task inputs and evaluators verified")
