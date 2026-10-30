import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DSH_REVISION = "d743267388641bc76f17c45ce8b4c231aed1d32c"
TOOLATHLON_REVISION = "9be8d8fe07a497b18ee61e3f2ae694e9797f39eb"


def runtime():
    path = ROOT / ".local/bench-runtime.json"
    if not path.is_file():
        raise RuntimeError("Run python3 bench/setup.py first")
    return json.loads(path.read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def tasks():
    source = Path(runtime()["toolathlon"])
    entries = json.loads((ROOT / "bench/tasks.json").read_text())["tasks"]
    for item in entries:
        if "promptPath" in item:
            item["prompt"] = (source / item["promptPath"]).read_text().strip()
            if (
                hashlib.sha256(item["prompt"].encode()).hexdigest()
                != item["promptSha256"]
            ):
                raise ValueError("Public task prompt changed")
    return entries
