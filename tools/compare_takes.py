"""Compare chapter takes from both source recordings."""
import json
from pathlib import Path

from faster_whisper import WhisperModel

SRC_OLD = Path(r"D:\CURSOR\chae\shared album\neww.mp3")
SRC_NEW = Path(r"D:\CURSOR\chae\shared album\new and thats it.mp3")
OUT = Path(__file__).resolve().parent.parent / "public" / "audio" / "take-compare.json"

OLD_SPLITS = [0.812608, 20.902676, 34.831111, 46.521746, 54.435964, 63.651111, 68.479705, 88.714014]
NEW_SPLITS = [0.83, 18.55, 33.71, 46.35, 63.99, 74.43, 110.909]

CHAPTER_NUMS = [1, 2, 3, 5, 6, 7]


def ranges(splits):
    return {n: (splits[i], splits[i + 1]) for i, n in enumerate(CHAPTER_NUMS)}


def transcribe_range(model, src, start, end, lang="ko"):
    import subprocess
    import tempfile
    tmp = Path(tempfile.gettempdir()) / "take_clip.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src), "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
        "-c:a", "libmp3lame", "-q:a", "4", str(tmp),
    ], check=True)
    segs, _ = model.transcribe(str(tmp), language=lang, beam_size=3)
    parts = [s.text.strip() for s in segs if s.text.strip()]
    tmp.unlink(missing_ok=True)
    return " ".join(parts)


def main():
    model = WhisperModel("small", device="cpu", compute_type="int8")
    old_r = ranges(OLD_SPLITS)
    new_r = ranges(NEW_SPLITS)
    result = {}
    for n in CHAPTER_NUMS:
        result[str(n)] = {
            "old": {
                "range": old_r[n],
                "text": transcribe_range(model, SRC_OLD, *old_r[n]),
            },
            "new": {
                "range": new_r[n],
                "text": transcribe_range(model, SRC_NEW, *new_r[n]),
            },
        }
        print(f"=== ch{n} === done")
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
