#!/usr/bin/env node
/** Content Distribution's ElevenLabs Scribe adapter for Markcut vision --stt.
 * Private, idempotent, permission-gated. Requires Node.js with fs.openAsBlob. */
import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {readFile, writeFile, mkdir, stat, realpath, access} from 'node:fs/promises';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const API='https://api.elevenlabs.io/v1/speech-to-text';
const MODELS=new Set(['scribe_v3','scribe_v2']);
const MAX_INPUT_BYTES=250*1024*1024;
const AUDIO_TYPES=new Set(['.mp3','.wav','.m4a','.flac','.ogg','.opus','.aac','.mp4','.mov','.webm']);
const sha=data=>createHash('sha256').update(data).digest('hex');
const stamp=s=>{
 const n=Math.round(s*1000);
 return [Math.floor(n/3600000),Math.floor(n/60000)%60,Math.floor(n/1000)%60]
   .map(x=>String(x).padStart(2,'0')).join(':')+'.'+String(n%1000).padStart(3,'0');
};
const escapeVtt=text=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]/g,' ');
const cjk=/[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
function appendText(prefix,word) {
 const next=word.trim();
 if(!prefix)return next;
 if(!next || /^[,，。！？!?.:：;；、…)}\]]/.test(next))return prefix+next;
 if(cjk.test(next[0])||cjk.test(prefix.at(-1)))return prefix+next;
 return prefix+' '+next;
}
export function validateScribe(doc) {
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||!Array.isArray(doc.words))throw Error('scribe_words_required');
 let lastStart=-1,wordCount=0;
 for(const item of doc.words) {
  if(!['word','spacing','audio_event'].includes(item?.type)) throw Error('scribe_item_type_invalid');
  if(item.type!=='word')continue;
  if(!Number.isFinite(item.start)||!Number.isFinite(item.end)||item.start<0||item.end<=item.start||item.start<lastStart ||
    typeof item.text!=='string'||!item.text.trim())throw Error('scribe_word_invalid');
  if(item.speaker_id!=null && !/^speaker_\d+$/.test(item.speaker_id))throw Error('scribe_speaker_invalid');
  lastStart=item.start;
  wordCount++;
 }
 return wordCount;
}
export function toVtt(doc) {
 validateScribe(doc);
 const speech=doc.words.filter(x=>x.type==='word');
 const cues=[];let current=[];let content='';
 const flush=()=>{
  if(!current.length)return;
  const start=current[0].start,end=current.at(-1).end;
  const id=current[0].speaker_id||'speaker_unknown';
  cues.push(`${stamp(start)} --> ${stamp(end)}\n<v ${id}>${escapeVtt(content)}</v>`);
  current=[];content='';
 };
 for(const word of speech){
  const next=appendText(content,word.text);
  const gap=current.length?word.start-current.at(-1).end:0;
  if(current.length&&(word.speaker_id!==current[0].speaker_id||gap>=0.65||word.end-current[0].start>5||next.length>65))flush();
  content=appendText(content,word.text);
  current.push(word);
 }
 flush();
 return 'WEBVTT\n\n'+cues.join('\n\n')+(cues.length?'\n':'');
}
function pathsFor(input,outputDir){
 const stem=basename(input,extname(input));
 return {vtt:join(outputDir,stem+'.vtt'),raw:join(outputDir,stem+'.scribe.json'),source:join(outputDir,stem+'.scribe-source.json')};
}
async function findCached(paths,fingerprint,model){
 const has=async path=>{try{await access(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e;}};
 const [hasSource,hasRaw,hasVtt]=await Promise.all([has(paths.source),has(paths.raw),has(paths.vtt)]);
 if(!hasSource&&!hasRaw&&!hasVtt)return null;
 // A partial receipt could represent a previously billed API call: never
 // spend again until the operator inspects/reconciles the private artifacts.
 if(!hasSource||!hasRaw)throw Error('scribe_cache_incomplete_no_retry');
 let manifest,raw;
 try{manifest=JSON.parse(await readFile(paths.source,'utf8'));raw=await readFile(paths.raw);}
 catch{throw Error('scribe_cache_invalid');}
 if(manifest.input_sha256!==fingerprint||manifest.model_id!==model||sha(raw)!==manifest.transcript_sha256)
  throw Error('scribe_cache_source_or_hash_mismatch');
 let doc;
 try{doc=JSON.parse(raw.toString('utf8'));}catch{throw Error('scribe_cache_raw_invalid');}
 const vtt=toVtt(doc);
 if(hasVtt){const current=await readFile(paths.vtt,'utf8');if(current!==vtt)throw Error('scribe_cached_vtt_mismatch');}
 else await writeFile(paths.vtt,vtt,{flag:'wx',mode:0o600});
 return {cached:true,model,input_sha256:fingerprint,word_count:validateScribe(doc),vtt_path:paths.vtt};
}
export async function transcribeFile({input,outputDir,model='scribe_v3',confirmCloudUpload=false,apiKey=process.env.ELEVENLABS_API_KEY,fetchImpl=fetch,now=()=>new Date()}={}){
 if(!input||!outputDir)throw Error('input_and_output_dir_required');
 if(!MODELS.has(model))throw Error('unsupported_scribe_model');
 const original=await realpath(resolve(input));
 if(!AUDIO_TYPES.has(extname(original).toLowerCase()))throw Error('unsupported_stt_input_format');
 const info=await stat(original);
 if(!info.isFile()||info.size===0||info.size>MAX_INPUT_BYTES)throw Error('stt_input_invalid_or_too_large');
 const bytes=await readFile(original),inputHash=sha(bytes);
 const target=resolve(outputDir);
 await mkdir(target,{recursive:true,mode:0o700});
 const paths=pathsFor(original,target);
 const cached=await findCached(paths,inputHash,model);
 if(cached)return cached;
 if(!confirmCloudUpload)throw Error('cloud_upload_requires_explicit_source_authorization');
 if(!apiKey)throw Error('ELEVENLABS_API_KEY_missing');
 const form=new FormData();
 const blob=await openAsBlob(original);
 form.set('file',blob,basename(original));form.set('model_id',model);
 form.set('diarize','true');form.set('tag_audio_events','true');form.set('timestamps_granularity','word');
 let response;
 try{response=await fetchImpl(API,{method:'POST',headers:{'xi-api-key':apiKey},body:form,signal:AbortSignal.timeout(240_000)});}
 catch{throw Error('scribe_request_failed_unknown_billing_status_do_not_blindly_retry');}
 if(!response.ok)throw Error(`scribe_request_rejected_http_${response.status}`);
 let doc;
 try{doc=await response.json();}catch{throw Error('scribe_response_not_json');}
 const words=validateScribe(doc),vtt=toVtt(doc);
 const serialized=JSON.stringify(doc,null,2)+'\n';
 const meta={schemaVersion:1,transcription_engine:'elevenlabs-scribe',model_id:model,
  input_sha256:inputHash,input_bytes:info.size,transcript_sha256:sha(serialized),
  word_count:words,observed_at:now().toISOString(),source:'authorized_private_media',
  speaker_attribution:'model_diarization_not_identity'};
 // Cache raw evidence first. Never reuse outputs for different source bytes.
 await writeFile(paths.raw,serialized,{flag:'wx',mode:0o600});
 await writeFile(paths.source,JSON.stringify(meta,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(paths.vtt,vtt,{flag:'wx',mode:0o600});
 return {cached:false,model,input_sha256:inputHash,word_count:words,vtt_path:paths.vtt};
}
function argsOf(argv){
 const options={};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];
  if(arg==='--confirm-cloud-upload'){options.confirmCloudUpload=true;continue;}
  const mapping={'--input':'input','--output-dir':'outputDir','--model':'model'};
  if(!mapping[arg]||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('usage: --input AUDIO --output-dir DIR [--model scribe_v3] --confirm-cloud-upload');
  options[mapping[arg]]=argv[++i];
 }
 return options;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{const result=await transcribeFile(argsOf(process.argv.slice(2)));console.log(JSON.stringify(result));}
 catch(e){console.error('HOLD: '+e.message);process.exitCode=1;}
}
