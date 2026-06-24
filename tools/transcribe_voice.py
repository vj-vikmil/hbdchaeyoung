"""Transcribe chapter voice notes with faster-whisper. Output: public/audio/transcripts.json"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "public" / "audio"
OUT = AUDIO / "transcripts.json"

FILES = {
    "chapter-01.mp3": "ko",
    "chapter-02.mp3": "ko",
    "chapter-03.mp3": "ko",
    "chapter-05.mp3": "ko",
    "chapter-06.mp3": "ko",
    "chapter-07.mp3": "ko",
    "why-i-like-you.mp3": "en",
}


def main():
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("Run: py -m pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    print("Loading whisper model (small)...")
    model = WhisperModel("small", device="cpu", compute_type="int8")

    result = {}
    for name, lang in FILES.items():
        path = AUDIO / name
        if not path.exists():
            print(f"skip missing {name}")
            continue

        key = f"/audio/{name}"
        print(f"transcribing {name} ({lang})...")
        segments_iter, info = model.transcribe(
            str(path),
            language=lang,
            beam_size=5,
            vad_filter=True,
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

        result[key] = {
            "language": info.language,
            "duration": round(info.duration, 2),
            "segments": segments,
            "full": " ".join(parts),
        }
        print(f"  lang={info.language} segs={len(segments)} dur={info.duration:.1f}s")

    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
