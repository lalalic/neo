#!/usr/bin/env python3
"""
Auto-upload video to YouTube via browser-harness.
No AI tokens — runs entirely locally in a SINGLE browser-harness process.

Usage:
  python3 yt-post.py --video clip.mp4 --title "My Video" --desc "Description" --private
  python3 yt-post.py --video clip.mp4 --title "Title" --unlisted
  python3 yt-post.py --video clip.mp4 --title "Title" --tags "tag1,tag2" --thumbnail cover.jpg --public
"""
import argparse, json, os, sys, subprocess, tempfile
from pathlib import Path

BH_SCRIPT = Path(__file__).resolve().parents[4] / "browser-platforms/platforms/youtube/browser-harness/_post_bh.py"

# YouTube limits
MAX_TITLE = 100      # chars
MAX_DESC = 5000      # chars
MAX_TAGS_TOTAL = 500 # total chars for all tags combined
MAX_TAG_SINGLE = 30  # chars per tag

def main():
    p = argparse.ArgumentParser(description="Auto-upload video to YouTube")
    p.add_argument("--video", required=True, help="Path to video file")
    p.add_argument("--title", required=True, help=f"Video title (max {MAX_TITLE} chars)")
    p.add_argument("--desc", default="", help=f"Video description (max {MAX_DESC} chars)")
    p.add_argument("--tags", default="", help=f"Comma-separated tags (max {MAX_TAGS_TOTAL} total chars)")
    p.add_argument("--thumbnail", default="", help="Custom thumbnail image (jpg/png, max 2MB)")
    p.add_argument("--private", action="store_const", const="PRIVATE", dest="vis")
    p.add_argument("--unlisted", action="store_const", const="UNLISTED", dest="vis")
    p.add_argument("--public", action="store_const", const="PUBLIC", dest="vis")
    p.set_defaults(vis="PRIVATE")
    p.add_argument("--made-for-kids", action="store_true",
                   help="Mark as Made for Kids (COPPA — REQUIRED for children's content)")
    args = p.parse_args()

    video = os.path.abspath(args.video)
    if not os.path.exists(video):
        sys.exit(f"Video not found: {video}")

    # Validate title
    if len(args.title) > MAX_TITLE:
        sys.exit(f"Title too long: {len(args.title)} chars (max {MAX_TITLE})")

    # Validate description
    if len(args.desc) > MAX_DESC:
        sys.exit(f"Description too long: {len(args.desc)} chars (max {MAX_DESC})")

    # Parse and validate tags
    tags = [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags else []
    total_tag_len = sum(len(t) for t in tags)
    if total_tag_len > MAX_TAGS_TOTAL:
        sys.exit(f"Tags too long: {total_tag_len} total chars (max {MAX_TAGS_TOTAL})")
    for t in tags:
        if len(t) > MAX_TAG_SINGLE:
            sys.exit(f"Tag '{t}' too long: {len(t)} chars (max {MAX_TAG_SINGLE})")

    # Validate thumbnail
    thumbnail = ""
    if args.thumbnail:
        thumbnail = os.path.abspath(args.thumbnail)
        if not os.path.exists(thumbnail):
            sys.exit(f"Thumbnail not found: {thumbnail}")

    cfg = {
        "video": video, "title": args.title, "desc": args.desc,
        "tags": tags, "thumbnail": thumbnail, "vis": args.vis,
        "made_for_kids": bool(args.made_for_kids),
    }
    cfg_f = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
    json.dump(cfg, cfg_f, ensure_ascii=False); cfg_f.close()

    with open(BH_SCRIPT) as f:
        code = f.read().replace("__CFG_PATH__", cfg_f.name)

    try:
        r = subprocess.run(["browser-harness", "-c", code], timeout=300)
        sys.exit(r.returncode)
    finally:
        os.unlink(cfg_f.name)

if __name__ == "__main__":
    main()
