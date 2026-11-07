#!/usr/bin/env node
/** Neo Project shared TTS: a concrete, verified audio artifact, never fabricated audio.
 * Uses macOS voices through system `say`; vendor/voice-clone adapters can be
 * introduced behind this public CLI without requiring project Agent changes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function fail(message) { throw new Error(message); }
export function parseTtsArgs(argv) {
  const allowed = new Set(['text','text-file','output','voice','rate','node']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (['--help','-h'].includes(item)) { if(argv.length>1)fail('help cannot be combined with options');return {help:true}; }
    if(!item.startsWith('--'))fail('unexpected argument: '+item);
    const [raw,inline] = item.slice(2).split(/=(.*)/s,2);
    if(!allowed.has(raw)||options[raw]!==undefined)fail('unknown/duplicate TTS option: '+item);
    const value=inline??argv[++i];
    if(typeof value!=='string'||!value.trim())fail('--'+raw+' requires a nonempty value');
    options[raw]=value;
  }
  if((options.text===undefined)===(options['text-file']===undefined))fail('provide exactly one of --text or --text-file');
  if(!options.output||!isAbsolute(options.output))fail('--output requires an absolute path');
  if(!['.m4a','.wav'].includes(extname(options.output).toLowerCase()))fail('output must be .m4a or .wav');
  if(!['local'].includes(options.node??'local'))fail('unsupported TTS node; select local (Neo Master). No SSH aliases are used.');
  const voice=options.voice??'Tingting';
  if(!/^[\p{L}\p{N} ()_-]{1,80}$/u.test(voice))fail('invalid voice name');
  const rate=Number(options.rate??'200');
  if(!Number.isInteger(rate)||rate<90||rate>350)fail('--rate must be 90–350 words/minute');
  const text=options.text??readFileSync(resolve(options['text-file']),'utf8');
  if(!text.trim()||text.length>6000)fail('TTS input must be 1–6000 characters');
  if(/[\x00-\x08\x0b\x0e-\x1f]/.test(text))fail('TTS input contains control characters');
  return {text,output:resolve(options.output),voice,rate,node:'local'};
}

function execute(command,args,options={}) {
  const r=spawnSync(command,args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024,...options});
  if(r.error||r.status!==0)fail(command+' failed: '+(r.error?.message||r.stderr||r.stdout||r.status).toString().slice(0,500));
  return r.stdout;
}
export function synthesize(options,{run=execute}={}) {
  const start=Date.now();
  const output=options.output;
  if(existsSync(output))fail('refusing to overwrite existing TTS artifact: '+output);
  mkdirSync(dirname(output),{recursive:true});
  const temp=resolve(dirname(output),'.'+randomUUID()+'.aiff');
  const encoded=resolve(dirname(output),'.'+randomUUID()+extname(output));
  try {
    // Passing the text as a separate argv element prevents shell injection.
    run('/usr/bin/say',['-v',options.voice,'-r',String(options.rate),'-o',temp,options.text]);
    if(!existsSync(temp)||statSync(temp).size<2048)fail('TTS engine generated no audio');
    const args=['-hide_banner','-loglevel','error','-y','-i',temp];
    if(extname(output).toLowerCase()==='.wav')args.push('-ar','24000','-ac','1','-c:a','pcm_s16le');
    else args.push('-ar','24000','-ac','1','-c:a','aac','-b:a','96k');
    run('ffmpeg',[...args,encoded]);
    if(!existsSync(encoded)||statSync(encoded).size<2048)fail('encoded TTS audio is empty');
    const probe=JSON.parse(run('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',encoded]));
    const duration=Number(probe.format?.duration);
    if(!Number.isFinite(duration)||duration<0.25||!probe.streams?.some(s=>s.codec_type==='audio'))fail('TTS file failed duration/audio-stream validation');
    renameSync(encoded,output);
    return {status:'PASS',engine:'macos-say',node:options.node,voice:options.voice,output,format:extname(output).slice(1),durationSeconds:Number(duration.toFixed(3)),elapsedMs:Date.now()-start};
  }finally{
    rmSync(temp,{force:true});rmSync(encoded,{force:true});
  }
}
export function runTts(argv,services={}) {
  const options=parseTtsArgs(argv);
  if(options.help)return {help:'neo project tts (--text TEXT | --text-file PATH) --output ABSOLUTE.m4a [--voice Tingting] [--rate 200] [--node local]'};
  return synthesize(options,services);
}
if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(new URL(import.meta.url).pathname)) {
  try{console.log(JSON.stringify(runTts(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
