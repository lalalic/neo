<!-- VLOG:CONFIG
{
  "id": "cinematic-vlog-v1",
  "variants": [
    "cinematic-vlog-v1",
    "cinematic-vlog-v1-cuts"
  ],
  "song": {
    "title": "Good Times",
    "artist": "Rynn",
    "provider": "Artlist",
    "vocal_track_id": "133995",
    "vocal_url": "https://artlist.io/royalty-free-music/song/good-times/133995",
    "vocal_file": "assets/music/good-times-rynn-vocal.mp3",
    "instrumental_track_id": "133996",
    "instrumental_url": "https://artlist.io/royalty-free-music/song/good-times-instrumental-version/133996",
    "instrumental_file": "assets/music/good-times-rynn-instrumental.mp3",
    "license_status": "unverified",
    "note": "Use one authorized pre-mixed continuous asset for vocal opening, instrumental speech and vocal ending; this selection does not grant publication rights"
  },
  "format": {
    "width": 1080,
    "height": 1920,
    "fps": 30
  },
  "audio": {
    "source_video_volume": 0.72,
    "bgm_plain_volume": 0.18,
    "bgm_preducked_volume": 0.9
  },
  "pacing": {
    "hook_seconds": [
      1,
      3
    ],
    "closing_seconds": [
      2,
      5
    ]
  },
  "motions": {
    "slowPush": {"start": "scale(1.02)", "end": "scale(1.08)"},
    "zoomOut": {"start": "scale(1.12)", "end": "scale(1.02)"},
    "driftLeft": {"start": "scale(1.12) translateX(2%)", "end": "scale(1.12) translateX(-2%)"},
    "driftRight": {"start": "scale(1.12) translateX(-2%)", "end": "scale(1.12) translateX(2%)"}
  },
  "transitions": {
    "supported": [
      "cut",
      "fade",
      "slide",
      "wipe",
      "flip",
      "clockWipe"
    ],
    "default_seconds": 0.25
  }
}
VLOG:END_CONFIG -->

# video
title:{{variant}}
width:{{width}} height:{{height}} fps:{{fps}} layout:series{{transition}}{{subtitle}} stt:"" metadata:{{metadata}}

- audio src:{{music.path}} isBackground:true volume:{{music.volume}}

{{scenes}}

<!-- VLOG:SCENE_HOOK:BEGIN -->
## {{scene.id}}
layout:parallel
instruction:{{scene.instruction}}
{{scene.media}}
<!-- VLOG:SCENE_HOOK:END -->

<!-- VLOG:SCENE_BODY:BEGIN -->
## {{scene.id}}
layout:parallel
instruction:{{scene.instruction}}
{{scene.media}}
<!-- VLOG:SCENE_BODY:END -->

<!-- VLOG:SCENE_CLOSING:BEGIN -->
## {{scene.id}}
layout:parallel
instruction:{{scene.instruction}}
{{scene.media}}
<!-- VLOG:SCENE_CLOSING:END -->

<!-- VLOG:VIDEO:BEGIN -->
- video src:{{scene.path}} duration:{{scene.duration}} volume:{{scene.volume}}
<!-- VLOG:VIDEO:END -->

<!-- VLOG:IMAGE_MOTION:BEGIN -->
- image src:{{scene.path}} duration:{{scene.duration}} fit:cover{{scene.background}} effects:[{"animation":"custom","duration":{{scene.duration}},"customKeyframes":{"0":{"transform":{{scene.motionStart}}},"100":{"transform":{{scene.motionEnd}}}}}]
<!-- VLOG:IMAGE_MOTION:END -->

<!-- VLOG:IMAGE_STATIC:BEGIN -->
- image src:{{scene.path}} duration:{{scene.duration}} fit:cover{{scene.background}}
<!-- VLOG:IMAGE_STATIC:END -->

<!-- VLOG:VOICE:BEGIN -->
- audio src:{{scene.audio.path}} duration:{{scene.audio.duration}} volume:1
<!-- VLOG:VOICE:END -->

<!-- VLOG:SUBTITLE:BEGIN -->
 subtitle:{type:"Fade",fontSize:48,fontFamily:"Arial, sans-serif",style:"align-items:flex-end;justify-content:center;padding:0 10% 12% 10%",src:{{captions.path}}}
<!-- VLOG:SUBTITLE:END -->
