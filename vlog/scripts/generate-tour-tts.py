#!/usr/bin/env python3
"""Generate reusable voice-only Vlog Tour takes on Worknode, no video or clone.

Produces real MP3 files and a SHA-256 batch receipt. The Tour owner index is
NOT modified here: transfer/verify the files before indexing as tts_variants,
never as accepted real-life recordings. TTS needs human listening before use.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
from datetime import date

WORK_HOST = "lir-C4Q7LMX6L5"
ALLOWED_VOICES = {"Uncle_Fu", "Dylan", "Eric"}


def exec_tool(*args, timeout=180):
    result = subprocess.run(args, check=True, capture_output=True,
                            text=True, timeout=timeout)
    return result.stdout


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tour", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shots", default="", help="Comma-separated shot IDs; default configured voice assets")
    parser.add_argument("--skip-asr", action="store_true")
    args = parser.parse_args()
    if socket.gethostname() != WORK_HOST:
        parser.error("Worknode inference only")
    tour = json.loads(args.tour.read_text(encoding="utf-8"))
    cfg = json.loads(args.profiles.read_text(encoding="utf-8"))
    shots = {shot["id"]: shot for shot in tour["shots"]}
    selected = args.shots.split(",") if args.shots else list(cfg["voices"])
    if not selected or len(selected) > 25 or len(set(selected)) != len(selected):
        parser.error("Invalid selection")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Output directory must be empty: never overwrite earlier TTS candidates")
    args.output.mkdir(parents=True, exist_ok=True)
    records = []
    for shot_id in selected:
        profile = cfg["voices"].get(shot_id)
        shot = shots.get(shot_id)
        if not profile or not shot:
            raise ValueError("Unknown voice profile/shot: " + shot_id)
        text = shot.get("script", "").strip()
        if len(text) < 4 or "不用背稿" in text or "不必讲话" in text:
            raise ValueError("No fixed spoken script available for: " + shot_id)
        voice = profile["voice"]
        if voice not in ALLOWED_VOICES:
            raise ValueError("Unapproved voice choice: " + voice)
        name = f"{shot_id}-{profile['filename_slug']}-{date.today():%Y%m%d}-{voice.lower().replace('_','') }"
        with tempfile.TemporaryDirectory(prefix="vlog-tts-") as temp:
            folder = Path(temp)
            exec_tool("mlx_audio.tts.generate", "--model", cfg["model"],
                      "--text", text, "--voice", voice, "--lang_code", "zh",
                      "--instruct", profile["instruction"],
                      "--output_path", str(folder), "--file_prefix", "voice", timeout=180)
            wav = folder / "voice_000.wav"
            if not wav.is_file():
                raise RuntimeError("Qwen3-TTS did not generate expected WAV: " + shot_id)
            dest = args.output / (name + ".mp3")
            exec_tool("ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                      "-i", str(wav), "-af", "highpass=f=75,loudnorm=I=-16:TP=-1.5:LRA=9",
                      "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame", "-q:a", "3", str(dest))
        probe = json.loads(exec_tool("ffprobe", "-v", "error", "-show_entries",
                                     "format=duration:stream=sample_rate,channels", "-of", "json", str(dest)))
        if not probe.get("streams") or int(probe["streams"][0]["sample_rate"]) != 44100:
            raise RuntimeError("Invalid audio stream: " + shot_id)
        transcript = None
        if not args.skip_asr:
            try:
                exec_tool("mlx_audio.stt.generate", "--model",
                          "mlx-community/whisper-large-v3-turbo-asr-fp16",
                          "--audio", str(dest), "--output-path", str(args.output / (name + ".asr")),
                          "--format", "txt", "--language", "zh", timeout=180)
                transcript = (args.output / (name + ".asr.txt")).read_text().strip()
            except Exception:
                transcript = None
        entry = {"shot_id": shot_id, "text": text, "media_path": dest.name,
                 "sha256": digest(dest), "bytes": dest.stat().st_size,
                 "duration_s": round(float(probe["format"]["duration"]), 3),
                 "provider": "Worknode Qwen3-TTS CustomVoice", "model": cfg["model"],
                 "voice_name": voice, "voice_style": profile["style"],
                 "voice_cloning": False, "reference_audio_used": False,
                 "asr_transcript": transcript, "qa": "human_listening_pending",
                 "source_type": "synthetic_tts", "status": "generated_qa_pending"}
        records.append(entry)
        print(json.dumps({"generated": shot_id, "voice": voice,
                          "duration_s": entry["duration_s"], "asr": transcript}, ensure_ascii=False), flush=True)
    (args.output / "batch-result.json").write_text(
        json.dumps({"status": "COMPLETE", "clips": records}, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main()
