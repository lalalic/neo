import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { join } from 'node:path';
import {
  build,
  isDAG,
  materializeAll,
  publishGate,
  reviewCurrent,
  sha256,
} from '../scripts/synthetic-workflow-examples.mjs';
import { readFileSync } from 'node:fs';
const graph = readFileSync(new URL('../graph.mmd', import.meta.url), 'utf8');
const EPISODE_STAGES = [...new Set([...graph.matchAll(/([\w-]+)\[agent:([\w-]+)\]/g)].map(([, stage]) => stage.replaceAll('_', '-')))];
const episodeTaskId = (stage, submissionId) => `vlog-${stage}-${submissionId}`;
import { optionalRouteScene } from '../lib/gps-route.mjs';

const MODES = ['no-gps', 'partial-gps', 'gps-enhanced'];
const temporaryRoot = await mkdtemp(join(os.tmpdir(), 'vlog-synthetic-fixtures-'));
const fixtures = materializeAll(process.env.VLOG_SYNTHETIC_RUN_ROOT || temporaryRoot);
const fixtureRoot = process.env.VLOG_SYNTHETIC_RUN_ROOT || temporaryRoot;

const timeline = (video) => [...video.matchAll(/^## ([a-z]+) .* start:(\d+) duration:(\d+)$/gm)].map((match) => ({
  name: match[1],
  sourceId: match[0].match(/sourceId:"?([^"\s]+)"?/)?.[1] ?? null,
  start: Number(match[2]),
  duration: Number(match[3]),
}));

const dependencyKeys = [
  'sourceMediaHashes',
  'sourceManifestHash',
  'storyHash',
  'visualBriefHash',
  'musicPlanHash',
  'captionHash',
  'productionVideoHash',
];

async function persistedCase(mode) {
  const directory = join(fixtureRoot, mode);
  const read = async (name) => await readFile(join(directory, name), 'utf8');
  return {
    directory,
    result: JSON.parse(await read('result.json')),
    manifest: JSON.parse(await read('source-manifest.json')),
    research: JSON.parse(await read('research-evidence.json')),
    story: await read('story.md'),
    visualBrief: await read('visual-brief.md'),
    stories: { r1: await read('story-r1.md'), r2: await read('story-r2.md') },
    briefs: { r1: await read('visual-brief-r1.md'), r2: await read('visual-brief-r2.md') },
    plans: { r1: JSON.parse(await read('editorial-plan-r1.json')), r2: JSON.parse(await read('editorial-plan-r2.json')) },
    musicPlan: JSON.parse(await read('music-plan.json')),
    captionsR1: await read('captions-r1.vtt'),
    captionsR2: await read('captions-r2.vtt'),
    videos: { r1: await read('video-r1.md'), r2: await read('video-r2.md') },
    r1Review: JSON.parse(await read('reviews/r1-changes.json')),
    r2Review: JSON.parse(await read('reviews/r2-current.json')),
    qa: JSON.parse(await read('qa.json')),
    publication: JSON.parse(await read('publication-hold.json')),
    sources: Object.fromEntries(await Promise.all((await readdir(join(directory, 'assets'))).map(async (name) => [name, await read(`assets/${name}`)]))),
  };
}

const persisted = Object.fromEntries(await Promise.all(MODES.map(async (mode) => [mode, await persistedCase(mode)])));

const seconds = (stamp) => stamp.split(':').reduce((total, part) => total * 60 + Number(part), 0);
const captionCues = (vtt) => [...vtt.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\n([^\n]+)(?=\n|$)/g)]
  .map((match) => ({ start: seconds(match[1]), end: seconds(match[2]), text: match[3] }));

for (const mode of MODES) {
  test(`${mode}: each revision has complete aligned captions, source sound and visual treatment`, () => {
    const disk = persisted[mode];
    for (const revision of ['r1', 'r2']) {
      const plan = disk.plans[revision];
      const scenes = timeline(disk.videos[revision]);
      const cues = captionCues(revision === 'r1' ? disk.captionsR1 : disk.captionsR2);
      assert.equal(cues.length, scenes.length);
      assert.equal(plan.length, scenes.length);
      assert.equal(cues[0].start, 0);
      assert.equal(cues.at(-1).end, mode === 'gps-enhanced' ? 11 : 8);
      assert.ok(new Set(cues.map((cue) => cue.text)).size > 1);
      assert.doesNotMatch(revision === 'r1' ? disk.captionsR1 : disk.captionsR2, /CHANGE_REQUIRED|审核|删除|字幕重复/);
      for (const [index, beat] of plan.entries()) {
        assert.equal(beat.name, scenes[index].name);
        assert.equal(beat.start, scenes[index].start);
        assert.equal(beat.duration, scenes[index].duration);
        assert.deepEqual(cues[index], { start: beat.start, end: beat.start + beat.duration, text: beat.caption });
        if (index) assert.equal(cues[index - 1].end, cues[index].start);
        for (const field of ['sourceRange', 'composition', 'motion', 'transitionIn', 'transitionOut', 'originalSound', 'bgm', 'caption']) {
          assert.ok(typeof beat[field] === 'string' && beat[field].length > 3, `${mode}/${revision}/${beat.name}/${field}`);
          assert.ok(disk.briefs[revision].includes(beat[field]), field);
        }
        assert.ok(disk.stories[revision].includes(beat.title));
        assert.ok(disk.briefs[revision].includes(beat.title));
        assert.match(beat.originalSound, /SYNTHETIC/);
      }
      const dependencies = fixtures[mode].revisions[revision].dependencies;
      assert.equal(sha256(disk.stories[revision]), dependencies.storyHash);
      assert.equal(sha256(disk.briefs[revision]), dependencies.visualBriefHash);
    }
    assert.equal(disk.story, disk.stories.r2);
    assert.equal(disk.visualBrief, disk.briefs.r2);
    assert.notEqual(disk.stories.r1, disk.stories.r2);
    assert.notEqual(disk.briefs.r1, disk.briefs.r2);
    assert.notEqual(fixtures[mode].revisions.r1.dependencies.storyHash, fixtures[mode].revisions.r2.dependencies.storyHash);
    assert.notEqual(fixtures[mode].revisions.r1.dependencies.visualBriefHash, fixtures[mode].revisions.r2.dependencies.visualBriefHash);
    const closing = disk.plans.r2.at(-1).title;
    assert.ok(disk.stories.r2.includes(closing) && disk.briefs.r2.includes(closing));
  });
}

for (const mode of MODES) {
  test(`${mode}: concrete beats, immutable revisions, and aligned persisted bytes`, async () => {
    const fixture = fixtures[mode];
    const disk = persisted[mode];
    assert.equal(fixture.classification, 'SYNTHETIC_NOT_REAL');
    assert.equal(fixture.mode, mode);
    assert.ok(fixture.title.length > 3);
    assert.deepEqual(Object.keys(fixture.revisions.r1.dependencies), dependencyKeys);
    assert.deepEqual(Object.keys(fixture.revisions.r2.dependencies), dependencyKeys);
    assert.notEqual(fixture.revisions.r1.contentHash, fixture.revisions.r2.contentHash);
    assert.equal(fixture.revisions.r1ValidForR2, false);
    assert.equal(fixture.revisions.r2Current, true);

    assert.equal(disk.videos.r1 !== disk.videos.r2, true);
    assert.equal(disk.captionsR1 !== disk.captionsR2, true);
    assert.equal(sha256(disk.videos.r1), fixture.revisions.r1.contentHash);
    assert.equal(sha256(disk.videos.r2), fixture.revisions.r2.contentHash);
    assert.equal(sha256(disk.stories.r1), fixture.revisions.r1.dependencies.storyHash);
    assert.equal(sha256(disk.story), fixture.revisions.r2.dependencies.storyHash);
    assert.equal(sha256(disk.briefs.r1), fixture.revisions.r1.dependencies.visualBriefHash);
    assert.equal(sha256(`${JSON.stringify(disk.musicPlan, null, 2)}\n`), fixture.revisions.r1.dependencies.musicPlanHash);
    assert.equal(sha256(disk.captionsR1), fixture.revisions.r1.dependencies.captionHash);
    assert.equal(sha256(disk.captionsR2), fixture.revisions.r2.dependencies.captionHash);
    assert.equal(sha256(`${JSON.stringify(disk.manifest, null, 2)}\n`), fixture.revisions.r1.dependencies.sourceManifestHash);

    for (const source of disk.manifest.media) {
      const bytes = disk.sources[`${source.sourceId}.synthetic.txt`];
      assert.equal(sha256(bytes), source.sha256);
      assert.equal(fixture.revisions.r2.dependencies.sourceMediaHashes[source.sourceId], source.sha256);
      const [rangeStart, rangeEnd] = source.shotRange.replace('s', '').split('-').map(Number);
      assert.ok(timeline(disk.videos.r1).filter((scene) => scene.sourceId === source.sourceId)
        .every((scene) => scene.start >= rangeStart && scene.start + scene.duration <= rangeEnd));
    }
    for (const scene of timeline(disk.videos.r1).filter((item) => item.sourceId && item.sourceId !== 'BOTH')) {
      assert.match(disk.stories.r1, new RegExp(`${scene.sourceId}@${scene.start}-${scene.start + scene.duration}s`));
    }
  });

  test(`${mode}: story, visual brief, Markcut timeline, captions, and music align`, () => {
    const disk = persisted[mode];
    const r1Timeline = timeline(disk.videos.r1);
    const r2Timeline = timeline(disk.videos.r2);
    for (const [name, revisionTimeline] of [['r1', r1Timeline], ['r2', r2Timeline]]) {
      const expected = fixtures[mode].revisions[name].revisionId.endsWith('r2') ? fixtures[mode].files.videoR2 : fixtures[mode].files.videoR1;
      const totalDuration = mode === 'gps-enhanced' ? 11 : 8;
      assert.equal(revisionTimeline.reduce((total, scene) => total + scene.duration, 0), totalDuration);
      assert.equal(revisionTimeline[0].name, 'hook');
      assert.equal(revisionTimeline.at(-1).start + revisionTimeline.at(-1).duration, totalDuration);
      assert.equal(expected.split('\n').filter((line) => line.startsWith('## ')).length, revisionTimeline.length);
      assert.equal(disk.videos[name].split('\n').filter((line) => line.startsWith('- component duration:')).length, revisionTimeline.filter((scene) => scene.sourceId).length);
    }
    assert.deepEqual([...new Set(r1Timeline.map((scene) => scene.sourceId).filter((sourceId) => sourceId && sourceId !== 'BOTH'))], disk.manifest.media.map((source) => source.sourceId));
    assert.match(disk.captionsR1, /^WEBVTT\n\n00:00:00\.000 --> 00:00:03\.000\n/u);
    assert.match(disk.captionsR2, /^WEBVTT\n\n00:00:00\.000 --> 00:00:03\.000\n/u);
    assert.deepEqual(disk.musicPlan.cues.at(-1).end, mode === 'gps-enhanced' ? 11 : 8);
    assert.equal(disk.musicPlan.rights.status, 'NOT_PROVEN');
    assert.equal(disk.qa.hostedPlayback, 'NOT_RUN');
    assert.equal(disk.qa.audio, 'NOT_RUN');
    assert.equal(disk.qa.captions, 'NOT_RUN');
    assert.equal(disk.publication.decision, 'HOLD');
  });
}

test('no-GPS stays complete and never invents coordinates, a map, or movement', () => {
  const fixture = fixtures['no-gps'];
  assert.equal(fixture.research.status, 'NOT_APPLICABLE');
  assert.deepEqual(fixture.research.points, []);
  assert.deepEqual(fixture.research.missingCoordinates, ['SYN-N1', 'SYN-N2']);
  assert.equal(fixture.routeIncluded, false);
  assert.equal(fixture.trackedMovement, false);
  assert.doesNotMatch(fixture.files.videoR1, /map |route|travelMode/);
  assert.match(fixture.files.story, /雨点突然砸下/);
  assert.match(fixture.files.story, /雨停了|积水映出天光/);
});

test('partial-GPS may expose only its authorized point and never locates untagged footage', () => {
  const fixture = fixtures['partial-gps'];
  assert.deepEqual(fixture.research.points, [{ sourceId: 'SYN-P1', latitude: 43.6, longitude: -79.3, capturedAtUtc: '2026-10-14T12:00:00Z', provenance: 'SIMULATED_EXIF', confidence: 'SYNTHETIC_HIGH' }]);
  assert.deepEqual(fixture.research.missingCoordinates, ['SYN-P2']);
  assert.equal(fixture.research.privacy.disclosureApproved, false);
  assert.equal(fixture.routeIncluded, false);
  assert.doesNotMatch(fixture.files.videoR1, /43\.6|-79\.3|map |travelMode/);
  assert.match(fixture.research.interpretation, /no untagged-shot location inference/);
});

test('GPS-enhanced maps only authorized samples after payoff and records movement unknown', () => {
  const fixture = fixtures['gps-enhanced'];
  assert.equal(fixture.research.points.length, 2);
  assert.equal(fixture.research.movementMode, 'unknown');
  assert.equal(fixture.routeIncluded, true);
  assert.equal(fixture.trackedMovement, false);
  assert.match(fixture.files.videoR1, /map view:route duration:2 mapType:roadmap waypoints:\[43\.6,-79\.3,"Stop 1"; 43\.7,-79\.4,"Stop 2"\]/);
  assert.doesNotMatch(fixture.files.videoR1, /travelMode/);
  const map = timeline(fixture.files.videoR1).find((scene) => scene.name === 'map');
  const payoff = timeline(fixture.files.videoR1).find((scene) => scene.name === 'payoff');
  assert.ok(map.start >= payoff.start + payoff.duration);
});

test('optional route research rejects denied disclosure, privacy exclusion, and insufficient use', () => {
  const point = (sourceId, capturedAtUtc, latitude, longitude) => ({ SourceFile: sourceId, GPSDateTime: capturedAtUtc, GPSLatitude: latitude, GPSLongitude: longitude });
  const points = [point('SYN-G1', '2026:10:14 12:00:00', 43.6, -79.3), point('SYN-G2', '2026:10:14 13:00:00', 43.7, -79.4)];
  assert.equal(optionalRouteScene(points, { disclosureApproved: false }).reason, 'disclosure-not-approved');
  assert.equal(optionalRouteScene(points, { disclosureApproved: true, excludeSources: ['SYN-G1'] }).reason, 'insufficient-approved-stops');
  assert.equal(optionalRouteScene([...points, { SourceFile: 'SYN-UNTAGGED' }], { disclosureApproved: true }).evidence.segments.at(-1).length, 2);
});

test('every dependency change independently stales its bound simulated review', () => {
  for (const mode of MODES) {
    const revision = structuredClone(fixtures[mode].revisions.r2);
    const review = structuredClone(fixtures[mode].revisions.r2Review);
    assert.equal(reviewCurrent(review, revision), true);
    for (const key of dependencyKeys) {
      const changed = structuredClone(revision);
      if (key === 'sourceMediaHashes') {
        changed.dependencies[key] = { ...changed.dependencies[key], [Object.keys(changed.dependencies[key])[0]]: 'CHANGED' };
      } else {
        changed.dependencies[key] = 'CHANGED';
      }
      assert.equal(reviewCurrent(review, changed), false, key);
    }
    assert.equal(reviewCurrent({ ...review, decision: 'CHANGE_REQUIRED' }, revision), false);
    assert.equal(reviewCurrent({ ...review, revisionId: `${mode}-r1` }, revision), false);
    assert.equal(reviewCurrent({ ...review, contentHash: 'CHANGED' }, revision), false);
  }
});

test('disk changes at referenced fixture paths invalidate the persisted r2 review', async () => {
  for (const mode of MODES) {
    const disk = persisted[mode];
    const firstSource = disk.manifest.media[0];
    const sourceKey = `${firstSource.sourceId}.synthetic.txt`;
    const changedSourceBytes = disk.sources[sourceKey].replace('rights:', 'changed-rights:');
    assert.equal(sha256(changedSourceBytes) !== firstSource.sha256, true);
    const changedManifest = structuredClone(disk.manifest);
    changedManifest.media[0].sha256 = sha256(changedSourceBytes);
    const manifestBytes = `${JSON.stringify(changedManifest, null, 2)}\n`;
    assert.equal(sha256(manifestBytes) !== fixtures[mode].revisions.r2.dependencies.sourceManifestHash, true);

    const changedStory = `${disk.story}changed\n`;
    const changedBrief = `${disk.visualBrief}changed\n`;
    const changedMusic = `${JSON.stringify({ ...disk.musicPlan, track: 'CHANGED' }, null, 2)}\n`;
    const changedCaption = `${disk.captionsR2}changed\n`;
    const changedVideo = `${disk.videos.r2}\nchanged\n`;
    const expected = {
      sourceManifestHash: sha256(manifestBytes),
      storyHash: sha256(changedStory),
      visualBriefHash: sha256(changedBrief),
      musicPlanHash: sha256(changedMusic),
      captionHash: sha256(changedCaption),
      productionVideoHash: sha256(changedVideo),
    };
    for (const [key, value] of Object.entries(expected)) {
      assert.notEqual(value, fixtures[mode].revisions.r2.dependencies[key], key);
    }
    const staleReview = { ...disk.r2Review, dependencies: { ...disk.r2Review.dependencies, ...expected } };
    assert.equal(reviewCurrent(staleReview, fixtures[mode].revisions.r2), false);
  }
});

test('publication requires exact scope, rights, current review, observable QA, and still holds synthetic fixtures', () => {
  for (const mode of MODES) {
    const revision = fixtures[mode].revisions.r2;
    const review = fixtures[mode].revisions.r2Review;
    const qa = { structural: 'PASS', hostedPlayback: 'PASS', audio: 'PASS', captions: 'PASS' };
    const rights = { status: 'GRANTED', provenance: 'AUTHORITATIVE_RIGHTS_RECORD' };
    const complete = {
      explicit: true,
      realHuman: true,
      provenance: 'REAL_OBSERVED_HUMAN',
      account: revision.publishTarget.account,
      platform: revision.publishTarget.platform,
      scope: revision.publishTarget.scope,
    };
    assert.deepEqual(publishGate({ revision, review, qa, rights }), { decision: 'HOLD', reason: 'AUTHORIZATION_ABSENT' });
    assert.deepEqual(publishGate({ authorization: { explicit: true, realHuman: 'human' }, revision, review, qa, rights }), { decision: 'HOLD', reason: 'AUTHORIZATION_BOOLEAN_INSUFFICIENT' });
    assert.deepEqual(publishGate({ authorization: { ...complete, provenance: 'SIMULATED' }, revision, review, qa, rights }), { decision: 'HOLD', reason: 'SIMULATED_AUTHORIZATION_NOT_ELIGIBLE' });
    assert.deepEqual(publishGate({ authorization: { ...complete, platform: 'other' }, revision, review, qa, rights }), { decision: 'HOLD', reason: 'PUBLISH_SCOPE_MISMATCH' });
    assert.deepEqual(publishGate({ authorization: complete, revision, review: fixtures[mode].revisions.r1Review, qa, rights }), { decision: 'HOLD', reason: 'REVIEW_NOT_CURRENT' });
    assert.deepEqual(publishGate({ authorization: complete, revision, review, qa: { ...qa, hostedPlayback: 'NOT_RUN' }, rights }), { decision: 'HOLD', reason: 'OBSERVABLE_QA_INCOMPLETE' });
    assert.deepEqual(publishGate({ authorization: complete, revision, review, qa, rights: { status: 'NOT_PROVEN', provenance: 'NO_AUTHORITATIVE_RIGHTS_RECORD' } }), { decision: 'HOLD', reason: 'RIGHTS_NOT_PROVEN' });
    assert.deepEqual(publishGate({ authorization: complete, revision, review, qa, rights }), { decision: 'HOLD', reason: 'SYNTHETIC_FIXTURE_NOT_PUBLISHABLE' });
  }
});

test('canonical Vlog stages map to distinct ordered Task IDs', () => {
  assert.deepEqual(EPISODE_STAGES, ['visioner', 'director', 'editor', 'producer', 'final-qa']);
  assert.equal(episodeTaskId('visioner', 's1'), 'vlog-visioner-s1');
  assert.equal(episodeTaskId('final-qa', 's1'), 'vlog-final-qa-s1');
  const edges = [['visioner', 'director'], ['director', 'editor'], ['editor', 'producer'], ['producer', 'final-qa']];
  assert.equal(isDAG(edges), true);
  assert.equal(isDAG([...edges, ['final-qa', 'visioner']]), false);
});

test('tracked design documentation carries actual per-case Markcut excerpts', async () => {
  const documentation = await readFile(new URL('../docs/synthetic-stage-examples.md', import.meta.url), 'utf8');
  for (const mode of MODES) {
    const actualHeading = fixtures[mode].files.videoR1.split('\n').find((line) => line.startsWith('## hook'));
    const actualNode = fixtures[mode].files.videoR1.split('\n').find((line) => line.startsWith('- component duration:'));
    assert.ok(documentation.includes(actualHeading), mode);
    assert.ok(documentation.includes(actualNode), mode);
  }
});
