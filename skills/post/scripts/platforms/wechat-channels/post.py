#!/usr/bin/env python3
"""
Post video to WeChat Channels (视频号) via browser-harness.

Requires login to https://channels.weixin.qq.com/ (scan QR code in Chrome first).
The page uses wujie micro-frontend with shadow DOM.

Usage:
  python3 wechat-channels-post.py --video /path/to/video.mp4 --desc "description"
  python3 wechat-channels-post.py --video vid.mp4 --desc "text" --title "short" --publish
  python3 wechat-channels-post.py --video vid.mp4 --desc "text" --tags "话题1,话题2"
"""
import argparse, json, os, sys, subprocess, tempfile

BH_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_post_bh.py")

# WeChat Channels limits
MAX_DESC = 1000       # chars
MIN_TITLE = 6         # short title min
MAX_TITLE = 16        # short title max
MAX_VIDEO_GB = 20     # GB
MAX_VIDEO_HOURS = 8   # hours

def main():
    p = argparse.ArgumentParser(description="Post video to WeChat Channels (视频号)")
    p.add_argument("--video", required=True, help="Video file path (MP4/H.264, max 20GB/8h)")
    p.add_argument("--desc", required=True, help=f"Video description (max {MAX_DESC} chars)")
    p.add_argument("--title", default="", help=f"Short title ({MIN_TITLE}-{MAX_TITLE} chars, overlay on video)")
    p.add_argument("--tags", default="", help="Comma-separated topic tags (appended as #话题 in desc)")
    p.add_argument("--publish", action="store_true", help="Publish immediately")
    p.add_argument("--draft", action="store_true", help="Save as draft (default)")
    args = p.parse_args()

    video = os.path.abspath(args.video)
    if not os.path.exists(video):
        sys.exit(f"Video not found: {video}")

    # Validate description
    if len(args.desc) > MAX_DESC:
        sys.exit(f"Description too long: {len(args.desc)} chars (max {MAX_DESC})")

    # Validate short title
    if args.title:
        if len(args.title) < MIN_TITLE:
            sys.exit(f"Short title too short: {len(args.title)} chars (min {MIN_TITLE})")
        if len(args.title) > MAX_TITLE:
            sys.exit(f"Short title too long: {len(args.title)} chars (max {MAX_TITLE})")

    # Parse tags
    tags = [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags else []

    cfg = {
        "video": video, "desc": args.desc, "title": args.title,
        "tags": tags, "publish": args.publish,
    }
    cfg_f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(cfg, cfg_f, ensure_ascii=False); cfg_f.close()

    with open(BH_SCRIPT) as f:
        code = f.read().replace("__CFG_PATH__", cfg_f.name)

    try:
        r = subprocess.run(["browser-harness", "-c", code], timeout=900)
        sys.exit(r.returncode)
    finally:
        os.unlink(cfg_f.name)

if __name__ == "__main__":
    main()
