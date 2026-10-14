import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRoutePoints,routeScene} from '../lib/gps-route.mjs';
test('uses only actual media GPS and orders by capture time',()=>{
 const points=extractRoutePoints([
  {SourceFile:'b.mov',GPSLatitude:43.7,GPSLongitude:-79.4,DateTimeOriginal:'2026:10:14 14:00:00'},
  {SourceFile:'a.heic',GPSLatitude:43.6,GPSLongitude:-79.3,DateTimeOriginal:'2026:10:14 12:00:00'},
  {SourceFile:'c.jpg',DateTimeOriginal:'2026:10:14 13:00:00'},
 ]);
 assert.deepEqual(points.map(x=>x.source),['a.heic','b.mov']);
 assert.match(routeScene(points),/map view:route duration:7/);
 assert.doesNotMatch(routeScene(points),/travelMode:/);
 assert.match(routeScene(points),/43.6,-79.3/);
});
test('does not fabricate routes without sufficient coordinates',()=>{
 assert.throws(()=>routeScene([]),/INSUFFICIENT_GPS/);
 assert.deepEqual(extractRoutePoints([{SourceFile:'bad.jpg',GPSLatitude:100,GPSLongitude:200,CreateDate:'2026:10:14 12:00:00'}]),[]);
});
