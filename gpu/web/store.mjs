import {randomBytes,timingSafeEqual,createHmac} from 'node:crypto';
import {openSync,writeFileSync,readFileSync,mkdirSync,chmodSync,existsSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {GpuError,atomicJson,readJson} from '../common.mjs';
export const webRoot=()=>process.env.NEO_GPU_WEB_DIR||join(homedir(),'.config','neo','gpu','web');
export const sessionRoot=()=>process.env.NEO_GPU_WEB_SESSIONS||join(homedir(),'.local','state','neo','gpu','web');
export function validateService(name){if(!/^[a-z][a-z0-9-]{0,63}$/.test(name||''))throw new GpuError('Invalid web service name');return name;}
export function configFile(){return join(webRoot(),'services.json');}
export function tokenFile(name){return join(webRoot(),'tokens',validateService(name)+'.token');}
export function sessionFile(name){return join(sessionRoot(),validateService(name)+'.json');}
export function services(){return readJson(configFile(),{version:1,services:{}});}
export function service(name){validateService(name);return services().services[name]||null;}
export function session(name){return readJson(sessionFile(name),{phase:'stopped'});}
export function saveSession(name,data){atomicJson(sessionFile(name),data);}
export function issueToken(name){
  const token=randomBytes(32).toString('base64url');
  const p=tokenFile(name);mkdirSync(join(webRoot(),'tokens'),{recursive:true,mode:0o700});
  writeFileSync(p,token+'\n',{flag:'wx',mode:0o600});chmodSync(p,0o600);
  return token;
}
export function token(name){return readFileSync(tokenFile(name),'utf8').trim();}
export function register(name,config){
  validateService(name);
  const all=services();if(all.services[name])throw new GpuError('Web service already exists: '+name);
  const key=issueToken(name);
  all.services[name]=config;atomicJson(configFile(),all);
  return key;
}
export function safeMatch(a,b){
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&aa.length!==0&&timingSafeEqual(aa,bb);
}
export function cookieName(name){return 'neo_gpu_'+validateService(name).replaceAll('-','_');}
export function sessionCookie(name,master,now=Date.now()){
  const expiry=Math.floor(now/1000)+3600;
  const nonce=randomBytes(12).toString('hex');
  const message=`${name}.${expiry}.${nonce}`;
  const sig=createHmac('sha256',master).update(message).digest('base64url');
  return `${message}.${sig}`;
}
export function cookieValid(name,master,value,now=Date.now()){
  if(typeof value!=='string'||value.length>256)return false;
  const m=new RegExp('^'+name.replaceAll('-','\\-')+'\\.(\\d{10})\\.([0-9a-f]{24})\\.([A-Za-z0-9_-]{43})$').exec(value);
  if(!m)return false;
  const exp=Number(m[1]),sec=Math.floor(now/1000);
  if(!Number.isSafeInteger(exp)||sec>exp||exp-sec>3600)return false;
  const content=`${name}.${m[1]}.${m[2]}`;
  const expected=createHmac('sha256',master).update(content).digest('base64url');
  return safeMatch(expected,m[3]);
}
export function cookieFromHeader(name,header){
  for(const part of String(header||'').split(';')){
    const eq=part.indexOf('=');
    if(eq>0&&part.slice(0,eq).trim()===cookieName(name))return part.slice(eq+1).trim();
  }
  return '';
}
