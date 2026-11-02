import test from 'node:test';
import assert from 'node:assert/strict';
import {planGeoStory,geoStoryMarkdown} from '../lib/geo-story.mjs';
const sample=[{SourceFile:'a.JPG',GPSLatitude:45.347,GPSLatitudeRef:'N',GPSLongitude:75.911,GPSLongitudeRef:'W',GPSDateTime:'2026:09:25 17:00:00'},
 {SourceFile:'b.JPG',GPSLatitude:45.320,GPSLatitudeRef:'N',GPSLongitude:75.928,GPSLongitudeRef:'W',GPSDateTime:'2026:09:25 22:30:00'}];
test('verified photo coordinates form a story, not invented travel',()=>{
 const x=planGeoStory(sample,{disclosureApproved:true,mediaEvidence:[{source:'a.JPG',observed:'蓝天和秋树',evidenceRef:'vision-a'},{source:'b.JPG',observed:'桌上的饮料',evidenceRef:'vision-b'}],locationEvidence:[{source:'a.JPG',name:'卡纳塔',evidenceRef:'geocoder-a',status:'verified'}]});
 assert.equal(x.required,true);assert.equal(x.scenes.length,2);assert.match(x.scenes[1].text,/蓝天和秋树/);assert.match(x.scenes[1].text,/导航参考/);assert.doesNotMatch(x.scenes[1].text,/驾驶|开车|回家/);assert.match(x.scenes[1].text,/卡纳塔/);
 assert.equal(x.points[0].lng,-75.911);assert.equal(x.points[1].lng,-75.928);
 const md=geoStoryMarkdown(x,{audioFiles:[{path:'assets/intro.mp3',duration:4},{path:'assets/route.mp3',duration:12}]});assert.match(md,/view:overview/);assert.match(md,/view:route/);assert.equal((md.match(/- audio src:/g)||[]).length,2);
});
test('GPS absent is normal; source-authorized location needs no separate gate',()=>{assert.equal(planGeoStory([]).required,false);assert.equal(planGeoStory(sample).required,true);});
test('unverified place names and invented photo descriptions are excluded',()=>{let x=planGeoStory(sample,{disclosureApproved:true,mediaEvidence:[{source:'a.JPG',observed:'a dragon',evidenceRef:''}],locationEvidence:[{source:'a.JPG',name:'Imaginary Street',evidenceRef:'',status:'verified'}]});assert.doesNotMatch(x.scenes[1].text,/dragon|Imaginary/)});

test('all credible recorded stops appear in order with verified local knowledge',()=>{
 const three=[sample[0],{SourceFile:'middle.JPG',GPSLatitude:45.3301234,GPSLongitude:-75.9234567,GPSDateTime:'2026:09:25 19:30:00'},sample[1]];
 const x=planGeoStory(three,{locationEvidence:[{source:'middle.JPG',name:'沿途地标',status:'verified',evidenceRef:'maps-place-1',fact:'这座公园有一条河流步道',factEvidenceRef:'parks-source-1'}],routeEvidence:{status:'verified',provider:'Google Maps',evidenceRef:'directions-1',distanceKm:12.3},travelMode:'WALKING'});
 assert.equal(x.points.length,3);
 assert.equal(x.points[1].lng,-75.9234567);
 assert.match(x.scenes[1].map,/45.3301234,-75.9234567/);
 assert.match(x.scenes[1].map,/travelMode:WALKING/);
 assert.match(x.scenes[1].text,/河流步道/);
 assert.match(x.scenes[1].text,/12.3公里/);
 assert.deepEqual(x.factEvidenceUsed,['parks-source-1']);
 assert.equal(x.routeEvidenceUsed,'directions-1');
 const notVerified=planGeoStory(three,{locationEvidence:[{source:'middle.JPG',name:'景点',status:'verified',evidenceRef:'map-source',fact:'捏造历史知识'}]});
 assert.doesNotMatch(notVerified.scenes[1].text,/捏造历史知识/);
});
test('separate GPS time intervals cannot be joined into one fabricated route',()=>{
 const separate=[...sample,{SourceFile:'later.JPG',GPSLatitude:45.15,GPSLongitude:-75.5,GPSDateTime:'2026:09:26 18:30:00'}];
 const x=planGeoStory(separate);
 assert.equal(x.points.length,2);
 assert.doesNotMatch(x.scenes[1].map,/45.15/);
});

test('multiple plausible route intervals cannot be silently reduced to the longest',()=>{
 const separate=[...sample,{SourceFile:'later-a.JPG',GPSLatitude:45.25,GPSLongitude:-75.8,GPSDateTime:'2026:09:26 18:30:00'},{SourceFile:'later-b.JPG',GPSLatitude:45.26,GPSLongitude:-75.81,GPSDateTime:'2026:09:26 19:30:00'}];
 assert.throws(()=>planGeoStory(separate),/MULTIPLE_ROUTE_INTERVALS/);
});
