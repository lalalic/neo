import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync=promisify(execFile);
const DEFAULT_MODEL='mlx-community/whisper-large-v3-turbo-asr-fp16';
const MAX_AUDIO_BYTES=25*1024*1024;
const AUDIO_EXTENSIONS=new Set(['.ogg','.opus','.mp3','.m4a','.wav','.webm','.aac','.flac','.aiff','.aif']);

export function isAudioAttachment(attachment){
  const mime=String(attachment?.mimeType||attachment?.contentType||'').toLowerCase();
  return mime.startsWith('audio/')||AUDIO_EXTENSIONS.has(path.extname(String(attachment?.name||'')).toLowerCase());
}

async function transcribeOne(attachment,{fetchImpl=fetch,env=process.env,run=execFileAsync}={}){
  if(Number(attachment.size||0)>MAX_AUDIO_BYTES) throw Error('audio attachment too large');
  const response=await fetchImpl(attachment.url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw Error(`audio download failed (${response.status})`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>MAX_AUDIO_BYTES) throw Error('audio attachment too large');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'family-tutor-asr-'));
  try{
    const ext=path.extname(String(attachment.name||'')).toLowerCase();
    const input=path.join(directory,`input${AUDIO_EXTENSIONS.has(ext)?ext:'.audio'}`);
    const output=path.join(directory,'transcript');
    await fs.writeFile(input,bytes,{mode:0o600});
    const args=['--from','mlx-audio','mlx_audio.stt.generate',
      '--model',env.FAMILY_TUTOR_ASR_MODEL||DEFAULT_MODEL,
      '--audio',input,'--output-path',output,'--format','txt'];
    if(env.FAMILY_TUTOR_ASR_LANGUAGE) args.push('--language',env.FAMILY_TUTOR_ASR_LANGUAGE);
    await run('uvx',args,{timeout:600000,maxBuffer:4*1024*1024});
    const result=(await fs.readFile(`${output}.txt`,'utf8')).trim();
    if(!result) throw Error('local ASR returned an empty transcript');
    return result;
  }finally{
    await fs.rm(directory,{recursive:true,force:true});
  }
}

export async function transcribeAudioAttachments(attachments=[],options={}){
  const parts=[];
  for(const attachment of attachments.filter(isAudioAttachment)){
    parts.push(await transcribeOne(attachment,options));
  }
  return parts.join('\n').trim()||null;
}
