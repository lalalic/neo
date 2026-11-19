import {randomBytes,createHash} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

export const key = () => randomBytes(20).toString('hex');
export const assertInput = body => {
  if(body?.model!=='neo')throw Error('unsupported model (expected neo)');
  if(typeof body.input==='string')return [{role:'user',text:body.input,images:[]}];
  if(!Array.isArray(body.input)||body.input.length<1||body.input.length>128)throw Error('input must be a string or 1–128 message items');
  const result=[];
  for(const item of body.input){
    if(!item||!['system','developer','user','assistant'].includes(item.role))continue;
    const parts=typeof item.content==='string'?[{type:'input_text',text:item.content}]:item.content;
    if(!Array.isArray(parts)||parts.length>40)throw Error('unsupported content');
    const texts=[],images=[];
    for(const part of parts){
      if(['input_text','output_text','text'].includes(part?.type) && typeof part.text==='string'){
        texts.push(part.text);
      }else if(['input_image','image_url'].includes(part?.type)){
        const url=typeof part.image_url==='string'?part.image_url:part.image_url?.url;
        const match=typeof url==='string'&&/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/.exec(url);
        if(!match||match[2].length>14*1024*1024)throw Error('only bounded image data URIs are supported');
        const buffer=Buffer.from(match[2],'base64');
        if(buffer.length<12||buffer.length>10*1024*1024)throw Error('image size invalid');
        const valid=match[1]==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
          match[1]==='jpeg'?buffer[0]===255&&buffer[1]===216:
          buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
        if(!valid)throw Error('image format/header mismatch');
        images.push({type:match[1],base64:match[2]});
      }else throw Error('unsupported message part: '+String(part?.type));
    }
    result.push({role:item.role,text:texts.join('\n'),images});
  }
  if(!result.length)throw Error('no textual message roles');
  return result;
};
export const compact = messages => messages.map(m=>({...m,images:m.images.map(i=>({type:i.type,sha256:i.sha256??createHash('sha256').update(i.base64,'utf8').digest('hex')}))}));
export const signature = messages => JSON.stringify(messages);
export const isPrefix = (long,short) => short.length<=long.length&&short.every((m,i)=>signature([m])===signature([long[i]]));
export const render = messages => messages.map(m=>`[${m.role}]\n${m.text}\n[/${m.role}]`).join('\n\n');
export function materializeImages(messages,dir){
  const paths=[];
  mkdirSync(dir,{recursive:true,mode:0o700});
  for(const msg of messages)for(const img of msg.images){
    const ext=img.type==='jpeg'?'jpg':img.type;
    const file=join(dir,'image-'+key()+'.'+ext);
    writeFileSync(file,Buffer.from(img.base64,'base64'),{mode:0o600,flag:'wx'});
    paths.push(file);
  }
  return paths;
}
