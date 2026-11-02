import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRoutePoints,segmentRoute,publicRoutePoints,routeScene} from '../lib/gps-route.mjs';
const rows=[
 {SourceFile:'a.heic',GPSLatitude:43.6,GPSLongitude:-79.3,DateTimeOriginal:'2026:10:14 12:00:00',OffsetTimeOriginal:'-04:00'},
 {SourceFile:'b.mov','QuickTime:GPSCoordinates':'+43.7000-079.4000+000.0/',GPSDateTime:'2026:10:14 17:00:00'},
 {SourceFile:'missing.jpg',DateTimeOriginal:'2026:10:14 13:00:00'},
];
test('reads EXIF and QuickTime GPS with UTC-normalized capture time',()=>{
 const pts=extractRoutePoints(rows);
 assert.equal(pts.length,2);
 assert.equal(pts[0].capturedAt,'2026-10-14T16:00:00.000Z');
 assert.equal(pts[1].capturedAt,'2026-10-14T17:00:00.000Z');
 assert.equal(pts[1].timeProvenance,'gps-utc');
});
test('ambiguous local capture time cannot become trusted movement',()=>{
 const pts=extractRoutePoints([{SourceFile:'a',GPSLatitude:40,GPSLongitude:-79,DateTimeOriginal:'2026:10:14 12:00:00'}]);
 assert.equal(pts[0].timeStatus,'ambiguous');
 assert.equal(segmentRoute(pts).segments.length,0);
});
test('speed outliers rejected and large time gaps segmented',()=>{
 const pts=extractRoutePoints([...rows,{SourceFile:'teleport',GPSLatitude:10,GPSLongitude:10,GPSDateTime:'2026:10:14 17:01:00'},{SourceFile:'next',GPSLatitude:43.71,GPSLongitude:-79.41,GPSDateTime:'2026:10:15 02:00:00'}]);
 const {segments,rejected,trackedMovement}=segmentRoute(pts);
 assert.deepEqual(segments.map(s=>s.length),[2,1]);
 assert.equal(rejected[0].reason,'implausible-speed');
 assert.equal(trackedMovement,false);
});
test('source-authorized GPS keeps coordinate precision without a separate disclosure gate',()=>{
 const pts=extractRoutePoints(rows);
 const accurate=publicRoutePoints(pts);
 assert.equal(accurate[0].source,'a.heic');
 assert.equal(accurate[0].lat,43.6);
 assert.match(routeScene(accurate,{view:'cinematic'}),/map view:cinematic/);
 assert.doesNotMatch(routeScene(accurate),/travelMode/);
 assert.match(routeScene(accurate,{travelMode:'WALKING'}),/travelMode:WALKING/);
 const precise=publicRoutePoints([{source:'owner.jpg',lat:45.31234567,lng:-75.91234567}]);
 assert.equal(precise[0].lat,45.31234567);
 assert.equal(precise[0].lng,-75.91234567);
});
test('invalid coordinates rejected',()=>{
 assert.equal(extractRoutePoints([{SourceFile:'x',GPSLatitude:100,GPSLongitude:300,GPSDateTime:'2026:10:14 00:00:00'}]).length,0);
});
