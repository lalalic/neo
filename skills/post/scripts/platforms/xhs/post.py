#!/usr/bin/env python3
"""
Auto-post to XiaoHongShu (小红书) via browser-harness.
No AI tokens — runs entirely locally in a SINGLE browser-harness process.

Supports both image+text and video posts.

Usage (image):
  python3 xhs-post.py --image photo.jpg --title "我的标题" --body "正文内容"
  python3 xhs-post.py --image photo.jpg --image photo2.jpg --title "标题" --body "正文" --publish

Usage (video):
  python3 xhs-post.py --video clip.mp4 --title "标题" --body "描述"
  python3 xhs-post.py --video clip.mp4 --title "标题" --body "描述" --tags "旅行,美食" --publish
"""
import argparse, json, os, sys, subprocess, tempfile

BH_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_post_bh.py")

# XHS limits
MAX_TITLE = 20    # chars (CJK counts as 1)
MAX_BODY = 1000   # chars
MAX_IMAGES = 18   # max images per post
MAX_TAGS = 5      # max hashtag topics

def main():
    p = argparse.ArgumentParser(description="Auto-post to XiaoHongShu (image or video)")
    p.add_argument("--image", action="append", help="Image file (jpg/png/webp). Repeat for multiple.")
    p.add_argument("--video", help="Video file (mp4). Mutually exclusive with --image.")
    p.add_argument("--title", required=True, help=f"Post title (max {MAX_TITLE} chars)")
    p.add_argument("--body", required=True, help=f"Post body/description (max {MAX_BODY} chars)")
    p.add_argument("--tags", default="", help="Comma-separated topic tags (max 5, e.g. '旅行,美食')")
    p.add_argument("--publish", action="store_true", help="Publish (default: draft)")
    args = p.parse_args()

    if not args.image and not args.video:
        sys.exit("Must provide --image or --video")
    if args.image and args.video:
        sys.exit("Cannot use both --image and --video")

    mode = "video" if args.video else "image"

    # Validate media files
    images = []
    video = ""
    if mode == "image":
        for img in args.image:
            path = os.path.abspath(img)
            if not os.path.exists(path):
                sys.exit(f"Image not found: {path}")
            images.append(path)
        if len(images) > MAX_IMAGES:
            sys.exit(f"Too many images: {len(images)} (max {MAX_IMAGES})")
    else:
        video = os.path.abspath(args.video)
        if not os.path.exists(video):
            sys.exit(f"Video not found: {video}")

    # Validate title
    if len(args.title) > MAX_TITLE:
        sys.exit(f"Title too long: {len(args.title)} chars (max {MAX_TITLE})")

    # Validate body
    if len(args.body) > MAX_BODY:
        sys.exit(f"Body too long: {len(args.body)} chars (max {MAX_BODY})")

    # Parse tags
    tags = [t.strip() for t in args.tags.split(",") if t.strip()] if args.tags else []
    if len(tags) > MAX_TAGS:
        sys.exit(f"Too many tags: {len(tags)} (max {MAX_TAGS})")

    cfg = {
        "mode": mode,
        "image": images[0] if images else "",
        "images": images,
        "video": video,
        "title": args.title, "body": args.body, "tags": tags,
        "action": "publish" if args.publish else "draft",
    }
    cfg_f = tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False)
    json.dump(cfg, cfg_f, ensure_ascii=False); cfg_f.close()

    with open(BH_SCRIPT) as f:
        code = f.read().replace("__CFG_PATH__", cfg_f.name)

    try:
        timeout = 300 if mode == "video" else 120
        r = subprocess.run(["browser-harness", "-c", code], timeout=timeout)
        sys.exit(r.returncode)
    finally:
        os.unlink(cfg_f.name)

if __name__ == "__main__":
    main()
