/** Verified Z.ai webpage lifecycle transport. Unlike ChatGPT, Z.ai cannot use
 * Neo MCP reply events; its own WebHelm Action verifies chat:completion done.
 * Never call the Z.ai private HTTP API or manufacture a completion receipt.
 */
import {writeFileSync,readFileSync,statSync,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {key} from './input.mjs';
import {runCLI} from './webhelm.mjs';
import {reportText,reportComplete} from './report.mjs';

const Z_HOME='https://chat.z.ai/';
export const Z_BOOTSTRAP_URL='https://neoy.qili2.com/files/z-chat/bootstrap.md';
const execFileAsync=promisify(execFile);
const NEO_CLI=process.env.NEO_MODEL_NEO_CLI??'/opt/homebrew/bin/neo';
// The issuer reads the local Neo operator credential and writes *only* a
// one-hour interactive MCP access token to a private 0600 file. Never reuse
// the Model Gateway Bearer token or any long-lived Neo operator credential.
async function issueZAccessToken(outputPath){
  try{
    await execFileAsync(NEO_CLI,[
      'mcp','token','issue','--output',outputPath,
      '--client-name','Z.ai interactive via Neo Models Gateway'
    ],{timeout:30000,maxBuffer:4096});
  }catch{
    throw Error('Unable to issue a short-lived Neo MCP token for Z.ai bootstrap');
  }
}

async function revokeZAccessToken(outputPath){
  try{
    await execFileAsync(NEO_CLI,['mcp','token','revoke','--file',outputPath],{timeout:30000,maxBuffer:4096});
  }catch{throw Error('Unable to revoke failed Z.ai bootstrap access token')}
}

export class ZWebHelmTransport {
  constructor({binary=join(homedir(),'.local','bin','webhelm'),
    tempDir=join(homedir(),'.local','share','neo','model-gateway','tmp'),
    exec=runCLI,issueToken=issueZAccessToken,revokeToken=revokeZAccessToken,timeoutSeconds=90,overallTimeoutSeconds=540}={}){
    if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<1||timeoutSeconds>120)
      throw Error('Z.ai completion timeout must be 1–120 seconds');
    this.binary=binary;this.tempDir=tempDir;this.exec=exec;this.issueToken=issueToken;this.revokeToken=revokeToken;this.timeoutSeconds=timeoutSeconds;
    if(!Number.isInteger(overallTimeoutSeconds)||overallTimeoutSeconds<timeoutSeconds||overallTimeoutSeconds>1800)
      throw Error('Z.ai total completion deadline must be between single poll timeout and 1800 seconds');
    this.overallTimeoutSeconds=overallTimeoutSeconds;
    this.answers=new Map();this.pendingSessions=new Map();
    mkdirSync(tempDir,{recursive:true,mode:0o700});
  }
  async #run(args){
    const r=await this.exec(this.binary,args);
    if(!r||r.ok===false||r.result?.ok===false)throw Error('Z.ai WebHelm action failed: '+String(r?.result?.error??r?.error??'unknown').slice(0,300));
    return r.result?.value??r.result??r;
  }
  async #submit(action,text,threadId,responseId,{storeAnswer=true}={}){
    if(typeof text!=='string'||!text.trim())throw Error('Z.ai requires a non-empty message');
    // Begin on a blank owned tab: Z's hidden-page rAF shim must install
    // BEFORE chat.z.ai loads, including when resuming an existing thread.
    const session=await this.#run(['session','start','--url','about:blank']);
    if(!/^[a-f0-9]{16}$/.test(session.session_id??''))throw Error('Z.ai WebHelm Session has invalid ID');
    const sid=session.session_id;
    if(session.workspace!=='WebHelm'){
      await this.#run(['session','stop',sid]).catch(()=>{});
      throw Error('Z.ai model transport requires the default WebHelm workspace');
    }
    const path=join(this.tempDir,'z-config-'+key()+'.json');
    const config={message:text,mode:'chat',wait:false,timeout_seconds:this.timeoutSeconds,
      ...(threadId?{thread_id:threadId}:{})};
    let success=false;
    try{
      writeFileSync(path,JSON.stringify(config),{mode:0o600,flag:'wx'});
      const submitted=await this.#run(['platform','run','z',action,'--session-id',sid,'--config',path]);
      const url=typeof submitted?.thread_url==='string'?submitted.thread_url:null;
      let parsed=null;
      try{parsed=url?new URL(url):null}catch{}
      if(submitted?.status!=='submitted'||
        submitted?.verified_by!=='matching user message + cleared composer + durable thread URL'||
        parsed?.origin!==Z_HOME.slice(0,-1)||
        parsed?.pathname!=='/c/'+submitted.thread_id||
        (threadId&&threadId!==submitted.thread_id))
        throw Error('Z.ai has no verified submission; browser Session retained: '+sid);
      // From here, the user's message is already accepted by the real site.
      // Never replay it. Continue to read the ORIGINAL WebHelm Session via
      // resume=true (no submit) for potentially long Neo MCP bootstrap calls.
      // Keep the temporary one-hour token valid while Z is still using it.
      const deadline=Date.now()+this.overallTimeoutSeconds*1000;
      const resume={resume:true,thread_id:submitted.thread_id,mode:'chat',wait:true,
        timeout_seconds:this.timeoutSeconds};
      writeFileSync(path,JSON.stringify(resume),{mode:0o600});
      let receipt=null;
      while(Date.now()<deadline){
        const remaining=Math.ceil((deadline-Date.now())/1000);
        resume.timeout_seconds=Math.max(1,Math.min(this.timeoutSeconds,remaining));
        writeFileSync(path,JSON.stringify(resume),{mode:0o600});
        receipt=await this.#run(['platform','run','z',action,'--session-id',sid,'--config',path]);
        if(receipt?.status==='completed')break;
        if(receipt?.status!=='pending')
          throw Error('Z.ai resume returned an unexpected receipt; browser Session retained: '+sid);
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(receipt?.status!=='completed'||typeof receipt.answer!=='string'||!receipt.answer.trim()||
        receipt.verified_by!=='Z.ai webpage SSE chat:completion done=true'||
        receipt.thread_id!==submitted.thread_id||receipt.thread_url!==submitted.thread_url)
        throw Error('Z.ai completion not verified before deadline; original browser Session retained: '+sid);
      if(storeAnswer)this.answers.set(responseId,receipt.answer);
      success=true;
      return receipt;
    }catch(error){
      this.pendingSessions.set(responseId,sid);
      throw Error(error.message+'; Z.ai manual reconciliation Session: '+sid);
    }finally{
      rmSync(path,{force:true});
      if(success){
        try{await this.#run(['session','stop',sid])}
        catch(error){process.stderr.write('[models/z] WebHelm cleanup failed: '+error.message+'\n')}
      }
    }
  }
  async bootstrapThread(responseId){
    if(!/^resp_[a-f0-9]{40}$/.test(responseId??''))throw Error('Z.ai requires a durable model response ID');
    const secretDir=mkdtempSync(join(this.tempDir,'z-bootstrap-'));
    const tokenFile=join(secretDir,'access.token');
    let token='',verified=false;
    try{
      try{await this.issueToken(tokenFile)}
      catch{throw Error('Unable to issue a short-lived Neo MCP token for Z.ai bootstrap')}
      const file=statSync(tokenFile);
      if(!file.isFile()||(file.mode&0o077)!==0)throw Error('Z.ai Neo access token file must be private (0600)');
      token=readFileSync(tokenFile,'utf8').trim();
      if(token.length<20||token.length>4096||/\s/.test(token))throw Error('Z.ai Neo access token is invalid');
      const bootstrap=`bootstrap the chat with ${Z_BOOTSTRAP_URL} with token ${token}.`;
      const receipt=await this.#submit('new-thread',bootstrap,null,responseId,{storeAnswer:false});
      if(receipt.answer.trim().split(/\r?\n/)[0].trim()!=='NEO_BOOTSTRAP_PASS'){
        throw Error('Z.ai did not verify Neo MCP bootstrap; thread '+receipt.thread_id+' needs manual reconciliation');
      }
      verified=true;
      // The initial assistant answer is bootstrap diagnostics, not the
      // first model result. The caller submits the real user request next.
      return {thread_id:receipt.thread_id,thread_url:receipt.thread_url,
        project_id:null,status:'completed',bootstrap_verified:true};
    }catch(error){
      // Never allow the access token to leak into Gateway stderr or an SSE.
      const safe=token?String(error.message).split(token).join('[REDACTED]'):String(error.message);
      throw Error(safe);
    }finally{
      token='';
      if(!verified&&existsSync(tokenFile)&&!this.pendingSessions.has(responseId)){
        // If bootstrap is blocked or uncertain, revoke the short-lived token
        // rather than leaving an unused credential authorized for one hour.
        try{await this.revokeToken(tokenFile)}
        catch{process.stderr.write('[models/z] Short-lived bootstrap token could not be revoked\n')}
      }
      rmSync(secretDir,{recursive:true,force:true});
    }
  }
  async newThread(){throw Error('Z.ai model requests must first use bootstrapThread');}
  async newTurn(threadId,text,_files=[],responseId){
    if(!/^[A-Za-z0-9_-]{8,100}$/.test(threadId??''))throw Error('invalid Z.ai thread ID');
    if(!responseId)throw Error('Z.ai requires a durable model response ID');
    return this.#submit('new-turn',text,threadId,responseId);
  }
  async waitForResult(id,store){
    const answer=this.answers.get(id);
    if(typeof answer!=='string')throw Error('Z.ai verified completion receipt missing');
    this.answers.delete(id);
    if(store.response(id)?.status!=='in_progress')throw Error('Z.ai response is no longer in progress');
    reportText(store,id,answer);
    return reportComplete(store,id).output[0].content[0].text;
  }
}
