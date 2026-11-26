/** Shared executable Visioner. Projects own input scope, transfer authorization,
 * domain context, review and project-specific output contracts. Markcut owns
 * perception, segmentation and normalization. No provider fallback on failure.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_EXTS, VIDEO_EXTS } from './media-types.mjs';

const quote = s => "'" + String(s).replaceAll("'", "'\\''") + "'";
const modulePath = name => fileURLToPath(new URL(name, import.meta.url));
const defaultAdapter = [process.execPath, modulePath('./deepseek-infer.mjs')];
const defaultAgent = [process.execPath, modulePath('./deepseek-segment.mjs')].map(quote).join(' ') + ' --prompt {prompt}';

export function inferenceArgs({adapterCommand = defaultAdapter, agentCommand = defaultAgent} = {}) {
  if (!Array.isArray(adapterCommand) || !adapterCommand.length || adapterCommand.some(s=>typeof s!=='string'||!s.trim())) throw Error('Invalid Visioner adapterCommand');
  if (typeof agentCommand!=='string' || !agentCommand.trim()) throw Error('Invalid Visioner agentCommand');
  const command = adapterCommand.map(quote).join(' ');
  return ['--itt',command+' --input {input} --prompt {prompt_quoted}',
    '--vtt',command+' --input {input} --prompt {prompt_quoted} --sample-interval {sample_interval}',
    '--agent',agentCommand];
}

export async function runVisioner({folder, execute, cli=['markcut'], contextText='', allowInference=true,
  adapterCommand, agentCommand, externalTransferAuthorized=false}) {
  const files = readdirSync(folder).filter(file=>
    [...IMAGE_EXTS,...VIDEO_EXTS].includes(extname(file).toLowerCase()) && statSync(join(folder,file)).isFile()).sort();
  if (!files.length) throw Error('Media folder has no images or videos');
  const path = join(folder,'metadata.json');
  const read = async () => {try{return JSON.parse(await readFile(path,'utf8'))}catch{return {}}};
  const complete = metadata => files.every(file=>{
    const item=metadata[file];
    return typeof item?.perception?.desc==='string' && !!item.perception.desc.trim() &&
      (!VIDEO_EXTS.has(extname(file).toLowerCase()) || (item.perception.segments &&
        typeof item.perception.segments==='object'&&!Array.isArray(item.perception.segments)));
  });
  const normalized = metadata => files.every(file=>{
    const item=metadata[file];
    return item && Object.hasOwn(item,'normalized') && (item.normalized===null ||
      (typeof item.normalized==='string' && item.normalized.startsWith('.normalized/') &&
        !item.normalized.slice('.normalized/'.length).includes('/') && existsSync(join(folder,item.normalized))));
  });
  if(!Array.isArray(cli)||!cli.length||cli.some(s=>typeof s!=='string'))throw Error('Invalid Markcut CLI');
  if(typeof execute!=='function')throw Error('Visioner requires Markcut command runner');
  let metadata=await read(), invoked=false;
  if(!complete(metadata)){
    if(!allowInference)throw Error('Vision metadata requires perception and inference was disabled');
    if(!externalTransferAuthorized && (adapterCommand===undefined || agentCommand===undefined))
      throw Error('DeepSeek inference requires project-authorized external transfer or explicit local adapters');
    const args=[...cli,'vision',folder];
    if(contextText)args.push('--instruct',contextText);
    await execute([...args,...inferenceArgs({adapterCommand,agentCommand})]);
    invoked=true;metadata=await read();
  }
  if(!normalized(metadata)){
    await execute([...cli,'vision',folder,'--normalize-only']);
    invoked=true;metadata=await read();
  }
  if(!complete(metadata))throw Error('Markcut Vision metadata incomplete: missing source descriptions or segments');
  return {path,metadata,markcut:{invoked,reused:!invoked}};
}
