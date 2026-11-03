import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sha256 = async (path) => {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
};

function inside(root, file) {
  const path = relative(root, file);
  return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

function safePath(run, relativePath, scope) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || isAbsolute(relativePath)) throw new Error('run_relative_path_required');
  const fullPath = resolve(run, relativePath);
  const scopePath = resolve(run, scope);
  if (!inside(scopePath, fullPath)) throw new Error('invalid_original_path_scope');
  const actual = realpathSync(fullPath);
  if (!inside(realpathSync(scopePath), actual)) throw new Error('original_asset_symlink_escape');
  if (lstatSync(fullPath).isSymbolicLink()) throw new Error('original_asset_symlink_forbidden');
  return actual;
}

export async function verifyOriginalInput(runDir, analysisInput) {
  const run = realpathSync(runDir);
  if (!inside(resolve(run, '..'), run)) throw new Error('invalid_run');
  const campaign = JSON.parse(readFileSync(resolve(run, 'campaign.json'), 'utf8'));
  if (typeof campaign.original_source_path !== 'string' || !campaign.original_source_path.startsWith('evidence/')) throw new Error('original_source_path_missing');
  const manifestPath = safePath(run, campaign.original_source_path, 'evidence');
  const source = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (source.kind !== 'provider_original' || source.provider_id !== campaign.provider_id) throw new Error('not_a_provider_original');
  if (!Number.isInteger(source.episode_number) || source.episode_number < 1) throw new Error('invalid_episode');
  if (source.acquisition_method !== 'authenticated_rsboost_content_hub') throw new Error('original_acquisition_unverified');
  if (typeof source.source_url !== 'string' || !/^https:\/\/cps\.reelshort\.com\/resource-square\/detail\/[a-f\d]{24}(?:\?|$)/.test(source.source_url)) throw new Error('invalid_provider_source_url');
  if (!/^[a-f\d]{64}$/.test(source.sha256 || '')) throw new Error('missing_source_sha256');
  if (!Number.isInteger(source.bytes) || source.bytes <= 0) throw new Error('missing_source_size');
  if (!Number.isFinite(source.duration_s) || source.duration_s <= 0) throw new Error('missing_source_duration');
  const original = safePath(run, source.path, 'assets');
  if (!/\.mp4$/i.test(original)) throw new Error('original_not_mp4');
  if (analysisInput && realpathSync(resolve(analysisInput)) !== original) throw new Error('analysis_input_must_be_original_mp4');
  if (lstatSync(original).size !== source.bytes) throw new Error('original_size_mismatch');
  if (await sha256(original) !== source.sha256) throw new Error('original_hash_mismatch');
  const inspected = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', original], {encoding:'utf8', timeout:20000});
  if (inspected.status !== 0) throw new Error('original_ffprobe_failed');
  const duration = Number(JSON.parse(inspected.stdout)?.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration-source.duration_s)>0.05) throw new Error('original_duration_mismatch');
  const rights = resolve(run, campaign.rights_evidence_path ?? '');
  if (!inside(resolve(run, 'evidence'), rights) || !existsSync(rights)) throw new Error('rights_evidence_missing');
  return {ok:true, source_path:original, source_sha256:source.sha256, duration_s:duration, episode_number:source.episode_number, story_context_path:campaign.story_context_path ? resolve(run,campaign.story_context_path):null, rights_evidence_path:rights};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = process.argv.indexOf('--run');
  const run = arg < 0 ? null : process.argv[arg+1];
  const inputFlag = process.argv.indexOf('--analysis-input');
  const input = inputFlag < 0 ? null : process.argv[inputFlag+1];
  if (!run || !isAbsolute(run)) {console.error('Usage: node scripts/check-original-source.mjs --run ABSOLUTE_RUN [--analysis-input ABSOLUTE_VIDEO_PATH]');process.exit(2);}
  try {console.log(JSON.stringify(await verifyOriginalInput(run,input),null,2));}
  catch (e) {console.error(`HOLD: ${e.message}`);process.exitCode=1;}
}
