// Synthetic contract exercise ONLY: never an Episode Task, video render, approval or publish.
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {optionalRouteScene} from '../lib/gps-route.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const out=process.argv[2] ?? join(root,'runs/2026-10-20/synthetic-story-first-pilot');
const points=[{SourceFile:'fixture-a',GPSLatitude:43.6,GPSLongitude:-79.3,GPSDateTime:'2026:10:14 12:00:00'},{SourceFile:'fixture-b',GPSLatitude:43.7,GPSLongitude:-79.4,GPSDateTime:'2026:10:14 13:00:00'}];
const cases=[{name:'no-gps',sources:[{SourceFile:'fixture-a'},{SourceFile:'fixture-b'}],allowMap:false},{name:'gps-enhanced',sources:points,allowMap:true}];
for(const c of cases){
 const dir=join(out,c.name);mkdirSync(dir,{recursive:true});
 const route=optionalRouteScene(c.sources,{disclosureApproved:c.allowMap,precision:2});
 const story={kind:'SYNTHETIC_CONTRACT_TEST_NOT_AN_EPISODE',sourceIds:['fixture-a','fixture-b'],beats:[{role:'hook',sourceId:'fixture-a',label:'虚构开场占位符'},{role:'development',sourceId:'fixture-b',label:'虚构发展占位符'},{role:'payoff',sourceId:'fixture-b',label:'虚构收束占位符'}],mapIncluded:route.included,routeEvidenceType:route.evidence.evidenceType,trackedMovement:false,status:'DRAFT_ONLY',productionReady:false,publishAuthorized:false};
 const record={...story,routeReason:route.reason,routeScene:route.scene,syntheticCoordinates:route.included?'synthetic demonstration only':null,checks:{sourceLinked:story.beats.every(b=>story.sourceIds.includes(b.sourceId)),threeBeats:story.beats.length===3,noFakeTravel:!story.trackedMovement,noPublish:!story.publishAuthorized,noProductionClaim:!story.productionReady}};
 if(!Object.values(record.checks).every(Boolean)||route.included!==c.allowMap)throw Error('synthetic assertion failed: '+c.name);
 writeFileSync(join(dir,'assertions.json'),JSON.stringify(record,null,2)+'\n');
 writeFileSync(join(dir,'story.md'),`# SYNTHETIC QA ONLY — ${c.name}\n\nNot real media, an episode, a verified location, or a Markcut render.\n\n- HOOK (fixture-a): 虚构开场占位符\n- DEVELOPMENT (fixture-b): 虚构发展占位符\n- PAYOFF (fixture-b): 虚构收束占位符\n- GPS enrichment: ${route.included?'optional synthetic map context':'none'}\n- Production status: HOLD — real authorized source footage, audio and licensed BGM unavailable\n- Preview/review/render/QA: NOT RUN; publication: NOT AUTHORIZED\n`);
}
console.log(JSON.stringify({kind:'synthetic-only',cases:cases.map(x=>x.name),out,tests:'PASS'}));
