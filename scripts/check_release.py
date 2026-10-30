"""Check distributable files only; never inspect or print local credentials."""

import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
TOP = {
    ".gitignore",
    ".gitattributes",
    "LICENSE",
    "README.md",
    "README.zh.md",
    "THIRD_PARTY_NOTICES.md",
    "package.json",
    "tsconfig.json",
    "vitest.config.ts",
}
DIRECTORIES = {
    "src",
    "tests",
    "scripts",
    "bench",
    "docs",
    "examples",
    "patches",
    "results",
    ".github",
}
PATTERNS = {
    "API credential": r"\bsk" + r"-[A-Za-z0-9_-]{20,}",
    "GitHub credential": r"\b(?:gh[pousr]" + r"_|github_pat_)[A-Za-z0-9_]{20,}",
    "private key": r"-----BEGIN (?:RSA |EC |OPENSSH )?" + r"PRIVATE KEY-----",
    "developer home path": r"/(?:data00/)?home/" + r"(?!runner\b)[\w.]+/",
    "credential URL": r"https?://[^\s/]+:[^\s/@]+" + r"@",
}


def main():
    names = sorted(
        set(
            subprocess.check_output(
                ["git", "ls-files", "-c", "-o", "--exclude-standard", "-z"], cwd=ROOT
            )
            .decode()
            .split("\0")
        )
        - {""}
    )
    errors = []
    size = 0
    for name in names:
        path = ROOT / name
        parts = path.relative_to(ROOT).parts
        if name not in TOP and parts[0] not in DIRECTORIES:
            errors.append((name, "outside release inventory"))
        if path.is_symlink():
            errors.append((name, "symlink in release"))
            continue
        if not path.is_file():
            errors.append((name, "missing file"))
            continue
        data = path.read_bytes()
        size += len(data)
        if len(data) > 2_000_000:
            errors.append((name, "unexpected large file"))
        if any(
            p in {".local", "node_modules", "__pycache__"} for p in parts
        ) or path.suffix in {".pyc", ".key", ".pem", ".log", ".zip", ".xlsx", ".pdf"}:
            errors.append((name, "runtime or raw data file"))
        try:
            text = data.decode()
        except UnicodeDecodeError:
            errors.append((name, "unexpected binary"))
            continue
        if path.suffix == ".json":
            try:
                json.loads(text)
            except ValueError:
                errors.append((name, "invalid JSON"))
        for label, pattern in PATTERNS.items():
            if re.search(pattern, text, re.I):
                errors.append((name, label))
        if path.suffix == ".md":
            for target in re.findall(r"\]\(([^)]+)\)", text):
                if "://" in target or target.startswith("#"):
                    continue
                target = unquote(target.split("#")[0])
                if not (path.parent / target).exists():
                    errors.append((name, "broken local link: " + target))
    if errors:
        for name, reason in errors:
            print(name + ": " + reason)
        raise SystemExit(1)
    print(
        f"Release scan passed: {len(names)} text files, {size:,} bytes; no matching credentials or developer home paths; local links valid"
    )


if __name__ == "__main__":
    main()
