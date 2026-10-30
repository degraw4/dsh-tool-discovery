"""Linux reference isolation: one writable task workspace, runtime files, no network."""

import os
from pathlib import Path
import sys
from common import ROOT, runtime


def main():
    cfg = runtime()
    kind = sys.argv[1]
    work = Path(sys.argv[2]).resolve()
    if (
        not work.is_dir()
        or work.name != "data"
        or not work.is_relative_to((ROOT / ".local/runs").resolve())
    ):
        raise SystemExit("benchmark-sandbox: invalid task workspace")
    args = [
        cfg["bwrap"],
        "--die-with-parent",
        "--unshare-net",
        "--unshare-pid",
        "--clearenv",
        "--ro-bind",
        "/usr",
        "/usr",
        "--symlink",
        "usr/bin",
        "/bin",
        "--symlink",
        "usr/lib",
        "/lib",
        "--symlink",
        "usr/lib64",
        "/lib64",
        "--dev",
        "/dev",
        "--proc",
        "/proc",
        "--tmpfs",
        "/tmp",
        "--dir",
        "/home",
    ]
    node_root = str(Path(cfg["node"]).resolve().parents[1])
    args += ["--ro-bind", node_root, node_root]
    if kind == "ptc":
        if "--" not in sys.argv or os.environ.get("DSH_SUBPROCESS_CONTROL") != "pipe":
            raise SystemExit("benchmark-sandbox: missing PTC control channel")
        split = sys.argv.index("--")
        command = sys.argv[split + 1 :]
        if not command or Path(command[0]).resolve() != Path(cfg["node"]).resolve():
            raise SystemExit("benchmark-sandbox: unexpected executable")
        source = Path(cfg["source"])
        args += ["--dir", str(source)]
        for name in ["packages", "vendor", "node_modules", "package.json"]:
            path = source / name
            args += ["--ro-bind", str(path), str(path)]
        args += ["--setenv", "DSH_SUBPROCESS_CONTROL", "pipe"]
    else:
        if kind not in ["excel", "filesystem", "pdf", "memory"]:
            raise SystemExit("benchmark-sandbox: unknown service")
        paths = {cfg["mcpNodeRoot"], cfg["excelOverlay"]}
        for key in ["pythonExcel", "pythonEval"]:
            paths.update([cfg[key]["directory"], cfg[key]["base"]])
        for path in sorted(paths):
            args += ["--ro-bind", path, path]
        args += [
            "--ro-bind",
            str(ROOT / "bench/pdf_launcher.py"),
            "/opt/pdf_launcher.py",
            "--setenv",
            "PYTHONPATH",
            cfg["excelOverlay"],
            "--setenv",
            "PYTHONDONTWRITEBYTECODE",
            "1",
            "--setenv",
            "PYTHONUNBUFFERED",
            "1",
        ]
        home = work / ".cache/mcp-home"
        home.mkdir(parents=True, exist_ok=True)
        args += ["--setenv", "MEMORY_FILE_PATH", str(home / "memory.json")]
        command = {
            "filesystem": [cfg["node"], cfg["filesystemEntry"], str(work)],
            "memory": [cfg["node"], cfg["memoryEntry"]],
            "excel": [
                cfg["pythonExcel"]["python"],
                str(Path(cfg["pythonExcel"]["directory"]) / "bin/excel-mcp-server"),
                "stdio",
                "--allow-dir",
                str(work),
            ],
            "pdf": [
                cfg["pythonEval"]["python"],
                "/opt/pdf_launcher.py",
                "--workspace_path",
                str(work),
                "--tempfile_dir",
                str(work / ".pdf_tools_tempfiles"),
            ],
        }[kind]
    args += [
        "--bind",
        str(work),
        str(work),
        "--chdir",
        str(work),
        "--setenv",
        "HOME",
        str(work),
        "--setenv",
        "TMPDIR",
        str(work),
        "--setenv",
        "LANG",
        "C.UTF-8",
        "--setenv",
        "PATH",
        str(Path(cfg["node"]).parent) + ":/usr/bin:/bin",
    ]
    os.execv(cfg["bwrap"], args + ["--", *command])


if __name__ == "__main__":
    main()
