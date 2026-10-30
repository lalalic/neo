import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { snapshot, startReview, submitFeedback, reviewStatus, resolveFeedback } from '../lib/stage-review.mjs';
import { serveReview } from '../lib/stage-review-server.mjs';

const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'vlog-stage-test-'));
  const root = join(parent, 'vlog', 'runs', '2026-10-30-test');
  mkdirSync(join(root, 'input'), { recursive: true });
  const sources = [
    { id: 'photo-a', file: 'photo-a.jpg', data: Buffer.from('original-photo') },
    { id: 'video-b', file: 'video-b.mp4', data: Buffer.from('0123456789') },
  ];
  for (const s of sources) {
    s.sha256 = hash(s.data);
    writeFileSync(join(root, 'input', s.file), s.data);
  }
  mkdirSync(join(root, 'execution', 'vision-frames'), { recursive: true });
  writeFileSync(join(root, 'execution', 'vision-frames', 'v-0.78s.jpg'), Buffer.from('frame-pixel-evidence'));
  const json = (name, value) => writeFileSync(join(root, name), JSON.stringify(value, null, 2));
  json('source-manifest.json', { source_use: { approved: true },
    media: sources.map(s => ({ path: s.file, sha256: s.sha256 })) });
  json('vision-evidence.json', { sources: sources.map(s => ({
    id: s.id, path: 'input/' + s.file, sha256: s.sha256,
    media_type: s.id === 'video-b' ? 'video' : 'photo',
    duration_seconds: s.id === 'video-b' ? 2 : undefined,
    observations: [{ claim: 'test observable only',
      evidence: s.id === 'video-b' ?
        { source: s.file, time_range: '0.25-1.50s', frames: ['execution/vision-frames/v-0.78s.jpg'] } :
        { source: s.file, time_seconds: 0 } }],
    uncertainty: 'subject remains unknown',
  })) });
  json('shot-selection.json', { shots: [
    { id: 'opening', source_id: 'video-b', beat: 'HOOK', evidence_ref: '#video', candidate_start_seconds: 0.25,
      candidate_end_seconds: 1.5, rationale: 'original motion' },
  ] });
  writeFileSync(join(root, 'story.md'), 'Actual footage hook, moment, payoff.');
  writeFileSync(join(root, 'visual-brief.md'), 'Keep source sound.');
  json('edit-decision-list.json', { edits: [{ order: 1, shot_id: 'opening', source_id: 'video-b',
    beat: 'HOOK', in_seconds: 0.25, out_seconds: 1.5, target_duration_seconds: 1.25,
    transition_in: 'cold_open', transition_out: 'hard_cut',
    transition_relationship: 'Cut to matching movement',
    audio_treatment: { source_audio: 'preserve' }, graphics: { caption: '真实' } }] });
  json('music-plan.json', { status: 'needs_clearance' });
  writeFileSync(join(root, 'video.md'), '# Current video\n');
  return { root, parent, sources, json };
}

test('every stage has distinct review, revision-scoped content and source evidence', t => {
  const f = fixture();t.after(() => rmSync(f.parent,{ recursive: true, force:true }));
  const types = ['source-evidence','storyboard','edit-timeline','markcut-media'];
  for (const [i, stage] of ['visioner','director','editor','producer'].entries()) {
    const s = startReview(f.root, stage);
    assert.equal(s.reviewType, types[i]);
    assert.equal(s.sources.length, 2);
    assert.equal(s.status, 'awaiting_feedback');
    assert.equal(reviewStatus(f.root, stage).status, 'awaiting_feedback');
    assert.equal(s.sources[1].observations[0].startSeconds, 0.25);
    assert.equal(s.sources[1].observations[0].endSeconds, 1.5);
    assert.equal(s.sources[1].frames[0].timeSeconds, 0.78);
    assert.match(s.sources[1].uncertainty[0], /unknown/);
    assert.match(s.revisionId, new RegExp('^'+stage+'-'));
  }
  assert.equal(snapshot(f.root, 'director').content.shots[0].id,'opening');
  assert.match(snapshot(f.root, 'director').content.story,/Actual footage/);
  assert.equal(snapshot(f.root, 'editor').content.timeline[0].transitionReason,'Cut to matching movement');
  assert.equal(snapshot(f.root, 'producer').content.canonicalVideo,'video.md');
  assert.ok(!('approval' in snapshot(f.root, 'producer')));
});

test('time-bound owner correction stays separate from model fact and never implies approval',t=>{
  const f=fixture();t.after(()=>rmSync(f.parent,{recursive:true,force:true}));
  const s=startReview(f.root,'visioner');
  const c=submitFeedback(f.root,'visioner',{revisionId:s.revisionId, contentHash:s.contentHash,
    kind:'source_correction',sourceId:'video-b',timeSeconds:0.75,text:'That is a leaf, not a frog.'});
  assert.equal(c.timeSeconds,0.75);assert.equal(c.sourceHash,f.sources[1].sha256);
  assert.equal(c.workerAction,'pending');
  assert.equal(reviewStatus(f.root,'visioner').status,'feedback_received_requires_worker_revision');
  const ownerLedger=readFileSync(join(f.root,'reviews','owner-source-corrections.jsonl'),'utf8');
  assert.match(ownerLedger,/owner_testimony_unverified/);
  assert.equal(JSON.parse(readFileSync(join(f.root,'vision-evidence.json'))).sources[1].observations[0].claim,
    'test observable only');
  assert.doesNotMatch(ownerLedger, /"approved"/);
});

test('stale version, bad source/time/shot, missing rights and escape paths fail closed',t=>{
  const f=fixture();t.after(()=>rmSync(f.parent,{recursive:true,force:true}));
  const s=startReview(f.root,'director');
  const valid={revisionId:s.revisionId,contentHash:s.contentHash,kind:'guidance',
    sourceId:'video-b',shotId:'opening',timeSeconds:0.5,text:'shorten the opening'};
  assert.throws(()=>submitFeedback(f.root,'director',{...valid,sourceId:'photo-a'}), /mismatch/);
  assert.throws(()=>submitFeedback(f.root,'director',{...valid,shotId:'missing'}), /Unknown stage shot/);
  assert.throws(()=>submitFeedback(f.root,'director',{...valid,timeSeconds:20}), /Invalid source timestamp/);
  f.json('shot-selection.json',{ shots:[{ id:'opening',source_id:'video-b',beat:'HOOK',candidate_start_seconds:0.2 }] });
  assert.notEqual(snapshot(f.root,'director').revisionId,s.revisionId);
  assert.throws(()=>submitFeedback(f.root,'director',valid),/Stale revision/);
  f.json('source-manifest.json',{source_use:{approved:false},media:[]});
  assert.throws(()=>snapshot(f.root,'visioner'),/permission/);
});

test('loopback server serves time-seekable original media, accepts real API feedback only on current revision',async t=>{
  const f=fixture();t.after(()=>rmSync(f.parent,{recursive:true,force:true}));
  const {server,url}=await serveReview({runRoot:f.root,stage:'visioner'});
  t.after(()=>server.close());
  const base=url.split('/?')[0], token=new URL(url).searchParams.get('token');
  const forbidden=await fetch(base+'/api/status');assert.equal(forbidden.status,403);
  const response=await fetch(url);assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/逐份原始素材/);
  const media=await fetch(base+'/media/video-b?token='+token,{headers:{Range:'bytes=2-5'}});
  assert.equal(media.status,206);
  assert.equal(await media.text(),'2345');
  const suffix = await fetch(base+'/media/video-b?token='+token,{headers:{Range:'bytes=-3'}});
  assert.equal(suffix.status,206);
  assert.equal(await suffix.text(),'789');
  const frame = await fetch(base+'/frame/video-b/0?token='+token);
  assert.equal(frame.status,200);
  assert.equal(await frame.text(),'frame-pixel-evidence');
  const s=await (await fetch(base+'/api/status?token='+token)).json();
  assert.equal(s.status,'awaiting_feedback');
  const comment=await fetch(base+'/api/comment?token='+token,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({
      revisionId:s.revisionId,contentHash:s.contentHash,kind:'guidance',
      sourceId:'video-b',timeSeconds:1.2,text:'Please inspect this frame',
    })});
  assert.equal(comment.status,201);
  const updated=await (await fetch(base+'/api/status?token='+token)).json();
  assert.equal(updated.feedback.length,1);
  assert.equal(updated.status,'feedback_received_requires_worker_revision');
  const stale=await fetch(base+'/api/comment?token='+token,{method:'POST',
    headers:{'content-type':'application/json'},body:JSON.stringify({
      revisionId:'visioner-old',contentHash:s.contentHash,kind:'guidance',
      sourceId:'video-b',timeSeconds:0,text:'old',
    })});
  assert.equal(stale.status,409);
});

test('feedback is routed back to stage owner; worker applies to a new revision, then re-review awaits real feedback', t=>{
  const f=fixture();t.after(()=>rmSync(f.parent,{recursive:true,force:true}));
  const before=startReview(f.root,'visioner');
  submitFeedback(f.root,'visioner',{revisionId:before.revisionId,contentHash:before.contentHash,
    kind:'source_correction',sourceId:'video-b',timeSeconds:0.2,text:'Owner says this is flowing water'});
  let status=reviewStatus(f.root,'visioner');
  const item=status.outstandingFeedback[0];
  assert.equal(item.workerAction,'pending');
  assert.throws(()=>resolveFeedback(f.root,'visioner',{feedbackKey:item.feedbackKey,
    feedbackRevisionId:item.revisionId,disposition:'applied',explanation:'Not edited yet'}),/changed/);
  const evidence=JSON.parse(readFileSync(join(f.root,'vision-evidence.json')));
  evidence.sources[1].owner_testimony_ref='reviews/owner-source-corrections.jsonl';
  f.json('vision-evidence.json',evidence);
  status=reviewStatus(f.root,'visioner');
  assert.equal(status.status,'outstanding_feedback_from_prior_revision');
  const outcome=resolveFeedback(f.root,'visioner',{feedbackKey:item.feedbackKey,
    feedbackRevisionId:item.revisionId,disposition:'applied',explanation:'Added testimony reference only; machine claim unchanged'});
  assert.notEqual(outcome.newRevisionId,before.revisionId);
  assert.equal(reviewStatus(f.root,'visioner').status,'awaiting_feedback');
  assert.equal(JSON.parse(readFileSync(join(f.root,'vision-evidence.json'))).sources[1].observations[0].claim,
    'test observable only');
});

test('evidence-frame byte changes invalidate a source review revision', t => {
  const f = fixture();t.after(() => rmSync(f.parent,{recursive:true,force:true}));
  const before = snapshot(f.root,'visioner');
  assert.ok(before.frameHashes['video-b/execution/vision-frames/v-0.78s.jpg']);
  writeFileSync(join(f.root,'execution','vision-frames','v-0.78s.jpg'), Buffer.from('different-frame'));
  assert.notEqual(snapshot(f.root,'visioner').contentHash,before.contentHash);
});

test('producer revision invalidates after upstream story or captions change; still photos reject fictitious timestamp', t=>{
  const f=fixture();t.after(()=>rmSync(f.parent,{recursive:true,force:true}));
  const old=snapshot(f.root,'producer');
  writeFileSync(join(f.root,'story.md'),'Revised story for the same authorized footage');
  assert.notEqual(snapshot(f.root,'producer').revisionId,old.revisionId);
  mkdirSync(join(f.root,'assets'));
  writeFileSync(join(f.root,'assets/captions.vtt'),'WEBVTT\n');
  assert.ok(snapshot(f.root,'producer').hashes['assets/captions.vtt']);
  const vision=startReview(f.root,'visioner');
  assert.throws(()=>submitFeedback(f.root,'visioner',{revisionId:vision.revisionId,
    contentHash:vision.contentHash,kind:'guidance',sourceId:'photo-a',
    timeSeconds:1,text:'This still has no timestamp'}),/Still-photo/);
  assert.throws(()=>submitFeedback(f.root,'visioner',{revisionId:vision.revisionId,
    contentHash:vision.contentHash,kind:'approved',sourceId:'video-b',
    timeSeconds:0,text:'approval is not a comment'}),/Unsupported feedback kind/);
});
