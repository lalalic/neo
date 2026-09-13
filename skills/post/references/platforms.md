# Platform adapters

These contracts come from the migrated `~/Workspace/.browser-harness.zip` post pipelines. Run through `scripts/post.py` unless debugging a single adapter.

## Xiaohongshu (XHS)

Entry:

```bash
python3 scripts/post.py xhs --video clip.mp4 --title "标题" --body "正文" --tags "旅行,日常" --publish
python3 scripts/post.py xhs --image a.jpg --image b.jpg --title "标题" --body "正文" --publish
```

Behavior:

- accepts either image(s) or one video, not both;
- title max 20 characters;
- body max 1000 characters;
- up to 18 images;
- up to 5 tags;
- without `--publish`, saves as draft;
- uses the authenticated `creator.xiaohongshu.com` session.

## WeChat Channels / 视频号

Entry:

```bash
python3 scripts/post.py wechat-channels --video clip.mp4 --desc "描述" --title "短标题" --tags "话题1,话题2" --publish
```

Behavior:

- video is required;
- description max 1000 characters;
- optional short title is 6-16 characters;
- without `--publish`, saves as draft;
- uses the authenticated `channels.weixin.qq.com` session and its wujie shadow DOM.

## TikTok

Entry:

```bash
python3 scripts/post.py tiktok --video clip.mp4 --caption "caption" --tags "fyp,vlog" --visibility public
```

Options include `--cover`, `--visibility public|friends|private`, `--no-comments`, `--no-duets`, and `--no-stitch`.

Behavior:

- video is required;
- caption including appended hashtags max 4000 characters;
- up to 10 tags;
- the migrated adapter performs the final Post action; there is no draft flag in this adapter.

## YouTube

Entry:

```bash
python3 scripts/post.py youtube --video clip.mp4 --title "Title" --desc "Description" --tags "vlog,daily" --public
```

Options include `--thumbnail`, `--private`, `--unlisted`, `--public`, and `--made-for-kids`.

Behavior:

- video and title are required;
- title max 100 characters;
- description max 5000 characters;
- tags max 500 characters total and 30 characters each;
- visibility defaults to `PRIVATE`;
- the adapter explicitly sets Made for Kids only when `--made-for-kids` is supplied.

## Why KDP is not bundled

The legacy archive also contains a KDP ebook draft uploader. It is intentionally not part of this `post` skill because it is a publishing workflow with book metadata and different safety semantics, not a social/vlog post target. The source remains in `~/Workspace/.browser-harness.zip` if a separate KDP publishing skill is needed later.
