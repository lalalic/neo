# video
width:1920 height:1080 fps:30 layout:series

## profiles
title:"Reveal profiles" instruction:"Each child has a distinct profile"
<!-- execution {"id":"profiles-demo","type":"demo","scene_id":"profiles","output":"assets/profiles-demo.mp4","identity":{"product":"Family Tutor","surface":"extension popup","feature":"kids list"},"intent":{"purpose":"Reveal separate learning spaces","communicates":"Each child has a distinct profile"},"required_visible_evidence":["Two named child profiles are visible"],"success":{"fresh_ui_required":true,"visible_state":"Two named child profiles are visible"},"presentation":{"focus":"kids list","highlight":["profile rows"],"text":["One profile per child"],"zoom":"emphasis","duration_seconds":6},"autonomy":{"allowed_recovery":["reopen product surface"],"boundary":"Stop if fresh UI cannot verify the state."}} -->
- video src:"assets/profiles-demo.mp4" duration:6

## presenter
<!-- execution {"id":"presenter-hook","type":"capture","scene_id":"presenter","output":"assets/presenter-hook.mov","capture_kind":"human","description":"Presenter delivers the opening line to camera."} -->
- video src:"assets/presenter-hook.mov" duration:4

## architecture
<!-- execution {"id":"architecture-image","type":"image","scene_id":"architecture","output":"assets/architecture.png","prompt":"Clean diagram of the product architecture."} -->
- image src:"assets/architecture.png" duration:4

## transition
<!-- execution {"id":"ambient-transition","type":"video","scene_id":"transition","output":"assets/ambient-transition.mp4","prompt":"Short subtle product-themed transition clip."} -->
- video src:"assets/ambient-transition.mp4" duration:3
