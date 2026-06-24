"""Build chapter voice files from source recordings."""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO = ROOT / "public" / "audio"
SRC_OLD = Path(r"D:\CURSOR\chae\shared album\neww.mp3")
SRC_DESCRIPT = Path(r"D:\CURSOR\chae\A Simple Night of Memories.mp3")
SRC_WHY = Path(r"D:\CURSOR\chae\shared album\why i like you.mp3")

SOURCES = {"old": SRC_OLD, "descript": SRC_DESCRIPT}

CHAPTER_LEAD_IN = 0.12
CH1_LEAD_IN = 0.28

PACE_PROFILES = {
    "old": {"tempo": 1.02, "min_silence": 0.62, "gap": 0.22, "thresh": "-42dB"},
    "descript": {"tempo": 1.05, "min_silence": 0.50, "gap": 0.17, "thresh": "-40dB"},
    "why": {"tempo": 1.0, "min_silence": 0.68, "gap": 0.24, "thresh": "-38dB"},
}
PACE_WORD_PAD = 0.04

# Per-source chains — no loudnorm here (keeps each take's character)
SOURCE_REMASTER = {
    "old": "highpass=f=80",
    "descript": "highpass=f=75,afftdn=nf=-48:nt=w,equalizer=f=3000:width_type=o:width=1.3:g=-1.5",
    "why": (
        "highpass=f=100,"
        "afftdn=nf=-44:nt=w,"
        "equalizer=f=2200:width_type=o:width=1.5:g=2.8,"
        "equalizer=f=3800:width_type=o:width=1.2:g=2.2,"
        "compand=attacks=0.04:decays=0.22:points=-70/-70|-30/-14|0/-8|20/-8,"
        "alimiter=limit=0.92:attack=4:release=40"
    ),
}
COMBINE_NORM = "loudnorm=I=-18:TP=-1.5:LRA=11"

# Mostly old (neww.mp3) for opening + early chapters; descript for later / stronger takes
CHAPTERS = {
    1: {
        "label": "The Night We Met",
        "pace": True,
        "pace_profile": "old",
        "segments": [
            {
                "src": "old",
                "start": 0.68,
                "end": 20.902676,
                "lead_in": CH1_LEAD_IN,
                "note": "Chae Young opening (old)",
            },
        ],
    },
    2: {
        "label": "The Message",
        "pace": True,
        "pace_profile": "old",
        "segments": [
            {
                "src": "old",
                "start": 20.75,
                "end": 34.831111,
                "lead_in": CHAPTER_LEAD_IN,
                "note": "message chapter (old)",
            },
        ],
    },
    3: {
        "label": "The One That Almost Never Happened",
        "pace": True,
        "pace_profile": "descript",
        "segments": [
            {
                "src": "descript",
                "start": 30.76,
                "end": 43.44,
                "lead_in": 0.18,
                "note": "full chapter single take (descript)",
            },
        ],
    },
    5: {
        "label": "Korea",
        "pace": True,
        "pace_profile": "descript",
        "segments": [
            {
                "src": "descript",
                "start": 43.44,
                "end": 65.46,
                "lead_in": CHAPTER_LEAD_IN,
                "note": "Korea chapter (descript)",
            },
        ],
    },
}


def probe_duration(path: Path) -> float:
    out = subprocess.run([
        "ffprobe", "-hide_banner", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def detect_long_silences(path: Path, min_silence: float, thresh: str) -> list[tuple[float, float]]:
    proc = subprocess.run([
        "ffmpeg", "-hide_banner", "-i", str(path),
        "-af", f"silencedetect=noise={thresh}:d={min_silence}",
        "-f", "null", "-",
    ], capture_output=True, text=True)
    starts = [float(v) for v in re.findall(r"silence_start: ([\d.]+)", proc.stderr)]
    ends = [float(v) for v in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]
    return list(zip(starts, ends))


def speech_spans(duration: float, silences: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not silences:
        return [(0.0, duration)]

    pad = PACE_WORD_PAD
    spans: list[tuple[float, float]] = []
    spans.append((0.0, min(duration, silences[0][0] + pad)))

    for i in range(len(silences) - 1):
        start = max(0.0, silences[i][1] - pad)
        end = min(duration, silences[i + 1][0] + pad)
        if end - start > 0.08:
            spans.append((start, end))

    tail = max(0.0, silences[-1][1] - pad)
    if duration - tail > 0.08:
        spans.append((tail, duration))

    return spans


def tighten_pace(in_path: Path, out_path: Path, profile: str = "descript") -> float:
    """Shorten long pauses between phrases and nudge tempo — keeps word attacks via pad."""
    p = PACE_PROFILES.get(profile, PACE_PROFILES["descript"])
    tempo = p["tempo"]
    gap = p["gap"]
    duration = probe_duration(in_path)
    silences = detect_long_silences(in_path, p["min_silence"], p["thresh"])
    spans = speech_spans(duration, silences)

    if len(spans) <= 1 and not silences:
        af = f"atempo={tempo}"
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(in_path),
            "-af", af,
            "-c:a", "libmp3lame", "-q:a", "2",
            str(out_path),
        ], check=True)
        return probe_duration(out_path)

    filters: list[str] = []
    concat_inputs: list[str] = []
    n = 0

    for i, (start, end) in enumerate(spans):
        label = f"p{i}"
        filters.append(
            f"[0:a]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[{label}]"
        )
        concat_inputs.append(f"[{label}]")
        n += 1

        if i < len(spans) - 1:
            glabel = f"g{i}"
            filters.append(
                f"anullsrc=r=48000:cl=stereo,atrim=duration={gap:.3f},"
                f"asetpts=PTS-STARTPTS[{glabel}]"
            )
            concat_inputs.append(f"[{glabel}]")
            n += 1

    filters.append(f"{''.join(concat_inputs)}concat=n={n}:v=0:a=1[tight]")
    filters.append(f"[tight]atempo={tempo}[out]")

    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(in_path),
        "-filter_complex", ";".join(filters),
        "-map", "[out]",
        "-c:a", "libmp3lame", "-q:a", "2",
        str(out_path),
    ], check=True)
    return probe_duration(out_path)


REMASTER = SOURCE_REMASTER["descript"]


def remaster_chain_for(src: str) -> str:
    return SOURCE_REMASTER.get(src, SOURCE_REMASTER["descript"])


def pace_part_optional(part: Path, enabled: bool, profile: str = "descript") -> Path:
    if not enabled:
        return part
    paced = part.with_name(part.stem + ".paced.mp3")
    tighten_pace(part, paced, profile)
    return paced


def master_part(part: Path, src: str) -> Path:
    out = part.with_name(part.stem + ".master.mp3")
    remaster(part, out, remaster_chain_for(src))
    return out


def cut_raw(src: Path, start: float, end: float, out: Path, lead_in: float = 0) -> None:
    """Sample-accurate trim — avoids MP3 seek clipping on word attacks."""
    adj_start = max(0, start - lead_in)
    af = f"atrim=start={adj_start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-af", af,
        "-c:a", "libmp3lame", "-q:a", "2",
        str(out),
    ], check=True)


def concat_parts(
    parts: list[Path],
    src_keys: list[str],
    pace_flags: list[bool],
    pace_profiles: list[str],
    out: Path,
    crossfade_s: float = 0.22,
) -> float:
    processed = [
        master_part(pace_part_optional(part, pace, profile), src)
        for part, src, pace, profile in zip(parts, src_keys, pace_flags, pace_profiles)
    ]

    if len(processed) == 1:
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(processed[0]),
            "-c:a", "copy",
            str(out),
        ], check=True)
        return probe_duration(out)

    inputs = []
    for p in processed:
        inputs.extend(["-i", str(p)])

    n = len(processed)
    if n == 2:
        filt = f"[0:a][1:a]acrossfade=d={crossfade_s}:c1=tri:c2=tri[a]"
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            *inputs,
            "-filter_complex", filt,
            "-map", "[a]",
            "-c:a", "libmp3lame", "-q:a", "2",
            str(out),
        ], check=True)
        return probe_duration(out)

    cur = processed[0]
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        for i, nxt in enumerate(processed[1:], 1):
            merged = tmp_dir / f"m{i}.mp3"
            subprocess.run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(cur), "-i", str(nxt),
                "-filter_complex", f"[0:a][1:a]acrossfade=d={crossfade_s}:c1=tri:c2=tri[a]",
                "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", str(merged),
            ], check=True)
            cur = merged
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(cur), "-c:a", "copy", str(out),
        ], check=True)
        return probe_duration(out)
    finally:
        for f in tmp_dir.glob("*"):
            f.unlink(missing_ok=True)
        tmp_dir.rmdir()


def remaster(in_path: Path, out_path: Path, chain: str = REMASTER) -> None:
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(in_path),
        "-af", chain,
        "-c:a", "libmp3lame", "-q:a", "2",
        str(out_path),
    ], check=True)


def scale_transcripts(durations: dict[str, float]) -> None:
    path = AUDIO / "transcripts.json"
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    for key, new_dur in durations.items():
        entry = data.get(key)
        if not entry:
            continue
        old_dur = float(entry.get("duration") or new_dur)
        if old_dur <= 0:
            continue
        ratio = new_dur / old_dur
        entry["duration"] = round(new_dur, 2)
        for seg in entry.get("segments", []):
            seg["start"] = round(float(seg["start"]) * ratio, 2)
            seg["end"] = round(float(seg["end"]) * ratio, 2)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def pace_profile_for(seg: dict, spec: dict) -> str:
    if seg.get("pace_profile"):
        return seg["pace_profile"]
    if spec.get("pace_profile"):
        return spec["pace_profile"]
    return "old" if seg["src"] == "old" else "descript"


def build_chapter(num: int, spec: dict, out: Path) -> dict:
    tmp_dir = Path(tempfile.mkdtemp())
    parts = []
    src_keys = []
    pace_flags = []
    pace_profiles = []
    seg_meta = []
    chapter_pace = spec.get("pace", True)
    try:
        for i, seg in enumerate(spec["segments"]):
            src = SOURCES[seg["src"]]
            part = tmp_dir / f"part{i:02d}.mp3"
            cut_raw(src, seg["start"], seg["end"], part, seg.get("lead_in", CHAPTER_LEAD_IN))
            parts.append(part)
            src_keys.append(seg["src"])
            pace_flags.append(seg.get("pace", chapter_pace))
            pace_profiles.append(pace_profile_for(seg, spec))
            seg_meta.append({
                "src": seg["src"],
                "file": src.name,
                "start": seg["start"],
                "end": seg["end"],
                "duration": round(seg["end"] - seg["start"], 2),
                "note": seg.get("note", ""),
            })

        paced_dur = concat_parts(
            parts,
            src_keys,
            pace_flags,
            pace_profiles,
            out,
            crossfade_s=spec.get("stitch_crossfade", 0.22),
        )

        return {
            "chapter": num,
            "file": out.name,
            "label": spec["label"],
            "segments": seg_meta,
            "output_duration": round(paced_dur, 2),
        }
    finally:
        for f in tmp_dir.glob("*"):
            f.unlink(missing_ok=True)
        tmp_dir.rmdir()


COMBINE_GAP = 1.0
COMBINE_ORDER = [
    ("s1", "chapter-01.mp3", "/audio/chapter-01.mp3"),
    ("s2", "chapter-02.mp3", "/audio/chapter-02.mp3"),
    ("s3", "chapter-03.mp3", "/audio/chapter-03.mp3"),
    ("s5", "chapter-05.mp3", "/audio/chapter-05.mp3"),
    ("s4", "why-i-like-you.mp3", "/audio/why-i-like-you.mp3"),
]

def copy_why(src: Path, out: Path) -> None:
    tmp = out.with_suffix(".raw.mp3")
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src), "-c:a", "libmp3lame", "-q:a", "2", str(tmp),
    ], check=True)
    paced = pace_part_optional(tmp, True, "why")
    remaster(paced, out, SOURCE_REMASTER["why"])
    tmp.unlink(missing_ok=True)


def combine_voices(chapter_meta: list[dict]) -> dict:
    """Stitch all chapter voice files into one continuous story track."""
    dur_by_file = {
        c["file"]: c["output_duration"]
        for c in chapter_meta
        if c.get("output_duration") is not None
    }

    filters: list[str] = []
    concat_inputs: list[str] = []
    n = 0
    cursor = 0.0
    chapters_out = []

    for i, (star_id, filename, transcript) in enumerate(COMBINE_ORDER):
        path = AUDIO / filename
        if not path.exists():
            raise FileNotFoundError(path)

        dur = dur_by_file.get(filename) or probe_duration(path)
        start = cursor
        end = start + dur
        chapters_out.append({
            "id": star_id,
            "file": filename,
            "transcript": transcript,
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(dur, 3),
        })

        label = f"c{i}"
        filters.append(f"[{i}:a]asetpts=PTS-STARTPTS[{label}]")
        concat_inputs.append(f"[{label}]")
        n += 1
        cursor = end

        if i < len(COMBINE_ORDER) - 1:
            glabel = f"g{i}"
            filters.append(
                f"anullsrc=r=48000:cl=stereo,atrim=duration={COMBINE_GAP:.3f},"
                f"asetpts=PTS-STARTPTS[{glabel}]"
            )
            concat_inputs.append(f"[{glabel}]")
            n += 1
            cursor += COMBINE_GAP

    filters.append(f"{''.join(concat_inputs)}concat=n={n}:v=0:a=1[out]")

    inputs: list[str] = []
    for _, filename, _ in COMBINE_ORDER:
        inputs.extend(["-i", str(AUDIO / filename)])

    out_path = AUDIO / "full-story.mp3"
    tmp_path = AUDIO / "full-story.tmp.mp3"
    subprocess.run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[out]",
        "-c:a", "libmp3lame", "-q:a", "2",
        str(tmp_path),
    ], check=True)
    remaster(tmp_path, out_path, COMBINE_NORM)
    tmp_path.unlink(missing_ok=True)

    story = {
        "file": "/audio/full-story.mp3",
        "duration": round(probe_duration(out_path), 3),
        "gap_s": COMBINE_GAP,
        "chapters": chapters_out,
    }
    (AUDIO / "full-story.json").write_text(
        json.dumps(story, indent=2), encoding="utf-8"
    )
    return story


def main():
    if not SRC_OLD.exists():
        print(f"Missing {SRC_OLD}", file=sys.stderr)
        sys.exit(1)
    if not SRC_DESCRIPT.exists():
        print(f"Missing {SRC_DESCRIPT}", file=sys.stderr)
        sys.exit(1)

    AUDIO.mkdir(parents=True, exist_ok=True)
    manifest = {
        "mix": "neww.mp3 (ch1-3) + descript (ch3 end, ch5-7) — dry natural",
        "pace": PACE_PROFILES,
        "processing": "per-source cleanup; single loudnorm on full-story only",
        "sources": {
            "old": str(SRC_OLD),
            "descript": str(SRC_DESCRIPT),
            "why": str(SRC_WHY),
        },
        "chapters": [],
    }
    paced_durations: dict[str, float] = {}

    for num in sorted(CHAPTERS):
        spec = CHAPTERS[num]
        out = AUDIO / f"chapter-{num:02d}.mp3"
        meta = build_chapter(num, spec, out)
        manifest["chapters"].append(meta)
        paced_durations[f"/audio/{out.name}"] = meta["output_duration"]
        segs = meta["segments"]
        if len(segs) == 1:
            s = segs[0]
            print(
                f"chapter-{num:02d}.mp3  {s['file']}  {s['start']:.1f}-{s['end']:.1f}s  "
                f"-> {meta['output_duration']:.1f}s  ({s.get('note', '')})"
            )
        else:
            print(f"chapter-{num:02d}.mp3  MIX  {len(segs)} segments")
            for s in segs:
                print(f"  - {s['file']}  {s['start']:.1f}-{s['end']:.1f}s  ({s['note']})")

    if SRC_WHY.exists():
        out = AUDIO / "why-i-like-you.mp3"
        copy_why(SRC_WHY, out)
        why_dur = probe_duration(out)
        paced_durations["/audio/why-i-like-you.mp3"] = why_dur
        manifest["chapters"].append({
            "chapter": 5,
            "file": out.name,
            "label": "Why I Like You",
            "segments": [{"src": "why", "file": SRC_WHY.name, "note": "English chapter (separate)"}],
            "output_duration": round(why_dur, 2),
        })
        print(f"why-i-like-you.mp3  -> {why_dur:.1f}s  (chapter 5 / finale)")

    manifest["chapters"].sort(key=lambda c: c["chapter"])
    (AUDIO / "chapters-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    scale_transcripts(paced_durations)
    print("transcripts.json caption timings scaled")

    story = combine_voices(manifest["chapters"])
    print(f"full-story.mp3  -> {story['duration']:.1f}s  ({len(story['chapters'])} chapters)")


if __name__ == "__main__":
    main()
