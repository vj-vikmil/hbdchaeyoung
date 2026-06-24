"""Remaster voice notes — minimal chain, preserve natural dynamics."""
import subprocess
from pathlib import Path

AUDIO = Path(__file__).resolve().parent.parent / "public" / "audio"

FILTER = "highpass=f=80,afftdn=nf=-38:nt=w,loudnorm=I=-18:TP=-1.5:LRA=11"

FILTER_INTIMATE = (
    "highpass=f=80,afftdn=nf=-38:nt=w,"
    "aecho=0.96:0.94:50:0.06,"
    "loudnorm=I=-18:TP=-1.5:LRA=11"
)

FILES = [
    ("chapter-01.mp3", FILTER),
    ("chapter-02.mp3", FILTER),
    ("chapter-03.mp3", FILTER),
    ("chapter-04.mp3", FILTER),
    ("chapter-05.mp3", FILTER),
    ("chapter-06.mp3", FILTER),
    ("chapter-07.mp3", FILTER_INTIMATE),
    ("why-i-like-you.mp3", FILTER),
]


def remaster(path: Path, chain: str) -> None:
    tmp = path.with_suffix(".remaster.mp3")
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(path),
        "-af", chain,
        "-c:a", "libmp3lame", "-q:a", "2",
        str(tmp),
    ], check=True)
    tmp.replace(path)
    print(f"remastered {path.name}")


def main():
    for name, chain in FILES:
        path = AUDIO / name
        if not path.exists():
            print(f"skip {name}")
            continue
        remaster(path, chain)


if __name__ == "__main__":
    main()
