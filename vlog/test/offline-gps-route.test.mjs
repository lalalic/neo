import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderOfflineRoute,routeSvg,trustedStops } from '../scripts/render-offline-route.mjs';
import { verifiedOfflineGeoRoute } from '../lib/cinematic-episode.mjs';

function fixture(t) {
  const dir=resolve(import.meta.dirname,'../runs');
  mkdirSync(dir,{recursive:true});
  const root=join(dir,'2026-11-07-offline-test-'+randomUUID().slice(0,8));
  mkdirSync(root);
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'assets','narration','chattts-male'),{recursive:true});
  const media=[
    {id:'001',original_location:{latitude:45.32,longitude:-75.89}},
    {id:'003',original_location:{latitude:45.325,longitude:-75.885}},
    {id:'017',original_location:{latitude:45.334,longitude:-75.881}},
  ].map(x=>({...x,sha256:'a'.repeat(64),identity_verified:'sha256_exact',use_approved:true}));
  const manifest={source_use:{approved:true,scope:'private render only'},media};
  const intent={decision:'include',observedStops:media.map(x=>({sourceId:x.id,evidenceRef:x.id}))};
  writeFileSync(join(root,'source-manifest.json'),JSON.stringify(manifest));
  writeFileSync(join(root,'route-intent.json'),JSON.stringify(intent));
  const voice=join(root,'assets','narration','chattts-male','route.m4a');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
    '-i','sine=frequency=490:duration=1.3','-c:a','aac','-b:a','96k',voice]);
  return {root,manifest,intent,voice};
}

test('trusted GPS positions come only from explicitly selected, approved original source IDs',()=>{
 const manifest={source_use:{approved:true,scope:'private test'},media:[
  {id:'01',use_approved:true,identity_verified:'sha256_exact',sha256:'1'.repeat(64),original_location:{latitude:45.3,longitude:-75.9}},
  {id:'02',use_approved:true,identity_verified:'sha256_exact',sha256:'2'.repeat(64),original_location:{latitude:45.4,longitude:-75.8}}
 ]};
 const intent={decision:'include',observedStops:[{sourceId:'01',evidenceRef:'src01'},{sourceId:'02',evidenceRef:'src02'}]};
 assert.equal(trustedStops(manifest,intent).length,2);
 assert.throws(()=>trustedStops(manifest,{...intent,observedStops:[intent.observedStops[0],intent.observedStops[0]]}),/duplicate/);
 assert.throws(()=>trustedStops({...manifest,source_use:{approved:false,scope:'private'}},intent),/approved/);
 assert.throws(()=>trustedStops({...manifest,media:[{...manifest.media[0],identity_verified:'unknown'},manifest.media[1]]},intent),/hash-verified/);
 const schematic=routeSvg(trustedStops(manifest,intent));
 assert.match(schematic,/不代表真实行进轨迹/);
 assert.doesNotMatch(schematic,/<polyline/);
});

test('offline SVG route renders real MP4 with AAC narration and validates content-linked Commit evidence',async t=>{
 const f=fixture(t),result=renderOfflineRoute({run:f.root});
 assert.equal(result.status,'PASS');
 assert.equal(result.noMapsApi,true);
 assert.equal(result.observedStops,3);
 assert.equal(existsSync(join(f.root,'assets','route.mp4')),true);
 assert.equal(existsSync(join(f.root,'assets','geo-story','recorded-stops.svg')),true);
 const evidence=JSON.parse(readFileSync(join(f.root,'assets','geo-story','evidence.json'),'utf8'));
 assert.equal(evidence.declaredNoTravelTrack,true);
 assert.equal(evidence.observedPoints.length,3);
 const codec=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type:format=duration',
   '-of','json',join(f.root,'assets','route.mp4')],{encoding:'utf8'}));
 assert.equal(codec.streams.some(x=>x.codec_type==='audio'),true);
 assert.equal(codec.streams.some(x=>x.codec_type==='video'),true);
 assert.ok(Number(codec.format.duration)>1.3);
 const story={required:true,points:evidence.observedPoints.map(({lat,lng})=>({lat,lng}))};
 const bound=await verifiedOfflineGeoRoute(f.root,{
  offlineRoutePath:'assets/route.mp4',offlineEvidencePath:'assets/geo-story/evidence.json'},story);
 assert.equal(bound.sha256,evidence.videoSha256);
 assert.equal(bound.kind,'offline-source-gps-schematic');
 assert.throws(()=>renderOfflineRoute({run:f.root}),/already exists/);
 await assert.rejects(()=>verifiedOfflineGeoRoute(f.root,{
   offlineRoutePath:'assets/route.mp4',offlineEvidencePath:'assets/geo-story/evidence.json'},
  {...story,points:[{lat:12,lng:12},...story.points.slice(1)]}),/OFFLINE_ROUTE_EVIDENCE/);
});
