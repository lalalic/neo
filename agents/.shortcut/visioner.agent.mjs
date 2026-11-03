import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const neoRoot = resolve(here, '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function asArgs(value) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('shortcut command must be an argument array');
  }
  return value;
}

function shellToken(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function validRunPath(vlogRoot, runPath) {
  const actualVlogRoot=await realpath(resolve(vlogRoot));
  const root = `${await realpath(resolve(actualVlogRoot, 'runs'))}/`;
  const candidate=resolve(runPath);
  const run = await realpath(candidate);
  if (!run.startsWith(root) || !/^\d{4}-\d{2}-\d{2}(?:-[^/]+)?$/.test(run.slice(root.length))) {
    throw new Error('Visioner requires a dated canonical Vlog runs/<episode> directory');
  }
  return run;
}

function evidenceFromIndex(index) {
  if (index?.status !== 'SOURCE_LINKED_UNREVIEWED' || !Array.isArray(index.sources) || !Array.isArray(index.observations)) {
    throw new Error('Vision index is missing its required source-linked schema');
  }
  const sources = index.sources.map(source => ({
    source_id: source.source_id,
    source_sha256: source.source_sha256,
    media_type: source.media_type,
    summary: source.visual_summary,
    summary_status: source.summary_status,
    evidence_ref: source.markcut_metadata_entry_id,
  }));
  const observations = index.observations.map(item => ({
    evidence_id: item.evidence_id,
    source_id: item.source_id,
    source_sha256: item.source_sha256,
    source_time_start_seconds: item.source_time_start_seconds,
    source_time_end_seconds: item.source_time_end_seconds,
    visual_observation: item.visual_observation,
    speech_hint: item.speech_hint,
    origin: item.origin,
    metadata_pointer: item.metadata_pointer,
    status: item.observation_status,
  }));
  const findings = [...index.findings];
  return {
    schema_version: 1,
    stage: 'visioner',
    status: 'EVIDENCE_READY_UNREVIEWED',
    manifest_hash: index.manifest_hash,
    markcut_metadata_sha256: index.markcut_metadata_sha256,
    artifacts: { source_count: sources.length, observation_count: observations.length },
    summary: sources.filter(source => typeof source.summary === 'string' && source.summary.trim()).map(source => ({
      source_id: source.source_id,
      source_sha256: source.source_sha256,
      text: source.summary,
      status: source.summary_status,
    })),
    sources,
    observations,
    uncertainty: findings,
    evidence: observations.map(item => ({
      evidence_id: item.evidence_id,
      source_id: item.source_id,
      source_sha256: item.source_sha256,
      source_time_start_seconds: item.source_time_start_seconds,
      source_time_end_seconds: item.source_time_end_seconds,
      metadata_pointer: item.metadata_pointer,
    })),
    acceptance: 'Machine observations only; not Director acceptance, human approval, publication authorization, or a final cut.',
  };
}

/**
 * Context contract:
 * { input: { runPath, markcutCommand?: string[], markcutCli?: string,
 *   adapterCommand?: string[], visionContextPath?: string, episodeContext?: string,
 *   allowInference?: true }, runCommand(args, cwd) }
 * runCommand is provided by the host so it can use its owned-process lifecycle.
 */
export async function run(context) {
  const input = context?.input;
  if (!input || typeof input !== 'object') throw new Error('Visioner shortcut requires structured input');
  const projectRoot=await realpath(resolve(input.projectPath || neoRoot));
  const suppliedRoot=resolve(input.vlogRoot || join(projectRoot, 'vlog'));
  const actualRoot=await realpath(suppliedRoot);
  const rootRel=relative(projectRoot,actualRoot);
  if (rootRel==='..'||rootRel.startsWith(`..${sep}`)||isAbsolute(rootRel)) throw new Error('Visioner Vlog root escapes the resolved project root');
  const vlogRoot = actualRoot;
  const runPath = await validRunPath(vlogRoot, input.runPath);
  const manifestPath = join(runPath, 'source-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest?.source_use?.approved !== true || !Array.isArray(manifest.media) || manifest.media.length === 0) {
    throw new Error('Visioner requires a non-empty owner-approved source manifest');
  }
  if (manifest.canonical_source_directory && !isAbsolute(manifest.canonical_source_directory)) throw new Error('Canonical source directory must be absolute');
  if (manifest.markcut_metadata_path && !isAbsolute(manifest.markcut_metadata_path)) throw new Error('Markcut metadata path must be absolute');
  const mediaDir = await realpath(resolve(manifest.canonical_source_directory || join(runPath, 'input/media')));
  const metadataCandidate = resolve(manifest.markcut_metadata_path || join(mediaDir, 'metadata.json'));
  const metadataPath = existsSync(metadataCandidate) ? await realpath(metadataCandidate) : metadataCandidate;
  const confined=(root,path)=>{const rel=relative(root,path);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));};
  if (!confined(runPath,mediaDir) || !confined(mediaDir,metadataPath)) throw new Error('Visioner source or metadata path escapes the canonical run/source directory');
  const indexPath = join(runPath, 'vision-segment-index.json');
  const evidencePath = join(runPath, 'vision-evidence.json');
  if (existsSync(evidencePath)) throw new Error('Refusing to overwrite existing Visioner evidence');
  if (typeof context.runCommand !== 'function') throw new Error('Visioner host must provide its owned-process command runner');

  let markcutResult = null;
  if (!existsSync(metadataPath)) {
    if (input.allowInference !== true) throw new Error('Missing Markcut metadata; explicit inference authorization is required');
    const cli = asArgs(input.markcutCommand);
    if (!cli.length) throw new Error('Missing configured Markcut Vision CLI command');
    const help = await context.runCommand([...cli, 'vision', '--help'], vlogRoot);
    if (help?.code !== 0) throw new Error('Could not verify Markcut Vision CLI support');
    const helpText = String(help?.stdout || '');
    for (const option of ['--itt', '--vtt', '{prompt_quoted}', '{sample_interval}']) {
      if (!helpText.includes(option)) throw new Error(`Markcut Vision CLI does not advertise required template support: ${option}`);
    }
    const adapter = asArgs(input.adapterCommand);
    if (!adapter.length) throw new Error('Missing explicitly configured authorized ITT/VTT adapter command');
    const contextPath=input.visionContextPath ? await realpath(resolve(input.visionContextPath)) : undefined;
    if (contextPath && !confined(actualRoot,contextPath)) throw new Error('Visioner context path escapes the vetted project');
    const contextText = [contextPath ? await readFile(contextPath, 'utf8') : '', input.episodeContext || ''].filter(Boolean).join('\n');
    const adapterCommand = adapter.map(shellToken).join(' ');
    const itt = `${adapterCommand} --input {input} --prompt {prompt_quoted}`;
    const vtt = `${adapterCommand} --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}`;
    markcutResult = await context.runCommand([...cli, 'vision', mediaDir, '--itt', itt, '--vtt', vtt, '--instruct', contextText], vlogRoot);
    if (markcutResult?.code !== 0) throw new Error(`Markcut Vision failed with exit code ${String(markcutResult?.code)}`);
    if (!existsSync(metadataPath)) throw new Error('Markcut Vision exited without producing metadata.json');
  }

  const indexScript = await realpath(join(vlogRoot, 'scripts/index-markcut-vision.mjs'));
  const node = input.nodeCommand || process.execPath;
  const indexed = await context.runCommand([node, indexScript, runPath], vlogRoot);
  if (indexed?.code !== 0 || !existsSync(indexPath)) throw new Error('Existing Vlog Vision index script did not produce a valid index');
  const indexBytes = await readFile(indexPath);
  const index = JSON.parse(indexBytes.toString('utf8'));
  const manifestBytes=await readFile(manifestPath);
  const metadataBytes=await readFile(metadataPath);
  if (manifest.markcut_metadata_sha256 && manifest.markcut_metadata_sha256!==sha256(metadataBytes)) throw new Error('Markcut metadata hash differs from the approved manifest');
  if (index.manifest_hash!==sha256(manifestBytes) || index.markcut_metadata_sha256!==sha256(metadataBytes)) throw new Error('Vision index provenance hashes do not match source manifest and metadata');
  if (!Array.isArray(index.sources) || index.sources.length!==manifest.media.length || index.sources.some(source=>!manifest.media.some(media=>media.id===source.source_id&&media.sha256===source.source_sha256))) throw new Error('Vision index source evidence does not match approved manifest hashes');
  if (!Array.isArray(index.findings) || index.findings.length > 0) {
    throw new Error(`Vision index contains unresolved evidence gaps: ${(index.findings || []).join('; ')}`);
  }
  const evidence = evidenceFromIndex(index);
  evidence.vision_segment_index_sha256 = sha256(indexBytes);
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  const evidenceStat=await realpath(evidencePath);
  if (!confined(runPath,evidenceStat) || sha256(await readFile(evidencePath))!==sha256(Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`))) throw new Error('Vision evidence artifact failed path or content verification');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  const writtenEvidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  return {
    status: 'COMPLETED',
    output: { 'vision-evidence.json': evidencePath, 'vision-segment-index.json': indexPath, 'metadata.json': metadataPath },
    artifacts: { 'vision-evidence.json': writtenEvidence, 'vision-segment-index.json': index, 'metadata.json': metadata },
    evidence: writtenEvidence,
    markcut: markcutResult ? { invoked: true } : { invoked: false, reused: true },
  };
}

export default { run };
