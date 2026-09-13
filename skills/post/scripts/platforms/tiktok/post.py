#!/usr/bin/env python3
"""
Auto-upload video to TikTok via browser-harness.
No AI tokens — runs entirely locally in a SINGLE browser-harness process.

Requires login to TikTok in Chrome first.

Usage:
  python3 tiktok-post.py --video clip.mp4 --caption "Check this out! #fyp #viral"
  python3 tiktok-post.py --video clip.mp4 --caption "My video" --tags "fyp,viral,trending"
  python3 tiktok-post.py --video clip.mp4 --caption "My video" --visibility friends
"""
import argparse, json, os, sys, subprocess, tempfile

BH_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_post_bh.py")

# TikTok limits
MAX_CAPTION = 4000    # chars (including hashtags)
MAX_TAGS = 10         # max hashtags

def main():
    p = argparse.ArgumentParser(description="Auto-upload video to TikTok")
    p.add_argument("--video", required=True, help="Video file path (MP4, max 10min/10GB)")
    p.add_argument("--caption", required=True, help=f"Video caption (max {MAX_CAPTION} chars, including hashtags)")
    p.add_argument("--tags", default="", help=f"Comma-separated hashtags (max {MAX_TAGS}, appended to caption)")
    p.add_argument("--cover", default="", help="Custom cover image (jpg/png)")
    p.add_argument("--visibility", default="public", choices=["public", "friends", "private"],
                   help="Visibility: public (default), friends, private")
    p.add_argument("--no-comments", action="store_true", help="Disable comments")
    p.add_argument("--no-duets", action="store_true", help="Disable duets")
    p.add_argument("--no-stitch", action="store_true", help="Disable stitch")
    args = p.parse_args()

    video = os.path.abspath(args.video)
    if not os.path.exists(video):
        sys.exit(f"Video not found: {video}")

    # Parse and validate tags
    tags = [t.strip().lstrip("#") for t in args.tags.split(",") if t.strip()] if args.tags else []
    if len(tags) > MAX_TAGS:
        sys.exit(f"Too many tags: {len(tags)} (max {MAX_TAGS})")

    # Build full caption with tags
    caption = args.caption
    if tags:
        tag_str = " " + " ".join(f"#{t}" for t in tags)
        caption = caption + tag_str

    # Validate total caption length
    if len(caption) > MAX_CAPTION:
        sys.exit(f"Caption too long (with tags): {len(caption)} chars (max {MAX_CAPTION})")

    # Validate cover
    cover = ""
    if args.cover:
        cover = os.path.abspath(args.cover)
        if not os.path.exists(cover):
            sys.exit(f"Cover image not found: {cover}")

    cfg = {
        "video": video, "caption": caption, "cover": cover,
        "visibility": args.visibility,
        "allow_comments": not args.no_comments,
        "allow_duets": not args.no_duets,
        "allow_stitch": not args.no_stitch,
    }
    cfg_f = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
    json.dump(cfg, cfg_f, ensure_ascii=False); cfg_f.close()

    with open(BH_SCRIPT) as f:
        code = f.read().replace("__CFG_PATH__", cfg_f.name)

    try:
        r = subprocess.run(["browser-harness", "-c", code], timeout=600)
        sys.exit(r.returncode)
    finally:
        os.unlink(cfg_f.name)

if __name__ == "__main__":
    main()
