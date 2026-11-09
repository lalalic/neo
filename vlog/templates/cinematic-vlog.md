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
    "bgm_plain_volume": 1.0,
    "bgm_preducked_volume": 1.0
  },
  "brand": {
    "title": "给生活加点料",
    "scene_id": "Brand-Intro",
    "duration_seconds": 2.05,
    "sound": "assets/brand/brand-three-taps.wav",
    "voice": "assets/brand/brand-intro-voice.mp3",
    "voice_source": "Worknode Qwen3-TTS CustomVoice; generated, not owner-recorded"
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

<!-- VLOG:TEMPLATE:cinematic-vlog-v1 -->
# video
title:{{variant}}
width:{{width}} height:{{height}} fps:{{fps}} layout:series{{transition}}{{subtitle}} stt:"" metadata:{{metadata}}

<!-- Root BGM is a PREPARED bed (voice windows and optional SFX mixed beforehand). -->
- audio src:{{music.path}} isBackground:true volume:1.0

<!-- VLOG:BRAND_IDENT:BEGIN -->
## Brand-Intro
layout:parallel
- component duration:2.05 jsx:"<div style={{height:'100%',width:'100%',display:'flex',justifyContent:'center',alignItems:'center',background:'#152436',color:'#ffffff',fontFamily:'Arial, sans-serif',fontSize:64,fontWeight:800,letterSpacing:5}}>给生活加点料</div>"
- audio src:assets/brand/brand-three-taps.wav duration:0.96 volume:0.25
- audio src:assets/brand/brand-intro-voice.mp3 duration:1.92 volume:1
<!-- VLOG:BRAND_IDENT:END -->

{{scenes}}
