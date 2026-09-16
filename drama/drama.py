#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
import re
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
RUN_SERIES = os.environ.get("DRAMA_SERIES", "taotao-first-night")
RUN_ID = os.environ.get("DRAMA_RUN_ID", f"{dt.date.today().isoformat()}-local")
RUN_ROOT = ROOT / "runs" / RUN_SERIES / RUN_ID
GENERATED = RUN_ROOT / "generated"
MANIFEST = GENERATED / "manifest.json"
WORKFLOW = ROOT / "config/workflow.json"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path):
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def providers():
    return load_json(ROOT / "config/providers.json")["providers"]


def workflow_config():
    return load_json(WORKFLOW)


def workflow_agents():
    config = workflow_config()
    ids = set()
    orchestration = config.get("orchestration", {})
    for key in ("production_lead", "workflow_advisor"):
        value = orchestration.get(key)
        if value:
            ids.add(value)
    for stage in config.get("stages", {}).values():
        for key, value in stage.items():
            if key.endswith("_agent") and isinstance(value, str):
                ids.add(value)
    root = Path(config.get("agent_registry", "~/.codex/agents")).expanduser()
    return {agent_id: (root / f"{agent_id}.toml").is_file() for agent_id in sorted(ids)}


def load_manifest():
    if MANIFEST.exists():
        return load_json(MANIFEST)
    return {"version": 1, "updated_at": None, "stages": {}}


def save_manifest(manifest):
    GENERATED.mkdir(parents=True, exist_ok=True)
    manifest["updated_at"] = utc_now()
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def record(stage, status, output=None, detail=None):
    manifest = load_manifest()
    item = {"status": status, "updated_at": utc_now(), "output": output}
    if detail:
        item["detail"] = detail
    manifest["stages"][stage] = item
    save_manifest(manifest)


def agnes_key_source():
    if os.environ.get("AGNES_API_KEY"):
        return "AGNES_API_KEY"
    auth_path = Path.home() / ".pi/agent/auth.json"
    if auth_path.exists():
        try:
            data = load_json(auth_path)
            if isinstance(data.get("agnes"), dict) and data["agnes"].get("key"):
                return "~/.pi/agent/auth.json"
        except (OSError, json.JSONDecodeError) as error:
            return f"invalid ~/.pi/agent/auth.json: {error}"
    models_path = Path.home() / ".pi/agent/models.json"
    if models_path.exists():
        try:
            data = load_json(models_path)
            key = data.get("providers", {}).get("agnes", {}).get("apiKey")
            if key:
                return "~/.pi/agent/models.json"
        except (OSError, json.JSONDecodeError) as error:
            return f"invalid ~/.pi/agent/models.json: {error}"
    return None




def is_wav_file(path):
    try:
        if not path.is_file() or path.stat().st_size <= 44:
            return False
        with path.open("rb") as handle:
            header = handle.read(12)
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    except OSError:
        return False

def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_video(path):
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration,size",
            "-show_entries", "stream=codec_type,codec_name,width,height",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"video is not decodable: {path.name}: {result.stderr.strip()}")
    data = json.loads(result.stdout)
    duration = float(data.get("format", {}).get("duration") or 0)
    streams = data.get("streams", [])
    if duration <= 0 or not any(stream.get("codec_type") == "video" for stream in streams):
        raise RuntimeError(f"video has no valid video stream or duration: {path.name}")
    return {
        "duration_sec": round(duration, 3),
        "size_bytes": path.stat().st_size,
        "streams": streams,
    }


def continuity_frame(episode, shot_id):
    video = GENERATED / f"video/{episode}-{shot_id}.mp4"
    if not video.is_file():
        raise RuntimeError(f"continuity source video missing: {video.relative_to(ROOT)}")
    probe_video(video)
    frame = GENERATED / f"continuity/{episode}-{shot_id}-end.jpg"
    if frame.is_file() and frame.stat().st_size > 0:
        return frame
    frame.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-sseof", "-0.08",
            "-i", str(video), "-frames:v", "1", str(frame),
        ],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not frame.is_file() or frame.stat().st_size == 0:
        raise RuntimeError(f"failed to extract continuity frame for {episode}/{shot_id}: {result.stderr.strip()}")
    return frame


def write_sidecar(output_path, artifact_id, kind, prompt, source_assets, command_log):
    sidecar = output_path.with_suffix(output_path.suffix + ".json")
    payload = {
        "id": artifact_id,
        "kind": kind,
        "provider": "agnes" if kind in {"image", "video"} else "local-mlx-audio",
        "status": "generated",
        "prompt": prompt,
        "source_assets": source_assets,
        "created_at": utc_now(),
        "output": str(output_path.relative_to(ROOT)),
        "command_log": command_log,
        "size_bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
    }
    if kind == "video":
        payload["technical_evidence"] = probe_video(output_path)
    sidecar.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def run_logged(command, log_path):
    log_path.parent.mkdir(parents=True, exist_ok=True)
    display = " ".join(command)
    with log_path.open("w", encoding="utf-8") as handle:
        handle.write(display + "\n\n")
        handle.flush()
        result = subprocess.run(command, stdout=handle, stderr=subprocess.STDOUT)
    return result.returncode, log_path.relative_to(ROOT).as_posix(), display


def validate():
    required = [
        RUN_ROOT / "story/series.json",
        RUN_ROOT / "characters/taotao/character.yaml",
        RUN_ROOT / "assets/source-photo.md",
        RUN_ROOT / "locations/night-bedroom/location.yaml",
        ROOT / "config/providers.json",
    ]
    for path in required:
        if not path.is_file():
            raise ValueError(f"missing required asset: {path.relative_to(ROOT)}")
    series = load_json(required[0])
    episodes = series.get("episodes")
    if not isinstance(episodes, list) or not episodes:
        raise ValueError("series.episodes must be a non-empty list")
    if len(set(episodes)) != len(episodes):
        raise ValueError("series.episodes must not contain duplicates")
    invalid = [episode for episode in episodes if not isinstance(episode, str) or not re.fullmatch(r"ep\d{2,}", episode)]
    if invalid:
        raise ValueError(f"invalid episode ids: {invalid}; expected ep01, ep02, ...")
    for episode in episodes:
        script = load_json(RUN_ROOT / f"episodes/{episode}/script.json")
        plan = load_json(RUN_ROOT / f"episodes/{episode}/shots.json")
        if not script.get("lines") or not plan.get("shots"):
            raise ValueError(f"{episode} is incomplete")
        if not (RUN_ROOT / f"episodes/{episode}/storyboard.md").is_file():
            raise ValueError(f"{episode} has no Markcut storyboard")
        shot_ids = {shot["id"] for shot in plan["shots"]}
        seen_shots = set()
        for shot_item in plan["shots"]:
            continuity_from = shot_item.get("continuity_from")
            continuity_from_episode = shot_item.get("continuity_from_episode")
            if continuity_from:
                if continuity_from_episode and continuity_from_episode != episode:
                    if continuity_from_episode not in episodes or episodes.index(continuity_from_episode) >= episodes.index(episode):
                        raise ValueError(f"{episode}/{shot_item['id']} continuity_from_episode must reference an earlier episode")
                    source_plan = load_json(RUN_ROOT / f"episodes/{continuity_from_episode}/shots.json")
                    source_ids = {item["id"] for item in source_plan.get("shots", [])}
                    if continuity_from not in source_ids:
                        raise ValueError(f"{episode}/{shot_item['id']} continuity source {continuity_from_episode}/{continuity_from} does not exist")
                elif continuity_from not in seen_shots:
                    raise ValueError(f"{episode}/{shot_item['id']} continuity_from must reference an earlier shot")
            seen_shots.add(shot_item["id"])
        for line in script["lines"]:
            if line.get("shot") and line["shot"] not in shot_ids:
                raise ValueError(f"{episode}/{line['id']} references missing shot {line['shot']}")


def concept(force=False):
    output = GENERATED / "images/taotao-concept.png"
    if output.exists() and not force:
        record("concept", "succeeded", str(output.relative_to(ROOT)), "existing output retained")
        return output
    source = agnes_key_source()
    if source is None or source.startswith("invalid"):
        detail = source or "no Agnes key source found"
        record("concept", "blocked", None, detail)
        raise RuntimeError(f"Agnes authentication unavailable: {detail}")
    prompt = load_character_prompt()
    command = providers()["image"]["command"] + [prompt, "--size", "768x1366", "--output", str(output)]
    output.parent.mkdir(parents=True, exist_ok=True)
    code, log, _ = run_logged(command, GENERATED / "logs/taotao-concept.log")
    if code != 0 or not output.exists():
        record("concept", "failed", None, f"Agnes image generation failed; see {log}")
        raise RuntimeError(f"Agnes image generation failed; see {log}")
    write_sidecar(output, "taotao-concept", "image", prompt, [f"runs/{RUN_SERIES}/{RUN_ID}/characters/taotao/character.yaml"], log)
    record("concept", "succeeded", output.relative_to(ROOT).as_posix(), f"Agnes key source: {source}")
    return output


def load_character_prompt():
    lines = (RUN_ROOT / "characters/taotao/character.yaml").read_text(encoding="utf-8").splitlines()
    start = next(index for index, line in enumerate(lines) if line.startswith("canonical_image_prompt:"))
    values = [lines[start].removeprefix("canonical_image_prompt:").strip()]
    for line in lines[start + 1:]:
        if not line.startswith("  "):
            break
        values.append(line.strip())
    return " ".join(value for value in values if value)


def tts(episode, line_id, force=False):
    validate()
    script = load_json(RUN_ROOT / f"episodes/{episode}/script.json")
    selected = next((line for line in script["lines"] if line["id"] == line_id), None)
    if not selected:
        raise ValueError(f"missing {episode}/{line_id}")
    output = GENERATED / f"audio/{episode}-{line_id}.wav"
    if output.exists() and not force and is_wav_file(output):
        record(f"tts:{episode}:{line_id}", "succeeded", str(output.relative_to(ROOT)), "existing output retained")
        return output
    config = providers()["tts"]
    output.parent.mkdir(parents=True, exist_ok=True)
    command = config["command"] + ["--model", config["model"], "--text", selected["text"], "--voice", config["voice"], "--lang_code", config.get("lang_code", "auto"), "--instruct", selected["voice_direction"], "--output_path", str(output.parent), "--file_prefix", f"{episode}-{line_id}"]
    code, log, _ = run_logged(command, GENERATED / f"logs/{episode}-{line_id}-tts.log")
    candidates = sorted(
        (path for path in output.parent.glob(f"{episode}-{line_id}*.wav") if is_wav_file(path)),
        key=lambda path: path.stat().st_mtime_ns,
        reverse=True,
    )
    produced = candidates[0] if candidates else None
    if code != 0 or not produced:
        record(f"tts:{episode}:{line_id}", "failed", None, f"local mlx-audio generation failed; see {log}")
        raise RuntimeError(f"local mlx-audio generation failed; see {log}")
    if produced != output:
        produced.replace(output)
    write_sidecar(output, f"{episode}-{line_id}-audio", "audio", selected["text"], [f"runs/{RUN_SERIES}/{RUN_ID}/episodes/{episode}/script.json"], log)
    record(f"tts:{episode}:{line_id}", "succeeded", output.relative_to(ROOT).as_posix(), "generated by local mlx-audio")
    return output


def shot(episode, shot_id, force=False):
    validate()
    plan = load_json(RUN_ROOT / f"episodes/{episode}/shots.json")
    selected = next((item for item in plan["shots"] if item["id"] == shot_id), None)
    if not selected:
        raise ValueError(f"missing {episode}/{shot_id}")
    output = GENERATED / f"video/{episode}-{shot_id}.mp4"
    if output.exists() and not force:
        evidence = probe_video(output)
        record(f"shot:{episode}:{shot_id}", "succeeded", str(output.relative_to(ROOT)), f"existing output retained; duration {evidence['duration_sec']}s")
        return output
    source = agnes_key_source()
    if source is None or source.startswith("invalid"):
        detail = source or "no Agnes key source found"
        record(f"shot:{episode}:{shot_id}", "blocked", None, detail)
        raise RuntimeError(f"Agnes authentication unavailable: {detail}")
    concept_output = GENERATED / "images/taotao-concept.png"
    frame_rate = 24
    target_frames = float(selected.get("duration_sec", 5)) * frame_rate
    num_frames = max(9, min(441, round(target_frames / 8) * 8 + 1))
    command = providers()["video"]["command"] + [selected["video_prompt"], "--preset", "9:16", "--num-frames", str(num_frames), "--frame-rate", str(frame_rate), "--output", str(output)]
    source_assets = [f"runs/{RUN_SERIES}/{RUN_ID}/episodes/{episode}/shots.json"]
    continuity_from = selected.get("continuity_from")
    if continuity_from:
        source_episode = selected.get("continuity_from_episode") or episode
        input_frame = continuity_frame(source_episode, continuity_from)
        command += ["--mode", "i2v", "--input-image", str(input_frame)]
        source_assets += [
            f"runs/{RUN_ID}/generated/video/{source_episode}-{continuity_from}.mp4",
            input_frame.relative_to(ROOT).as_posix(),
        ]
    elif selected.get("generated_asset") == "taotao-concept" and concept_output.exists():
        command += ["--mode", "i2v", "--input-image", str(concept_output)]
        source_assets.append(f"runs/{RUN_SERIES}/{RUN_ID}/generated/images/taotao-concept.png")
    else:
        command += ["--mode", "ti2vid"]
    output.parent.mkdir(parents=True, exist_ok=True)
    code, log, _ = run_logged(command, GENERATED / f"logs/{episode}-{shot_id}-video.log")
    if code != 0 or not output.exists():
        record(f"shot:{episode}:{shot_id}", "failed", None, f"Agnes video generation failed; see {log}")
        raise RuntimeError(f"Agnes video generation failed; see {log}")
    evidence = probe_video(output)
    end_frame = continuity_frame(episode, shot_id)
    write_sidecar(output, selected["video_asset"], "video", selected["video_prompt"], source_assets, log)
    record(
        f"shot:{episode}:{shot_id}",
        "succeeded",
        output.relative_to(ROOT).as_posix(),
        f"Agnes key source: {source}; duration {evidence['duration_sec']}s; continuity frame {end_frame.relative_to(ROOT)}",
    )
    return output


def compile_check(episode=None):
    validate()
    episodes = [episode] if episode else load_json(RUN_ROOT / "story/series.json")["episodes"]
    successful_logs = []
    all_ok = True
    for item in episodes:
        command = providers()["render"]["command"] + ["verify", str(RUN_ROOT / f"episodes/{item}/storyboard.md")]
        code, log, _ = run_logged(command, GENERATED / f"logs/markcut-verify-{item}.log")
        if code != 0:
            all_ok = False
            record("render", "failed", log, f"Markcut verify failed for {item}")
            break
        successful_logs.append(log)
    if not all_ok:
        raise RuntimeError(f"Markcut verify failed; see {log}")
    record("render", "succeeded", successful_logs, "Markcut verify completed for all episode storyboards")
    return successful_logs


def resolved_storyboard(episode):
    script = load_json(RUN_ROOT / f"episodes/{episode}/script.json")
    plan = load_json(RUN_ROOT / f"episodes/{episode}/shots.json")
    lines_by_shot = {line.get("shot"): line for line in script["lines"] if line.get("shot")}
    out = GENERATED / f"{episode}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    rows = ["# video", "width:1080 height:1920 fps:24 layout:series", ""]
    for shot_item in plan["shots"]:
        shot_id = shot_item["id"]
        duration = shot_item["duration_sec"]
        video = GENERATED / f"video/{episode}-{shot_id}.mp4"
        if not video.is_file():
            raise RuntimeError(f"missing generated shot: {video.relative_to(ROOT)}")
        rows += [f"## {shot_id}", "layout:parallel", f"- video src:video/{video.name} duration:{duration} fit:cover"]
        line = lines_by_shot.get(shot_id)
        if line:
            audio = GENERATED / f"audio/{episode}-{line['id']}.wav"
            if not audio.is_file():
                raise RuntimeError(f"missing generated dialogue: {audio.relative_to(ROOT)}")
            rows.append(f"- audio src:audio/{audio.name} duration:{duration}")
        rows.append("")
    out.write_text("\n".join(rows), encoding="utf-8")
    record(f"assemble:{episode}", "succeeded", out.relative_to(ROOT).as_posix(), "resolved generated shots and dialogue into Markcut storyboard")
    return out


def media_render(episode):
    validate()
    storyboard = resolved_storyboard(episode)
    verify_command = providers()["render"]["command"] + ["verify", str(storyboard)]
    verify_code, verify_log, _ = run_logged(verify_command, GENERATED / f"logs/markcut-resolved-verify-{episode}.log")
    if verify_code != 0:
        record(f"render:{episode}", "failed", verify_log, "resolved Markcut storyboard verify failed")
        raise RuntimeError(f"resolved Markcut storyboard verify failed; see {verify_log}")
    output = GENERATED / f"video/{episode}-render.mp4"
    output.parent.mkdir(parents=True, exist_ok=True)
    command = providers()["render"]["command"] + [
        "render",
        str(storyboard),
        "--output",
        str(output),
    ]
    code, log, _ = run_logged(command, GENERATED / f"logs/markcut-render-{episode}.log")
    if code != 0 or not output.exists():
        record(f"render:{episode}", "failed", log, "Markcut media render failed")
        raise RuntimeError(f"Markcut media render failed; see {log}")
    evidence = probe_video(output)
    record(f"render:{episode}", "succeeded", output.relative_to(ROOT).as_posix(), f"Markcut media render completed; duration {evidence['duration_sec']}s; size {evidence['size_bytes']} bytes")
    return output


def audit_run(run_id, series=None):
    series = series or RUN_SERIES
    run_dir = ROOT / "runs" / series / run_id
    run_path = run_dir / "run.json"
    if not run_path.is_file():
        raise ValueError(f"missing run state: {run_path.relative_to(ROOT)}")
    run = load_json(run_path)
    episode = run.get("episode")
    episode_path = run_dir / f"{episode}.json" if episode else None
    if not episode_path or not episode_path.is_file():
        raise ValueError(f"run {run_id} has no valid episode state file")
    ep = load_json(episode_path)
    valid_states = set(workflow_config().get("states", []))
    errors = []
    warnings = []
    for label, payload in (("run", run), ("episode", ep)):
        state = payload.get("state")
        if state not in valid_states:
            errors.append(f"{label}.state {state!r} is not a configured Drama core state")
    if run.get("state") != ep.get("state"):
        errors.append(f"run/episode state mismatch: {run.get('state')} != {ep.get('state')}")
    stages = ep.get("stages", {})
    delivery = stages.get("delivery")
    if delivery and run.get("state") != "APPROVED":
        errors.append("external delivery is recorded but Drama core state is not APPROVED")
    if run.get("state") == "APPROVED" and stages.get("approval") != "approved":
        errors.append("core state is APPROVED but approval stage is not approved")
    if delivery and delivery != "delivered":
        warnings.append(f"external delivery stage is {delivery!r}; this does not change Drama core state")
    result = {"series": series, "run_id": run_id, "episode": episode, "core_state": run.get("state"), "delivery": delivery, "valid": not errors, "errors": errors, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if errors:
        raise RuntimeError(f"run audit failed with {len(errors)} error(s)")


def workflow_status():
    print(json.dumps({
        "workflow": workflow_config(),
        "agent_availability": workflow_agents(),
    }, ensure_ascii=False, indent=2))


def status():
    manifest = load_manifest()
    series = load_json(RUN_ROOT / "story/series.json")
    print(json.dumps({
        "project_root": str(ROOT),
        "series": RUN_SERIES,
        "run_id": RUN_ID,
        "run_root": str(RUN_ROOT),
        "episodes": series.get("episodes", []),
        "manifest": manifest,
        "agnes_key_source": agnes_key_source(),
        "workflow_version": workflow_config().get("version"),
        "agent_availability": workflow_agents(),
    }, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Resumable Neo drama pipeline")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("workflow")
    audit = sub.add_parser("audit-run")
    audit.add_argument("run_id")
    audit.add_argument("--series", default=RUN_SERIES)
    sub.add_parser("prepare")
    generate = sub.add_parser("generate")
    generate.add_argument("stage", choices=["concept", "tts", "shot"])
    generate.add_argument("--episode")
    generate.add_argument("--line")
    generate.add_argument("--shot")
    generate.add_argument("--force", action="store_true")
    render = sub.add_parser("render")
    render.add_argument("--episode")
    render.add_argument("--media", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "status":
            status()
        elif args.command == "workflow":
            workflow_status()
        elif args.command == "audit-run":
            audit_run(args.run_id, args.series)
        elif args.command == "prepare":
            validate()
            record("prepare", "succeeded", f"runs/{RUN_SERIES}/{RUN_ID}/story/series.json", "run source contracts validated")
            print("prepare: ok")
        elif args.command == "generate":
            if args.stage == "concept":
                concept(args.force)
            elif args.stage == "tts":
                if not args.episode or not args.line:
                    parser.error("generate tts requires --episode and --line")
                tts(args.episode, args.line, args.force)
            elif not args.episode or not args.shot:
                parser.error("generate shot requires --episode and --shot")
            else:
                shot(args.episode, args.shot, args.force)
        elif args.command == "render":
            if args.media:
                if not args.episode:
                    parser.error("render --media requires --episode")
                media_render(args.episode)
                print("Markcut media render: ok")
            compile_check(args.episode)
            print("render compile check: ok")
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
