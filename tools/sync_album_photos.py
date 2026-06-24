"""Copy deduplicated photos from shared album into public/assets/album-*.

Usage:
  py tools/sync_album_photos.py
  py tools/sync_album_photos.py --src "D:\\CURSOR\\chae\\shared album" --manifest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path(r"D:\CURSOR\chae\shared album")
ASSETS = ROOT / "public" / "assets"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def slug_name(path: Path) -> str:
    stem = path.stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    if stem.startswith("img-"):
        stem = stem.replace("img-", "", 1)
    return f"album-{stem}{path.suffix.lower()}"


def file_hash(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def iter_unique_photos(src: Path) -> list[Path]:
    seen: dict[str, Path] = {}
    for path in sorted(src.iterdir()):
        if not path.is_file() or path.suffix.lower() not in EXTS:
            continue
        if path.name.startswith("photo_") and path.stat().st_size < 280_000:
            continue
        digest = file_hash(path)
        if digest in seen:
            continue
        seen[digest] = path
    return list(seen.values())


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync deduplicated shared album photos")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    parser.add_argument("--manifest", action="store_true", help="Write tools/album_manifest.json")
    args = parser.parse_args()
    src: Path = args.src

    if not src.is_dir():
        raise SystemExit(f"Source folder not found: {src}")

    ASSETS.mkdir(parents=True, exist_ok=True)
    copied = 0
    manifest: list[dict] = []

    for path in iter_unique_photos(src):
        dest_name = slug_name(path)
        dest = ASSETS / dest_name
        if not dest.exists() or dest.stat().st_size != path.stat().st_size:
            shutil.copy2(path, dest)
            print(f"copied {path.name} -> {dest_name}")
            copied += 1
        manifest.append({
            "src": path.name,
            "asset": f"/assets/{dest_name}",
            "bytes": path.stat().st_size,
        })

    manifest.sort(key=lambda row: row["src"])
    if args.manifest:
        out = ROOT / "tools" / "album_manifest.json"
        out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"manifest -> {out}")

    print(f"done — {len(manifest)} unique, {copied} copied")


if __name__ == "__main__":
    main()
