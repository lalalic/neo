/** Source-review gate owned by Vlog Visioner Shortcut, hosted by a normal
 * durable Relay child Task. Never changes Relay's human-review lifecycle.
 * The child Worker owns the existing hostInvocation and AWAITING_DECISION;
 * the Shortcut does not confuse WAITING_EVENT with a human decision.
 */
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const childTaskId='shortcut-content-run-visioner-review';
export async function reviewRequested(run){
 const file=join(run,'review-stages.json');
 if(!existsSync(file))return false;
 const json=JSON.parse(await readFile(file,'utf8'));
 if(json===null||typeof json!=='object'||Array.isArray(json)||typeof json.visioner!=='boolean')
  throw Error('Invalid owner review-stages.json: visioner must be true/false');
 return json.visioner;
}
async function call(context,args,cwd){
 if(context.signal?.aborted)throw Error('Visioner Review interrupted');
 const r=await context.runCommand(args,cwd);
 if(r?.code!==0)throw Error('Visioner Review command failed: '+args.slice(0,3).join(' ')+': '+String(r?.stderr||r?.stdout||r?.code).slice(-800));
 try{return JSON.parse(String(r.stdout))}catch{throw Error('Visioner Review command emitted invalid JSON: '+args.slice(0,3).join(' '))}
}
const taskArgs=input=>['--repo',input.repository,'--id',input.jobId,'--task-id',childTaskId];
function identity(input){
 if(!input||typeof input.jobId!=='string'||!/^\d+$/.test(input.jobId)||
    typeof input.taskId!=='string'||input.taskId!=='content-run'||
    typeof input.repository!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)||
    typeof input.executionId!=='string'||!input.executionId)
  throw Error('Visioner source Review requires an authenticated current Relay Shortcut Task identity');
}
const receiptName='visioner-review-result.json';
export async function waitForSourceReview(context,run,input){
 // Existing Shortcut context supplies a Job ID but not repository or parent
 // executionId. Resolve both from authoritative ACTIVE Relay SQLite state,
 // instead of modifying Relay core or inventing a Task identity.
 const jobId=String(input?.jobId??''),repository=input?.repository||process.env.NEO_RELAY_REPOSITORY||'lalalic/neo';
 if(!/^\d+$/.test(jobId)||input?.taskId!=='content-run')throw Error('Invalid bound Visioner Shortcut Job/Task identity');
 const job=await call(context,['agents-relay','job','show','--repo',repository,'--id',jobId,'--no-github'],run);
 if(String(job.id)!==jobId||job.repository!==repository||job.state!=='ACTIVE'||
    job.executionMode!=='shortcut'||job.contentOnly!==true||job.projectPath!=='vlog')
  throw Error('Visioner Review Job is not the active canonical shortcut Project');
 const parent=await call(context,['agents-relay','task','show',
   '--repo',repository,'--id',jobId,'--task-id',input.taskId,'--no-github'],run);
 if(parent.id!==input.taskId||parent.state!=='RUNNING'||!parent.leaseOwner||
    typeof parent.executionId!=='string'||!parent.executionId||
    parent.output?.kind!=='file'||parent.output?.path!==join(run,'neo-project-run.result.json')||
    (input.executionId && input.executionId!==parent.executionId))
  throw Error('Visioner Review cannot bind to a current leased Shortcut execution');
 input={...input,jobId,repository,executionId:parent.executionId};
 identity(input);
 const check=await call(context,[process.execPath,join(input.projectPath,'scripts/validate-stage.mjs'),'visioner',run],run);
 if(check.status!=='PASS')throw Error('Visioner evidence failed Stage validation before human Review');
 await call(context,[process.execPath,join(input.projectPath,'scripts/visioner-review-to-md.mjs'),run],run);
 const receiptPath=join(run,receiptName),inputPath=join(run,'visioner-review-task.md');
 const manifest=await readFile(join(run,'source-manifest.json'));
 const manifestSha=createHash('sha256').update(manifest).digest('hex');
 const taskInput=`# Visioner source human-review checkpoint

This is a human Review child Task created by the Vlog Visioner Shortcut; not a creative DAG node or publication authorization. The Shortcut already generated and verified original vision-evidence.json and visioner-review.md. Do not repeat Vision inference on initial entry.

Canonical Run: ${run}
Review MD: ${join(run,'visioner-review.md')}
Review result file: ${receiptPath}
Source manifest SHA256: ${manifestSha}

Use only your *injected current child Task* jobId/taskId/executionId, NEVER the parent Shortcut execution identity. Validate Visioner Stage and run:
  neo project review checkpoint --project vlog --path ${run} --stage visioner
The checkpoint commits the exact review Markdown to immutable Run Git SHA. Then create a private local JSON arguments file (do not commit it) containing:
  {"path":"${join(run,'visioner-review.md')}","relay":{"jobId":"<CURRENT_CHILD_JOB_ID>","taskId":"<CURRENT_CHILD_TASK_ID>","executionId":"<CURRENT_CHILD_EXECUTION_ID>"}}
Call the existing Neo.app federated Preview tool through its local CLI facade:
  neo mcp call markcut.preview --args-file <ABSOLUTE_ARGS_JSON_PATH>
Neo's registered MCP wrapper automatically binds the Relay hostInvocation and transitions this current child Task to AWAITING_DECISION. Do not call review.interactive begin/wait/ready yourself. A successful Preview delivery receipt is PENDING, not user approval. Upon actual resumed approved decision for the same revision, validate Stage and write the receipt below. On changes_requested, inspect Scene/time comments, correct source-grounded data against originals, revalidate, commit a fresh revision and call the same tool again. Never invent approval or modify input media.

After a proven approved final revision, write ${receiptPath} JSON exactly:
{"status":"APPROVED","jobId":"${input.jobId}","taskId":"${childTaskId}","sourceManifestSha256":"${manifestSha}","revision":"<the exact full approved 40-character Git SHA>"}
Only then complete your Task. If an irrecoverable blocker exists, fail transparently without writing a receipt. Never publish.
`;

 if(!existsSync(inputPath))await writeFile(inputPath,taskInput,{flag:'wx',mode:0o600});
 let current;
 try{current=await call(context,['agents-relay','task','show',...taskArgs(input),'--no-github'],run)}catch{current=null;}
 if(!current){
  const created=await call(context,['agents-relay','task','create',
   '--repo',input.repository,'--id',input.jobId,'--task-id',childTaskId,
   '--parent',input.taskId,'--agent','vlog-visioner','--title','Visioner source interactive Review',
   '--input-file',inputPath,'--output','file','--output-path',receiptPath,
   '--idempotency-key',`visioner-review-${input.jobId}`],run);
  if(String(created.id??created.task?.id??created.taskId)!==childTaskId)
   throw Error('Unexpected Visioner human-review Task identity');
 }
 // Review owns an ordinary durable child Task with native AWAITING_DECISION.
 // Only durable SUCCEEDED + accepted current hostInvocation can release the
 // parent Shortcut, never a Markcut preview ACK or an arbitrary local file.
 while(true){
  if(context.signal?.aborted)throw Error('Visioner source Review interrupted');
  const task=await call(context,['agents-relay','task','show',...taskArgs(input),'--no-github'],run);
  if(task.state==='SUCCEEDED'){
   if(task.interactiveInvocation?.status!=='approved'||!task.interactiveInvocation?.decidedAt)
    throw Error('Visioner Review child succeeded without an approved hostInvocation');
   if(!existsSync(receiptPath))throw Error('Visioner Review child missing verified receipt');
   const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
   if(receipt?.status!=='APPROVED'||receipt.jobId!==input.jobId||receipt.taskId!==childTaskId||
      receipt.sourceManifestSha256!==manifestSha||receipt.revision!==task.interactiveInvocation.revision||
      !/^[a-f0-9]{40}$/.test(receipt.revision))
    throw Error('Visioner Review receipt is not bound to approved exact revision');
   const final=await call(context,[process.execPath,join(input.projectPath,'scripts/validate-stage.mjs'),'visioner',run],run);
   if(final.status!=='PASS')throw Error('Human-reviewed Visioner evidence failed final Stage gate');
   return {revision:receipt.revision,taskId:childTaskId};
  }
  if(['FAILED','CANCELLED','BLOCKED'].includes(task.state))
   throw Error('Visioner human-review Task '+task.state+': '+String(task.error??task.failureReason??'unknown blocker'));
  await new Promise(resolve=>setTimeout(resolve,2500));
 }
}
