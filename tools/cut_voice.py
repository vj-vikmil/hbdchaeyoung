"""Cut neww.mp3 into 7 chapter voice notes using silence boundaries."""
import json
import re
import subprocess
import sys
from pathlib import Path

SRC = Path(r"D:\CURSOR\chae\shared album\neww.mp3")
OUT = Path(__file__).resolve().parent.parent / "public" / "audio"
DURATION = 88.714014

# Long pauses (silence_end) from ffmpeg silencedetect noise=-30dB:d=1.0
SPLITS = [0.812608, 20.902676, 34.831111, 46.521746, 54.435964, 63.651111, 68.479705, DURATION]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if not SRC.exists():
        print(f"Missing source: {SRC}", file=sys.stderr)
        sys.exit(1)

    manifest = []
    for i in range(7):
        start = SPLITS[i]
        end = SPLITS[i + 1]
        out = OUT / f"chapter-{i + 1:02d}.mp3"
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(SRC),
            "-ss", f"{start:.3f}",
            "-to", f"{end:.3f}",
            "-c:a", "libmp3lame", "-q:a", "2",
            str(out),
        ]
        subprocess.run(cmd, check=True)
        manifest.append({"chapter": i + 1, "start": start, "end": end, "duration": end - start, "file": out.name})
        print(f"chapter-{i + 1:02d}.mp3  {start:.1f}s - {end:.1f}s  ({end - start:.1f}s)")

    (OUT / "chapters-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
