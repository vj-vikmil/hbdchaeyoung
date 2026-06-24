"""Transcribe voice notes. Korean: re-segment via Whisper + keep manual review.
English: Whisper small. Output: public/audio/transcripts.json

Usage:
  py tools/transcribe_voice.py          # English only (safe)
  py tools/transcribe_voice.py all      # all files — Korean needs manual fix after
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "public" / "audio"
OUT = AUDIO / "transcripts.json"

KO_FILES = {
    "chapter-01.mp3": "ko",
    "chapter-02.mp3": "ko",
    "chapter-03.mp3": "ko",
    "chapter-05.mp3": "ko",
}

EN_FILES = {
    "why-i-like-you.mp3": "en",
}


def load_existing():
    if OUT.exists():
        return json.loads(OUT.read_text(encoding="utf-8"))
    return {}


def transcribe_file(model, path: Path, lang: str):
    segments_iter, info = model.transcribe(
        str(path),
        language=lang,
        beam_size=5,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 350},
    )
    segments = []
    parts = []
    for seg in segments_iter:
        text = seg.text.strip()
        if not text:
            continue
        segments.append({
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": text,
        })
        parts.append(text)
    return {
        "language": info.language,
        "duration": round(info.duration, 2),
        "segments": segments,
        "full": "\n\n".join(parts),
    }


def main():
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Run: py -m pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1] if len(sys.argv) > 1 else "en"
    model_name = "small"
    if len(sys.argv) > 2:
        model_name = sys.argv[2]

    targets = dict(EN_FILES)
    if mode == "all":
        targets = {**KO_FILES, **EN_FILES}

    print(f"Loading whisper ({model_name}), mode={mode}...")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    result = load_existing() if mode == "en" else {}
    for name, lang in targets.items():
        path = AUDIO / name
        if not path.exists():
            print(f"skip missing {name}")
            continue
        key = f"/audio/{name}"
        print(f"transcribing {name} ({lang})...")
        entry = transcribe_file(model, path, lang)
        result[key] = entry
        print(f"  segs={len(entry['segments'])} dur={entry['duration']}s")

    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    if mode == "all":
        print("NOTE: Korean Whisper output is often wrong — review transcripts.json manually.")


if __name__ == "__main__":
    main()
