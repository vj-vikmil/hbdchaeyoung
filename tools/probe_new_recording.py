"""Probe new and thats it.mp3 structure."""
import json
from pathlib import Path

from faster_whisper import WhisperModel

SRC = Path(r"D:\CURSOR\chae\A Simple Night of Memories.mp3")
OUT = Path(__file__).resolve().parent.parent / "public" / "audio" / "new-recording-probe.json"

def main():
    model = WhisperModel("small", device="cpu", compute_type="int8")
    segs, info = model.transcribe(str(SRC), language="ko", beam_size=3, vad_filter=True)
    segments = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs if s.text.strip()]
    OUT.write_text(json.dumps({"duration": info.duration, "segments": segments}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {len(segments)} segments to {OUT}")

if __name__ == "__main__":
    main()
