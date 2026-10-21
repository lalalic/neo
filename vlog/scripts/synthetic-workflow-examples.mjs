import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractRoutePoints, routeScene } from '../lib/gps-route.mjs';

const CLASSIFICATION = 'SYNTHETIC_NOT_REAL';
const RUN_RELATIVE_DIR = '2026-10-21-workflow-design';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeDependencies = (dependencies) => stableStringify(dependencies);

export const reviewCurrent = (review, revision) => Boolean(
  review?.decision === 'PASS'
  && review.revisionId === revision.revisionId
  && review.contentHash === revision.contentHash
  && normalizeDependencies(review.dependencies) === normalizeDependencies(revision.dependencies),
);

export const reviewStale = (review, revision) => !reviewCurrent(review, revision);

export function publishGate({ authorization = null, revision, review, qa, rights } = {}) {
  if (revision?.classification !== CLASSIFICATION || !revision?.revisionId) {
    return { decision: 'HOLD', reason: 'INVALID_REVISION' };
  }
  if (!authorization) return { decision: 'HOLD', reason: 'AUTHORIZATION_ABSENT' };
  if (authorization.explicit !== true || authorization.realHuman !== true) {
    return { decision: 'HOLD', reason: 'AUTHORIZATION_BOOLEAN_INSUFFICIENT' };
  }
  if (authorization.provenance !== 'REAL_OBSERVED_HUMAN') {
    return { decision: 'HOLD', reason: 'SIMULATED_AUTHORIZATION_NOT_ELIGIBLE' };
  }
  if (authorization.account !== revision.publishTarget.account
    || authorization.platform !== revision.publishTarget.platform
    || normalizeDependencies(authorization.scope) !== normalizeDependencies(revision.publishTarget.scope)) {
    return { decision: 'HOLD', reason: 'PUBLISH_SCOPE_MISMATCH' };
  }
  if (!reviewCurrent(review, revision)) return { decision: 'HOLD', reason: 'REVIEW_NOT_CURRENT' };
  if (qa?.structural !== 'PASS' || qa?.hostedPlayback !== 'PASS' || qa?.audio !== 'PASS' || qa?.captions !== 'PASS') {
    return { decision: 'HOLD', reason: 'OBSERVABLE_QA_INCOMPLETE' };
  }
  if (rights?.status !== 'GRANTED' || rights?.provenance !== 'AUTHORITATIVE_RIGHTS_RECORD') {
    return { decision: 'HOLD', reason: 'RIGHTS_NOT_PROVEN' };
  }
  return { decision: 'HOLD', reason: 'SYNTHETIC_FIXTURE_NOT_PUBLISHABLE' };
}

export function isDAG(edges) {
  const adjacency = new Map();
  for (const [from, to] of edges) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push(to);
  }
  const settled = new Set();
  const visiting = new Set();
  const visit = (node) => {
    if (settled.has(node)) return true;
    if (visiting.has(node)) return false;
    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!visit(next)) return false;
    }
    visiting.delete(node);
    settled.add(node);
    return true;
  };
  return [...adjacency.keys()].every(visit);
}

const CASES = {
  'no-gps': {
    label: '阳台上的突然小雨',
    sources: [
      { id: 'SYN-N1', file: 'SYN-N1.synthetic.txt', shotRange: '0-4s', location: { gpsStatus: 'absent' } },
      { id: 'SYN-N2', file: 'SYN-N2.synthetic.txt', shotRange: '4-8s', location: { gpsStatus: 'absent' } },
    ],
    scenes: {
      r1: [
        { name: 'hook', title: '雨点突然砸下', source: 'SYN-N1', start: 0, duration: 3, text: '雨点突然砸下' },
        { name: 'tension', title: '手机差点滑落', source: 'SYN-N1', start: 3, duration: 1, text: '手机差点滑落' },
        { name: 'recovery', title: '抢收窗边的书', source: 'SYN-N2', start: 4, duration: 2, text: '抢收窗边的书' },
        { name: 'payoff', title: '雨停了，天光回来', source: 'SYN-N2', start: 6, duration: 2, text: '雨停了，天光回来' },
      ],
      r2: [
        { name: 'hook', title: '雨点突然砸下', source: 'SYN-N1', start: 0, duration: 3, text: '雨点突然砸下' },
        { name: 'tension', title: '手机差点滑落', source: 'SYN-N1', start: 3, duration: 1, text: '手机差点滑落' },
        { name: 'recovery', title: '抢收窗边的书', source: 'SYN-N2', start: 4, duration: 2, text: '抢收窗边的书' },
        { name: 'payoff', title: '积水映出天光', source: 'SYN-N2', start: 6, duration: 2, text: '积水映出天光' },
      ],
    },
    r1Feedback: 'CHANGE_REQUIRED：字幕重复标题。改为具体事件句，不暗示地点来源。',
    r2Caption: '积水映出天光（合成教学字幕）',
  },
  'partial-gps': {
    label: '市场里找回笔记本',
    sources: [
      { id: 'SYN-P1', file: 'SYN-P1.synthetic.txt', shotRange: '0-3s', location: { gpsStatus: 'synthetic-point', latitude: 43.6, longitude: -79.3, capturedAtUtc: '2026-10-14T12:00:00Z', provenance: 'SIMULATED_EXIF' } },
      { id: 'SYN-P2', file: 'SYN-P2.synthetic.txt', shotRange: '3-8s', location: { gpsStatus: 'absent' } },
    ],
    scenes: {
      r1: [
        { name: 'hook', title: '笔记本从袋口滑出', source: 'SYN-P1', start: 0, duration: 3, text: '笔记本从袋口滑出' },
        { name: 'tension', title: '摊位太多，线索断了', source: 'SYN-P2', start: 3, duration: 2, text: '摊位太多，线索断了' },
        { name: 'recovery', title: '沿着记忆里的摊位回头', source: 'SYN-P2', start: 5, duration: 1, text: '沿着记忆里的摊位回头' },
        { name: 'payoff', title: '长椅下露出蓝色封面', source: 'SYN-P2', start: 6, duration: 2, text: '长椅下露出蓝色封面' },
      ],
      r2: [
        { name: 'hook', title: '笔记本从袋口滑出', source: 'SYN-P1', start: 0, duration: 3, text: '笔记本从袋口滑出' },
        { name: 'tension', title: '摊位太多，线索断了', source: 'SYN-P2', start: 3, duration: 2, text: '摊位太多，线索断了' },
        { name: 'recovery', title: '沿着记忆里的摊位回头', source: 'SYN-P2', start: 5, duration: 1, text: '沿着记忆里的摊位回头' },
        { name: 'payoff', title: '长椅下露出蓝色封面', source: 'SYN-P2', start: 6, duration: 2, text: '长椅下露出蓝色封面' },
      ],
    },
    r1Feedback: 'CHANGE_REQUIRED：未定位镜头不能接在已授权地点后暗示路线。删除地点连续性表述，保留事件因果。',
    r2Caption: '蓝色封面出现在长椅下（位置未知；合成教学字幕）',
  },
  'gps-enhanced': {
    label: '天台风筝被风抢走',
    sources: [
      { id: 'SYN-G1', file: 'SYN-G1.synthetic.txt', shotRange: '0-4s', location: { gpsStatus: 'synthetic-point', latitude: 43.6, longitude: -79.3, capturedAtUtc: '2026-10-14T12:00:00Z', provenance: 'SIMULATED_EXIF' } },
      { id: 'SYN-G2', file: 'SYN-G2.synthetic.txt', shotRange: '4-7s', location: { gpsStatus: 'synthetic-point', latitude: 43.7, longitude: -79.4, capturedAtUtc: '2026-10-14T13:00:00Z', provenance: 'SIMULATED_EXIF' } },
    ],
    scenes: {
      r1: [
        { name: 'hook', title: '风筝线突然绷直', source: 'SYN-G1', start: 0, duration: 3, text: '风筝线突然绷直' },
        { name: 'tension', title: '风把风筝抢过栏杆', source: 'SYN-G1', start: 3, duration: 1, text: '风把风筝抢过栏杆' },
        { name: 'recovery', title: '穿过公园追向树丛', source: 'SYN-G2', start: 4, duration: 1, text: '穿过公园追向树丛' },
        { name: 'payoff', title: '风筝卡进灌木，停住了', source: 'SYN-G2', start: 5, duration: 2, text: '风筝卡进灌木，停住了' },
        { name: 'map', title: '两个示例地点，非真实路线', map: true, start: 7, duration: 2 },
        { name: 'recap', title: '从天台到公园：位置示意', source: 'BOTH', start: 9, duration: 2, text: '从天台到公园：位置示意' },
      ],
      r2: [
        { name: 'hook', title: '风筝线突然绷直', source: 'SYN-G1', start: 0, duration: 3, text: '风筝线突然绷直' },
        { name: 'tension', title: '风把风筝抢过栏杆', source: 'SYN-G1', start: 3, duration: 1, text: '风把风筝抢过栏杆' },
        { name: 'recovery', title: '穿过公园追向树丛', source: 'SYN-G2', start: 4, duration: 1, text: '穿过公园追向树丛' },
        { name: 'payoff', title: '风筝卡进灌木，停住了', source: 'SYN-G2', start: 5, duration: 2, text: '风筝卡进灌木，停住了' },
        { name: 'map', title: '两个示例地点，非真实路线', map: true, start: 7, duration: 2 },
        { name: 'recap', title: '天台与公园只是位置样本', source: 'BOTH', start: 9, duration: 2, text: '天台与公园只是位置样本' },
      ],
    },
    r1Feedback: 'CHANGE_REQUIRED：结尾地图读作连续轨迹。将文案改为两个位置样本，明确没有记录移动方式。',
    r2Caption: '天台与公园只是位置样本；移动方式未知（合成教学字幕）',
  },
};

const mediaText = (source) => [
  `classification: ${CLASSIFICATION}`,
  `fixture_id: ${source.id}`,
  'media_type: TEXT_PROVENANCE_ONLY_NOT_MEDIA',
  `shot_range: ${source.shotRange}`,
  `gps_status: ${source.location.gpsStatus}`,
  source.location.gpsStatus === 'synthetic-point'
    ? `synthetic_point: ${source.location.latitude},${source.location.longitude} @ ${source.location.capturedAtUtc}`
    : 'synthetic_point: absent',
  'rights: SIMULATED_OWNER_CONSENT_NOT_REAL_PERMISSION',
  '',
].join('\n');

const manifestFor = (mode, definition, mediaHashes) => ({
  classification: CLASSIFICATION,
  permission: 'SIMULATED_OWNER_CONSENT_NOT_REAL_PERMISSION',
  case: mode,
  title: definition.label,
  media: definition.sources.map((source) => ({
    sourceId: source.id,
    assetPath: `assets/${source.file}`,
    sha256: mediaHashes[source.id],
    shotRange: source.shotRange,
    format: 'TEXT_PROVENANCE_ONLY_NOT_MEDIA',
    gps: source.location,
    rights: 'SIMULATED_OWNER_CONSENT_NOT_REAL_PERMISSION',
  })),
});

const researchFor = (mode, definition) => {
  const points = definition.sources
    .filter((source) => source.location.gpsStatus === 'synthetic-point')
    .map((source) => ({
      sourceId: source.id,
      latitude: source.location.latitude,
      longitude: source.location.longitude,
      capturedAtUtc: source.location.capturedAtUtc,
      provenance: source.location.provenance,
      confidence: 'SYNTHETIC_HIGH',
    }));
  const missing = definition.sources.filter((source) => source.location.gpsStatus === 'absent').map((source) => source.id);
  return {
    classification: CLASSIFICATION,
    mode,
    status: points.length ? 'SOURCE_GROUND_SYNTHETIC' : 'NOT_APPLICABLE',
    points,
    missingCoordinates: missing,
    movementMode: points.length >= 2 ? 'unknown' : 'not_established',
    trackedMovement: false,
    privacy: {
      disclosureApproved: mode === 'gps-enhanced',
      scope: mode === 'gps-enhanced' ? ['SYN-G1', 'SYN-G2'] : [],
      publicPrecision: 2,
    },
    interpretation: points.length >= 2
      ? 'Two synthetic position samples support optional context; they do not prove a recorded route or travel mode.'
      : points.length === 1
        ? 'One synthetic position supports no untagged-shot location inference; it is insufficient for a route.'
        : 'No GPS is available. The story remains complete without location attribution.',
  };
};

const storyFor = (definition) => [
  `# ${definition.label}（${CLASSIFICATION}）`,
  '',
  ...definition.scenes.r1.slice(0, 4).map((scene) => (
    `- ${scene.name === 'hook' ? '钩子' : scene.name === 'tension' ? '张力' : scene.name === 'recovery' ? '发展' : '回收'}：`
    + `${scene.title}（${scene.source}@${scene.start}-${scene.start + scene.duration}s）。`
  )),
  '',
  '所有地点、媒体、授权与评价都是教学合成值；不得用于真实发布。',
  '',
].join('\n');

const briefFor = (definition) => [
  `# ${definition.label} visual brief（${CLASSIFICATION}）`,
  '',
  ...definition.scenes.r1.map((scene) => (scene.map
    ? `- ${scene.start}-${scene.start + scene.duration}s：示意地图，只画授权样本点，不声称连续路线。`
    : `- ${scene.start}-${scene.start + scene.duration}s：${scene.source} 的合成占位镜头，画面中心放「${scene.title}」。`)),
  '',
  '构图采用居中主体、短促运动提示和轻快节奏；图形只作编辑解释，不冒充真实素材。',
  '',
].join('\n');

const musicPlanFor = (mode) => ({
  classification: CLASSIFICATION,
  required: true,
  track: 'SYNTHETIC_BGM_PLACEHOLDER',
  rights: { status: 'NOT_PROVEN', provenance: 'NO_AUTHORITATIVE_RIGHTS_RECORD', allowedUse: 'NO_USE_AUTHORIZED' },
  ducking: { dialogueFloorDb: -14, bgmDuckDb: -24, fadeMs: 250 },
  cues: [
    { start: 0, end: 3, intent: '钩子轻快进入', volumeDb: -18 },
    { start: 3, end: mode === 'gps-enhanced' ? 11 : 8, intent: '张力、地图提示与回收保持节奏', volumeDb: -24 },
  ],
  verification: { mixedAudioObserved: false, renderedAudioObserved: false },
});

const captionsFor = (definition, revised) => {
  const cueText = revised ? definition.r2Caption : definition.scenes.r1[0].text;
  const oldText = definition.r1Feedback.replace('CHANGE_REQUIRED：', '');
  return [
    'WEBVTT',
    '',
    '00:00:00.000 --> 00:00:03.000',
    cueText,
    '',
    '00:00:03.000 --> 00:00:08.000',
    revised ? definition.r2Caption : `${oldText}（r1 合成字幕）`,
    '',
  ].join('\n');
};

const sceneMarkdown = (scene, mapLine) => (scene.map
  ? [`## ${scene.name} instruction:"${scene.title}" start:${scene.start} duration:${scene.duration}`, mapLine, '']
  : [
      `## ${scene.name} instruction:"${scene.title}" sourceId:"${scene.source}" shotRange:"${scene.start}-${scene.start + scene.duration}s" start:${scene.start} duration:${scene.duration}`,
      `- component duration:${scene.duration} jsx:"<div style={{background:'#174EA6',color:'white',width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}>SYNTHETIC ${scene.text}</div>"`,
      '',
    ]);

const videoFor = (mode, definition, revised, mapLine) => [
  '# video',
  `instruction:"${mode}-${revised ? 'r2' : 'r1'} ${CLASSIFICATION}"`,
  'seed:1021',
  'width:640 height:480 fps:30 layout:series',
  '',
  ...definition.scenes[revised ? 'r2' : 'r1'].flatMap((scene) => sceneMarkdown(scene, mapLine)),
].join('\n');

const dependenciesFor = (hashes, mediaHashes, revisionId) => ({
  sourceMediaHashes: { ...mediaHashes },
  sourceManifestHash: hashes.sourceManifest,
  storyHash: hashes.story,
  visualBriefHash: hashes.visualBrief,
  musicPlanHash: hashes.musicPlan,
  captionHash: revisionId.endsWith('r2') ? hashes.captionR2 : hashes.captionR1,
  productionVideoHash: revisionId.endsWith('r2') ? hashes.videoR2 : hashes.videoR1,
});

export function build(mode) {
  const definition = CASES[mode];
  if (!definition) throw new Error(`unknown synthetic case: ${mode}`);
  const mediaHashes = Object.fromEntries(definition.sources.map((source) => [source.id, sha256(mediaText(source))]));
  const manifest = manifestFor(mode, definition, mediaHashes);
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  const research = researchFor(mode, definition);
  const story = storyFor(definition);
  const visualBrief = briefFor(definition);
  const musicPlan = musicPlanFor(mode);
  const captionR1 = captionsFor(definition, false);
  const captionR2 = captionsFor(definition, true);
  const mapLine = mode === 'gps-enhanced' ? routeScene(
    extractRoutePoints(definition.sources.filter((source) => source.location.gpsStatus === 'synthetic-point').map((source) => ({
      SourceFile: source.id,
      GPSLatitude: source.location.latitude,
      GPSLongitude: source.location.longitude,
      GPSDateTime: source.location.capturedAtUtc.replace('T', ' ').replace('Z', ''),
    }))),
    { disclosureApproved: true, duration: 2 },
  ) : null;
  const videoR1 = videoFor(mode, definition, false, mapLine);
  const videoR2 = videoFor(mode, definition, true, mapLine);
  const hashes = {
    sourceManifest: sha256(manifestBytes),
    story: sha256(story),
    visualBrief: sha256(visualBrief),
    musicPlan: sha256(`${JSON.stringify(musicPlan, null, 2)}\n`),
    captionR1: sha256(captionR1),
    captionR2: sha256(captionR2),
    videoR1: sha256(videoR1),
    videoR2: sha256(videoR2),
  };
  const publishTarget = { account: 'SYNTHETIC_ACCOUNT_NOT_REAL', platform: 'archive-design-only', scope: { visibility: 'private', mediaUse: 'teaching-fixture' } };
  const revisionR1 = {
    classification: CLASSIFICATION,
    revisionId: `${mode}-r1`,
    contentHash: hashes.videoR1,
    dependencies: dependenciesFor(hashes, mediaHashes, `${mode}-r1`),
    publishTarget,
  };
  const revisionR2 = {
    ...revisionR1,
    revisionId: `${mode}-r2`,
    contentHash: hashes.videoR2,
    dependencies: dependenciesFor(hashes, mediaHashes, `${mode}-r2`),
  };
  const reviewR1 = {
    reviewId: `${mode}-r1-review`,
    decision: 'CHANGE_REQUIRED',
    simulated: true,
    feedback: definition.r1Feedback,
    revisionId: revisionR1.revisionId,
    contentHash: revisionR1.contentHash,
    dependencies: revisionR1.dependencies,
  };
  const reviewR2 = {
    reviewId: `${mode}-r2-review`,
    decision: 'PASS',
    simulated: true,
    authorizationEffect: 'NONE',
    revisionId: revisionR2.revisionId,
    contentHash: revisionR2.contentHash,
    dependencies: revisionR2.dependencies,
  };
  const qa = { structural: 'PASS', hostedPlayback: 'NOT_RUN', audio: 'NOT_RUN', captions: 'NOT_RUN', maps: mode === 'gps-enhanced' ? 'NOT_RUN' : 'NOT_APPLICABLE' };
  return {
    classification: CLASSIFICATION,
    mode,
    title: definition.label,
    manifest,
    research,
    routeIncluded: mode === 'gps-enhanced',
    routeReason: mode === 'gps-enhanced' ? 'approved-location-context' : mode === 'partial-gps' ? 'insufficient-trusted-gps' : 'not-applicable',
    trackedMovement: false,
    revisions: {
      r1: revisionR1,
      r1Review: reviewR1,
      r2: revisionR2,
      r2Review: reviewR2,
      r1ValidForR2: reviewCurrent(reviewR1, revisionR2),
      r2Current: reviewCurrent(reviewR2, revisionR2),
    },
    qa: { ...qa, rationale: 'Structural parser validation only; playback, audio, captions, maps and renders were not observed.' },
    publication: publishGate({ authorization: null, revision: revisionR2, review: reviewR2, qa, rights: musicPlan.rights }),
    files: {
      sourceManifest: manifestBytes,
      story,
      visualBrief,
      musicPlan: `${JSON.stringify(musicPlan, null, 2)}\n`,
      captionR1,
      captionR2,
      videoR1,
      videoR2,
    },
    media: Object.fromEntries(definition.sources.map((source) => [source.id, mediaText(source)])),
  };
}

export function materializeCase(outputRoot, mode) {
  const fixture = build(mode);
  const destination = join(outputRoot, mode);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(join(destination, 'assets'), { recursive: true });
  mkdirSync(join(destination, 'reviews'), { recursive: true });
  for (const [sourceId, contents] of Object.entries(fixture.media)) {
    const source = CASES[mode].sources.find((item) => item.id === sourceId);
    writeFileSync(join(destination, 'assets', source.file), contents);
  }
  const writes = [
    ['source-manifest.json', fixture.files.sourceManifest],
    ['research-evidence.json', `${JSON.stringify(fixture.research, null, 2)}\n`],
    ['story.md', fixture.files.story],
    ['visual-brief.md', fixture.files.visualBrief],
    ['music-plan.json', fixture.files.musicPlan],
    ['captions-r1.vtt', fixture.files.captionR1],
    ['captions-r2.vtt', fixture.files.captionR2],
    ['video-r1.md', fixture.files.videoR1],
    ['video-r2.md', fixture.files.videoR2],
    ['reviews/r1-changes.json', `${JSON.stringify(fixture.revisions.r1Review, null, 2)}\n`],
    ['reviews/r2-current.json', `${JSON.stringify(fixture.revisions.r2Review, null, 2)}\n`],
    ['qa.json', `${JSON.stringify(fixture.qa, null, 2)}\n`],
    ['publication-hold.json', `${JSON.stringify(fixture.publication, null, 2)}\n`],
    ['result.json', `${JSON.stringify({ ...fixture, files: undefined, media: undefined }, null, 2)}\n`],
  ];
  for (const [name, contents] of writes) writeFileSync(join(destination, name), contents);
  return fixture;
}

export function materializeAll(outputRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'runs', RUN_RELATIVE_DIR)) {
  mkdirSync(outputRoot, { recursive: true });
  return Object.fromEntries(Object.keys(CASES).map((mode) => [mode, materializeCase(outputRoot, mode)]));
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const outputRoot = process.argv[2];
  if (!outputRoot) throw new Error('output directory required');
  materializeAll(outputRoot);
  console.log('SYNTHETIC examples: no-gps partial-gps gps-enhanced');
}
