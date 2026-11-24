import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createThreadProjectVerifier} from './core/thread-verifier.mjs';

const exec = promisify(execFile);
const THREAD=/^[A-Za-z0-9_-]{8,160}$/;
const PROJECT=/^g-p-[A-Za-z0-9_-]{8,128}$/;
const SESSION=/^[A-Za-z0-9_-]{8,160}$/;
const RECEIPT=/^[A-Za-z0-9_-]{16,128}$/;

function lastJSON(output){
  for(const line of String(output||'').trim().split(/\r?\n/).reverse()){
    try{return JSON.parse(line)}catch{/* diagnostic line */}
  }
  throw Error('No trusted WebHelm browser result');
}
async function webhelm(args){
  const {stdout}=await exec(process.env.NEO_MODELS_WEBHELM_COMMAND||'webhelm',args,
    {shell:false,timeout:35_000,maxBuffer:256_000});
  return lastJSON(stdout);
}

/**
 * An Orchestrator control is a claim, not a receipt. This read-only browser
 * verification checks BOTH real Project/thread identities and the successor's
 * user-authored handoff marker in ChatGPT's rendered conversation. The marker
 * must bind predecessor + generation + receipt within the SAME user turn.
 * It never sends a turn, reads assistant output, or returns message text.
 */
export function createOrchestratorHandoffVerifier({run=webhelm,verifyThread=createThreadProjectVerifier({run})}={}){
  return async ({projectId,previousThreadId,nextThreadId,expectedGeneration,handoffReceipt})=>{
    if(!PROJECT.test(projectId??'')||!THREAD.test(previousThreadId??'')||!THREAD.test(nextThreadId??'')||
       previousThreadId===nextThreadId||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0||
       !RECEIPT.test(handoffReceipt??''))throw Error('Invalid Orchestrator handoff identity or receipt');
    await verifyThread({projectId,threadId:previousThreadId});
    await verifyThread({projectId,threadId:nextThreadId});
    // Browser script returns only a boolean. Delimit each field to prevent
    // substring collisions and prohibit matching an assistant-authored text.
    const marks=['neo.orchestrator.handoff.v1',`previousThreadId=${previousThreadId}`,
      `expectedGeneration=${expectedGeneration}`,`handoffReceipt=${handoffReceipt}`];
    const selector='[data-message-author-role="user"], [data-conversation-role="user"]';
    const js=`(() => {
      const marks=${JSON.stringify(marks)};
      return [...document.querySelectorAll(${JSON.stringify(selector)})].some(element => {
        // Current ChatGPT places the user role on a visually-hidden heading.
        // Read only its sibling user-message bubble in the same turn.
        const bubble=element.matches('h4[data-conversation-role="user"]')
          ? element.parentElement?.querySelector('.bg-user-message')
          : element;
        const text=bubble?.textContent||'';
        return marks.every(mark => text.includes(mark));
      });
    })()`;
    // ChatGPT can render a user bubble before upgrading the generic /c URL
    // to its canonical Project path. Require both observations in one session.
    const script=`return await (async()=>{
      const expectedProject=${JSON.stringify(projectId)};
      const expectedThread=${JSON.stringify(nextThreadId)};
      let latest={receiptMatches:false,url:''};
      for(let i=0;i<80;i++){
        const receiptMatches=await js(${JSON.stringify(js)});
        const url=(await page_info()).url;
        latest={receiptMatches,url};
        const segments=String(url||'').split(/[?#]/,1)[0].split('/').filter(Boolean);
        const project=segments[3]||'';
        const canonical=segments.length===6&&segments[0]==='https:'&&segments[1]==='chatgpt.com'&&
          segments[2]==='g'&&segments[4]==='c'&&
          (project===expectedProject||project.startsWith(expectedProject+'-'))&&
          segments[5]===expectedThread;
        if(receiptMatches&&canonical)break;
        await sleep(250);
      }
      return latest;
    })()`;
    const temp=await mkdtemp(join(tmpdir(),'neo-orchestrator-handoff-'));
    let sessionId=null;
    try{
      const file=join(temp,'check.js');await writeFile(file,script,{mode:0o600});
      const started=await run(['session','start','--url',`https://chatgpt.com/c/${encodeURIComponent(nextThreadId)}`]);
      sessionId=started?.session_id;
      if(!SESSION.test(sessionId??''))throw Error('Cannot acquire successor verifier Session');
      const result=await run(['session','exec',sessionId,'--code-file',file]);
      if(result?.ok!==true||result?.value?.receiptMatches!==true)
        throw Error('Successor user turn lacks independently verified handoff receipt');
      // Bind marker and Project/thread URL in the SAME observed browser session,
      // rather than trusting an earlier visit to a potentially changed target.
      let observed;
      try{observed=new URL(result.value.url)}catch{throw Error('Invalid handoff browser URL')}
      const segments=observed.pathname.split('/').filter(Boolean);
      if(observed.protocol!=='https:'||observed.hostname!=='chatgpt.com'||
         observed.username||observed.password||segments.length!==4||
         segments[0]!=='g'||segments[2]!=='c'||
         !(segments[1]===projectId||segments[1].startsWith(projectId+'-'))||
         segments[3]!==nextThreadId)
        throw Error('Handoff receipt was observed outside the verified Project/thread');
      return true;
    }finally{
      if(sessionId){try{await run(['session','stop',sessionId])}catch{/* owned session expires */}}
      await rm(temp,{recursive:true,force:true});
    }
  };
}
