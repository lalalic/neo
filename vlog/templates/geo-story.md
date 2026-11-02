# video
width:{{width}} height:{{height}} fps:30 layout:series transition:fade transitionTime:0.25 stt:false

{{scenes}}

<!-- VLOG:MAP_SCENE:BEGIN -->
## {{scene.id}}
layout:parallel
instruction:{{scene.instruction}}
{{scene.map}}
- audio src:{{scene.audio.path}} duration:{{scene.audio.duration}} volume:1
<!-- VLOG:MAP_SCENE:END -->

<!-- VLOG:MAP_OVERVIEW:BEGIN -->
- map view:overview duration:{{duration}} mapType:satellite center:{lat:{{center.lat}},lng:{{center.lng}}} camera:{zoom:tween(10,13,easeInOut)}
<!-- VLOG:MAP_OVERVIEW:END -->

<!-- VLOG:MAP_ROUTE:BEGIN -->
- map view:route duration:{{duration}} mapType:roadmap{{travelMode}} routeMarker:"📍" waypoints:[{{waypoints}}]
<!-- VLOG:MAP_ROUTE:END -->
