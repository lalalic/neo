import test from 'node:test';
import assert from 'node:assert/strict';
import {planRouteSubvideo,assertRouteIncluded} from '../lib/route-subvideo.mjs';
const pts=[{SourceFile:'a',GPSDateTime:'2026:10:14 12:00:00',GPSLatitude:43.6,GPSLongitude:-79.3},{SourceFile:'b',GPSDateTime:'2026:10:14 13:00:00',GPSLatitude:43.7,GPSLongitude:-79.4}];
test('no GPS skips subvideo',()=>assert.equal(planRouteSubvideo([]).required,false));
test('unapproved coordinates never enter a published route',()=>{const p=planRouteSubvideo(pts);assert.equal(p.required,false);assert.equal(p.videoMd,null)});
test('verified approved GPS requires a 9s subvideo',()=>{const p=planRouteSubvideo(pts,{disclosureApproved:true});assert.equal(p.required,true);assert.match(p.videoMd,/map view:route duration:9/);assert.throws(()=>assertRouteIncluded(p,'# video'),/ROUTE_RENDER_NOT_VERIFIED/);assert.throws(()=>assertRouteIncluded(p,'# video',{renderVerified:true}),/REQUIRED_GPS_ROUTE_MISSING/);assert.equal(assertRouteIncluded(p,'- video src:assets\/route.mp4 duration:9',{renderVerified:true}),true)});
test('unsafe partial route cannot force a fake map',()=>assert.equal(planRouteSubvideo(pts.slice(0,1),{disclosureApproved:true}).required,false));
