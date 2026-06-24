"""Copy new photos from the shared album folder into public/assets.

Usage:
  py tools/sync_album_photos.py
  py tools/sync_album_photos.py --src "D:\\CURSOR\\chae\\shared album"

Copies .jpg / .jpeg / .png files (skips audio). Does not delete existing assets.
After copying, add paths to public/content.json:
  - star visual.images for chapter modals
  - driftPhotos for background flying memories
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path(r"D:\CURSOR\chae\shared album")
ASSETS = ROOT / "public" / "assets"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync shared album photos into public/assets")
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    args = parser.parse_args()
    src: Path = args.src

    if not src.is_dir():
        raise SystemExit(f"Source folder not found: {src}")

    ASSETS.mkdir(parents=True, exist_ok=True)
    copied = 0
    for path in sorted(src.iterdir()):
        if not path.is_file() or path.suffix.lower() not in EXTS:
            continue
        dest = ASSETS / path.name
        if dest.exists() and dest.stat().st_size == path.stat().st_size:
            continue
        shutil.copy2(path, dest)
        print(f"copied {path.name}")
        copied += 1

    if not copied:
        print("no new photos to copy")
    else:
        print(f"done — {copied} file(s). Update content.json visual.images if needed.")


if __name__ == "__main__":
    main()
