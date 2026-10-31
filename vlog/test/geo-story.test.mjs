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
test('GPS absent is a normal episode, permission missing is a blocker',()=>{assert.equal(planGeoStory([]).required,false);assert.throws(()=>planGeoStory(sample),/GPS_DISCLOSURE_REQUIRED/);});
test('unverified place names and invented photo descriptions are excluded',()=>{let x=planGeoStory(sample,{disclosureApproved:true,mediaEvidence:[{source:'a.JPG',observed:'a dragon',evidenceRef:''}],locationEvidence:[{source:'a.JPG',name:'Imaginary Street',evidenceRef:'',status:'verified'}]});assert.doesNotMatch(x.scenes[1].text,/dragon|Imaginary/)});
