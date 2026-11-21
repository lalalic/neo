import {randomUUID,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createAttachmentStore} from '../../skills/chat-gateway/core/attachments.mjs';
import {sanitizeText} from '../../skills/chat-gateway/core/notify.mjs';

const REQUEST=/^[A-Za-z0-9_-]{8,128}$/;
const THREAD=/^[A-Za-z0-9_-]{8,160}$/;
const PROJECT=/^g-p-[A-Za-z0-9_-]{8,128}$/;
const JOB=/^[A-Za-z0-9_.-]{1,64}$/;
const RECEIPT=/^[A-Za-z0-9_-]{16,128}$/;
const NEEDS=new Set(['none','phone','work_node','retry']);
const MAX_REQUEST_TOMBSTONES=10_000;
const exactKeys=(object,allowed)=>object&&typeof object==='object'&&!Array.isArray(object)&&
  Object.keys(object).every(key=>allowed.includes(key));
const requestFingerprint=(text,attachments)=>createHash('sha256')
  .update(JSON.stringify({text,attachments})).digest('hex');
const deliveryIdentity=requestId=>'delivery_'+createHash('sha256')
  .update('neo.orchestrator.delivery:'+requestId).digest('hex').slice(0,40);
const messageIdentity=requestId=>'message_'+createHash('sha256')
  .update('neo.orchestrator.message:'+requestId).digest('hex').slice(0,40);
// Keep this policy bounded by WebHelm's 1500-character enforcement_context cap
// AFTER generic /v1 top instructions and per-response ID have been appended.
const ORCHESTRATOR_ENFORCEMENT=`Neo Orchestrator: publish one COMPLETE JSON envelope in reply.text seq=1, then a separate reply.completed. Never call chat_report or stream fragments. Schema: {"schema":"neo.orchestrator.reply.v1","message":{"text":"...","level":"info","needs":"none"}}; level may be attention, needs may be none/phone/work_node/retry, optional jobId. Handoff control ONLY after creating a real successor in the SAME Project. Its first USER turn must include neo.orchestrator.handoff.v1, previousThreadId, expectedGeneration, handoffReceipt (16+ safe characters). Control action=replace-thread-id; fields previousThreadId,nextThreadId,expectedGeneration,handoffReceipt. Server verifies.`;

function orchestratorEnforcement(state){
  return ORCHESTRATOR_ENFORCEMENT+
    '\nCurrent verified Orchestrator Project: '+state.projectId+
    '\nCurrent ChatGPT Thread: '+state.threadId+
    '\nCurrent handoff generation: '+state.generation+
    '\nOnly server-authorized handoffs may change the head.';
}

function atomic(path,value){
  const tmp=path+'.'+process.pid+'-'+randomUUID()+'.tmp';
  writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(tmp,path);
}
function parsed(path){try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
const safeJSON=(text)=>{try{return JSON.parse(text)}catch{return null}};
export function parseOrchestratorEnvelope(text){
  const obj=safeJSON(text);
  if(!exactKeys(obj,['schema','message','control'])||obj.schema!=='neo.orchestrator.reply.v1')
    throw Error('invalid orchestrator reply envelope');
  if(!obj.message&&!obj.control)throw Error('empty orchestrator reply envelope');
  let message=null,control=null;
  if(obj.message){
    const m=obj.message;
    if(!exactKeys(m,['text','level','needs','jobId'])||
      typeof m.text!=='string'||!m.text.trim()||m.text.length>20000||
      !['info','attention'].includes(m.level)||
      (m.needs!==undefined&&!NEEDS.has(m.needs))||
      !(m.jobId===undefined||m.jobId===null||typeof m.jobId==='string'&&JOB.test(m.jobId)))
      throw Error('invalid orchestrator message');
    message={text:m.text,level:m.level,needs:m.needs??'none',jobId:m.jobId??null};
  }
  if(obj.control){
    const c=obj.control;
    if(!exactKeys(c,['action','previousThreadId','nextThreadId','expectedGeneration','handoffReceipt'])||
      c.action!=='replace-thread-id'||!THREAD.test(c.previousThreadId)||!THREAD.test(c.nextThreadId)||
      !Number.isSafeInteger(c.expectedGeneration)||c.expectedGeneration<0||
      !RECEIPT.test(c.handoffReceipt??''))throw Error('invalid orchestrator control');
    control={action:c.action,previousThreadId:c.previousThreadId,nextThreadId:c.nextThreadId,
      expectedGeneration:c.expectedGeneration,handoffReceipt:c.handoffReceipt};
  }
  return {schema:obj.schema,message,control};
}

/** Private operational outbox, not a chat transcript. Legacy head is imported read-only once. */
export class OrchestratorChat {
  constructor({store,engine,legacyHeadFile=join(homedir(),'.local/state/neo/chat-gateway/head.json'),verifyHandoff=null,notifier=null}={}){
    if(!store||!engine)throw Error('Models store and engine required');
    this.store=store;this.engine=engine;this.verifyHandoff=verifyHandoff;this.notifier=notifier;this.notifying=false;
    this.dir=join(store.base,'orchestrator');mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.stateFile=join(this.dir,'state.json');
    this.attachments=createAttachmentStore({root:this.dir});
    let state=parsed(this.stateFile);
    if(!state){
      const head=parsed(legacyHeadFile);
      if(!head||!THREAD.test(head.threadId)||!PROJECT.test(head.projectId)){
        this.unavailable='Existing Orchestrator Project/head not verified; refusing to create a competing thread';
        this.state=null;return;
      }
      // Preserve the existing ChatGPT Project and head exactly. Never copy legacy chat history.
      state={codexThreadId:randomUUID(),threadId:head.threadId,projectId:head.projectId,generation:0,sequence:0,requests:{},events:[]};
      atomic(this.stateFile,state);
    }
    // Bind the fixed Codex identity to the already verified legacy head before any turn.
    const sessions=store.listSessions().filter(item=>item.codexThreadId===state.codexThreadId);
    if(sessions.length>1){
      this.unavailable='Duplicate persisted Orchestrator Codex mapping';this.state=null;return;
    }
    if(sessions.length===0){
      if(Object.keys(state.requests).length){this.unavailable='Orchestrator mapping missing; manual reconciliation required';this.state=null;return;}
      const session=store.create([],null,state.codexThreadId);
      session.threadId=state.threadId;session.projectId=state.projectId;
      session.orchestratorGeneration=state.generation;session.status='idle';store.putSession(session);
    }else{
      const session=sessions[0],pending=state.pendingHandoff;
      if(session.projectId!==state.projectId){
        this.unavailable='Conflicting persisted Orchestrator Project mapping';this.state=null;return;
      }
      if(pending&&session.threadId===pending.nextThreadId&&
         (session.orchestratorGeneration??0)===pending.expectedGeneration+1&&
         state.threadId===pending.previousThreadId&&state.generation===pending.expectedGeneration){
        // Crash after ModelStore committed its verified CAS but before the
        // adapter state file commit. The Models mapping is authoritative.
        state.threadId=pending.nextThreadId;state.generation++;
        state.lastCommittedHandoff=pending;
        delete state.pendingHandoff;
        atomic(this.stateFile,state);
      }else if(session.threadId===state.threadId&&
               (session.orchestratorGeneration??0)===state.generation){
        // Crash before CAS: the old verified head remains authoritative.
        if(pending){delete state.pendingHandoff;atomic(this.stateFile,state);}
        if(session.orchestratorGeneration===undefined){
          session.orchestratorGeneration=state.generation;store.putSession(session);
        }
      }else{
        this.unavailable='Conflicting persisted Orchestrator Codex/head generation';this.state=null;return;
      }
    }
    // Historic pending records from earlier HOTFIX builds may not have a
    // fingerprint. Backfill once, before any future ACK scrubs their text.
    for(const req of Object.values(state.requests)){
      if(!req.dedupeHash&&typeof req.text==='string')
        req.dedupeHash=requestFingerprint(req.text,req.attachments??[]);
      if(!req.deliveryId)req.deliveryId=deliveryIdentity(req.requestId);
    }
    this.state=state;this.busy=false;this.reconciling=false;this.listeners=new Set();
    // A queued request is durably accepted but has not entered the transport:
    // it can resume after a crash. An already-processing request may have
    // reached ChatGPT, so never resend it without independent reconciliation.
    for(const req of Object.values(state.requests))if(req.status==='processing')req.status='uncertain';
    atomic(this.stateFile,state);
    // An uncertain earlier submission gates all later turns; otherwise safely
    // resume accepted work that had not yet reached the browser.
    if(!Object.values(state.requests).some(req=>req.status==='uncertain'))
      queueMicrotask(()=>{void this.processQueue()});
  }
  persist(){atomic(this.stateFile,this.state)}
  emit(item){
    const event={id:++this.state.sequence,requestId:item.requestId,
      deliveryId:deliveryIdentity(item.requestId),status:item.status,
      ...(item.message?{messageId:messageIdentity(item.requestId),
        text:item.message.text,level:item.message.level,needs:item.message.needs,
        jobId:item.message.jobId}:{})};
    this.state.events.push(event);this.state.events=this.state.events.slice(-1000);this.persist();
    for(const listener of this.listeners)listener(event);
    return event;
  }
  async upload(chunk){
    if(!this.state)throw Error(this.unavailable);
    if(this.state.requests[chunk?.requestId])throw Error('Attachment upload after request acceptance refused');
    return this.attachments.upload(chunk);
  }
  async submit({requestId,text,attachments=[]}){
    if(!this.state)throw Error(this.unavailable);
    if(!REQUEST.test(requestId)||typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>24000)throw Error('invalid orchestrator message');
    if(!Array.isArray(attachments)||attachments.length>4)throw Error('too many attachments');
    const digest=requestFingerprint(text,attachments);
    const existing=this.state.requests[requestId];
    if(existing){
      if(existing.dedupeHash!==digest)throw Error('requestId conflict');
      return {requestId,state:'accepted',status:existing.status};
    }
    // Do not silently delete old idempotency tombstones: that can resubmit
    // an old ChatGPT turn after a client retry. Refuse new work at the bound.
    if(Object.keys(this.state.requests).length>=MAX_REQUEST_TOMBSTONES)
      throw Error('Orchestrator request retention capacity exceeded; manual reconciliation required');
    const files=await this.attachments.resolve(requestId,attachments);
    const request={requestId,text,deliveryId:deliveryIdentity(requestId),dedupeHash:digest,
      status:'queued',attachments,files,ack:false,createdAt:Date.now()};
    this.state.requests[requestId]=request;
    this.emit({requestId,status:'queued'});
    void this.processQueue();return {requestId,state:'accepted',status:'queued'};
  }
  health(){
    if(!this.state)return {ready:false,mapping:'unavailable'};
    const mapped=this.store.listSessions().filter(x=>x.codexThreadId===this.state.codexThreadId);
    const ready=mapped.length===1&&mapped[0].threadId===this.state.threadId&&
      mapped[0].projectId===this.state.projectId&&
      (mapped[0].orchestratorGeneration??0)===this.state.generation;
    const requests=Object.values(this.state.requests);
    return {ready,mapping:ready?'verified':'conflict',
      queued:requests.filter(x=>x.status==='queued').length,
      processing:requests.filter(x=>x.status==='processing').length,
      uncertain:requests.filter(x=>x.status==='uncertain').length,
      unacknowledged:requests.filter(x=>!x.ack).length,
      apnsPending:requests.filter(x=>x.notification?.status==='pending').length,
      retentionAvailable:Math.max(0,MAX_REQUEST_TOMBSTONES-requests.length)};
  }
  pending(){
    if(!this.state)throw Error(this.unavailable);
    return Object.values(this.state.requests).filter(x=>!x.ack)
      .map(({requestId,deliveryId,status,message,createdAt})=>({requestId,deliveryId,status,message:message??null,createdAt}));
  }
  /** Read-only accepted-state probe for phone outbox recovery.
   * Includes already-ACKed requests: a lost 202 must not cause a second file
   * upload after the server durably accepted the same request identity.
   * The caller must still resend the exact payload to prove idempotent equality. */
  accepted(requestId){
    if(!this.state)throw Error(this.unavailable);
    if(!REQUEST.test(requestId??''))throw Error('Invalid request ID');
    return Object.hasOwn(this.state.requests,requestId);
  }
  ack(deliveryId){
    const r=Object.values(this.state?.requests??{}).find(item=>item.deliveryId===deliveryId);
    if(!r)throw Error('unknown delivery');
    if(!['completed','failed'].includes(r.status))throw Error('delivery not terminal');
    const {requestId}=r;
    // A completed ACK means the phone has persisted the message. Keep only
    // minimal hashes/status for dedupe; never retain a second Chat transcript.
    r.ack=true;
    delete r.text;delete r.message;delete r.files;delete r.attachments;
    for(const event of this.state.events){
      if(event.requestId!==requestId)continue;
      delete event.message;delete event.text;delete event.level;delete event.needs;delete event.jobId;
    }
    this.persist();
    // Scrub only the Orchestrator's own v1 response and session diagnostics;
    // other Codex clients retain their existing /v1 persistence semantics.
    if(r.v1ResponseId){
      const response=this.store.response(r.v1ResponseId);
      const session=this.store.listSessions().find(x=>x.codexThreadId===this.state.codexThreadId);
      if(response&&session&&response.sessionId===session.id){
        delete response.reports;delete response.metadata;
        response.output=[];response.scrubbed=true;
        this.store.putResponse(response);
        session.lastInput=[];session.history=[];
        this.store.putSession(session);
      }
    }
    rmSync(join(this.dir,'attachments',requestId),{recursive:true,force:true});
    return {deliveryId,acked:true};
  }
  // Push is independent of Chat response completion and client ACK. Pending
  // notifications survive restart and retry through the existing Neo.app APNs
  // transport with a stable idempotency key, never a second public listener.
  queueNotification(request){
    const message=request.message;
    if(request.status!=='failed' && !message)return; // Control-only handoff is not a chat notification.
    // APNs retry may outlive the phone's chat ACK. Save only a bounded,
    // sanitized pending push payload, not the original full chat reply.
    const needsOwner=message?.needs&&message.needs!=='none';
    const kind=request.status==='failed'?'failure':needsOwner?'blocked':'completed';
    if(!request.notification)request.notification={status:'pending',attempts:0,nextAttemptAt:0,
      payload:{kind,title:request.status==='failed'?'Orchestrator error':'Orchestrator report',
        body:sanitizeText(message?.text??'Orchestrator needs attention',170)}};
    this.persist();
    void this.flushNotifications();
  }
  async flushNotifications(){
    if(this.notifying||!this.notifier||!this.state)return;
    this.notifying=true;
    try{
      for(const req of Object.values(this.state.requests)){
        const delivery=req.notification;
        if(delivery?.status!=='pending'||delivery.nextAttemptAt>Date.now())continue;
        const needsOwner=req.message?.needs && req.message.needs!=='none';
        const kind=delivery.payload?.kind??(req.status==='failed'?'failure':needsOwner?'blocked':'completed');
        const title=delivery.payload?.title??(req.status==='failed'?'Orchestrator error':'Orchestrator report');
        const body=delivery.payload?.body??sanitizeText(req.message?.text??'Orchestrator needs attention',170);
        try{
          const ack=await this.notifier.send({kind,title,body,idempotencyKey:'orchestrator:'+req.requestId});
          if(ack?.ok!==true||typeof ack.deliveryId!=='string')throw Error('APNs did not confirm acceptance');
          delivery.status='delivered';delivery.deliveryId=ack.deliveryId;delivery.deliveredAt=Date.now();
          delete delivery.payload;
        }catch(e){
          if(e.code==='NOTIFICATION_POLICY_DISABLED'){
            // Owner opted out of this category. Suppression is terminal,
            // not an APNs transport failure to retry forever.
            delivery.status='suppressed';delete delivery.payload;
            delivery.suppressedAt=Date.now();
          }else{
            delivery.attempts++;delivery.lastError=String(e.message).slice(0,120);
            delivery.nextAttemptAt=Date.now()+Math.min(3_600_000,5000*2**Math.min(delivery.attempts-1,10));
          }
        }
        this.persist();
      }
    }finally{this.notifying=false;}
  }
  eventsAfter(cursor){return this.state?.events.filter(e=>e.id>cursor)??[]}
  async reconcileUncertain(){
    if(!this.state||this.reconciling)return;
    this.reconciling=true;
    let resumed=false;
    try{
      for(const r of Object.values(this.state.requests)){
        if(r.status!=='uncertain'||!r.v1ResponseId)continue;
        const response=this.store.response(r.v1ResponseId);
        if(!response||response.status!=='completed'||response.scrubbed)continue;
        const session=this.store.listSessions().find(x=>x.codexThreadId===this.state.codexThreadId);
        if(!session||response.sessionId!==session.id)continue;
        try{
          if(response.reports?.length!==1)
            throw Error('Orchestrator reply must be exactly one complete reply.text');
          const envelope=parseOrchestratorEnvelope((response.output??[])
            .map(item=>item.content?.[0]?.text??'').join('\n'));
          if(envelope.control)await this.replaceThread(envelope.control);
          r.message=envelope.message;
          r.status='completed';
          this.emit({requestId:r.requestId,status:'completed',message:r.message});
          this.queueNotification(r);
          resumed=true;
        }catch(error){
          // The generic /v1 request is explicitly completed but the app
          // envelope/handoff could not be verified. Never resubmit it.
          r.status='failed';
          r.message={text:'Orchestrator response could not be verified',
            level:'attention',needs:'retry',jobId:null};
          this.emit({requestId:r.requestId,status:'failed',message:r.message});
          this.queueNotification(r);
          resumed=true;
        }
      }
    }finally{this.reconciling=false}
    if(resumed)queueMicrotask(()=>{void this.processQueue()});
  }
  async processQueue(){
    if(this.busy||!this.state)return;
    this.busy=true;
    try{
      // Drain the LIVE queue, not a one-time Object.values snapshot. A phone
      // or NATS wake can enqueue while WebHelm is processing the prior turn.
      for(;;){
        // After restart an earlier turn may have reached the browser despite
        // losing its completion; never overtake it on the shared head.
        if(Object.values(this.state.requests).some(item=>item.status==='uncertain'))break;
        const r=Object.values(this.state.requests).find(item=>item.status==='queued');
        if(!r)break;
        r.status='processing';this.emit({requestId:r.requestId,status:'processing'});
        let modelCompleted=false;
        try{
          // Private internal /v1 client preserves the generic model protocol and fixed identity.
          const result=await this.engine.run({model:'neo',stream:true,input:[{role:'user',content:[{type:'input_text',text:r.text+(r.attachments?.length?'\n\nAttached files (verified, available locally for this turn): '+r.attachments.map(x=>x.name).join(', '):'')}]}],enforcement_context:orchestratorEnforcement(this.state)},
            {codexThreadId:this.state.codexThreadId,attachmentFiles:r.files??[],
              onResponseStarted:id=>{r.v1ResponseId=id;this.persist()}});
          modelCompleted=true;
          if(r.v1ResponseId){
            const recorded=this.store.response(r.v1ResponseId);
            if(!recorded||recorded.reports?.length!==1)
              throw Error('Orchestrator reply must be exactly one complete reply.text');
          }
          const raw=(result.output??[]).map(item=>item.content?.[0]?.text??'').join('\n');
          const envelope=parseOrchestratorEnvelope(raw);
          if(envelope.control){
            // Never trust a model-produced control without independent Project and receipt checks.
            // Do not accept a message as successful when its replacement fails.
            // The previously verified head remains authoritative.
            await this.replaceThread(envelope.control);
          }
          r.message=envelope.message;
          r.status='completed';this.emit({requestId:r.requestId,status:r.status,message:r.message});
          this.queueNotification(r);
        }catch(e){
          if(!modelCompleted){
            // A lost /v1 SSE connection cannot prove the browser rejected
            // submission. Fence all later turns until durable reconciliation.
            r.status='uncertain';r.lastError=String(e.message).slice(0,160);
            this.emit({requestId:r.requestId,status:'uncertain'});
            break;
          }
          r.status='failed';
          r.message={text:'Orchestrator request failed: '+e.message.slice(0,240),
            level:'attention',needs:'retry',jobId:null};
          this.emit({requestId:r.requestId,status:'failed',message:r.message});
          this.queueNotification(r);
        }
      }
    }finally{this.busy=false;}
  }
  async replaceThread(control){
    const s=this.state;
    const already=s?.lastCommittedHandoff;
    if(already&&control.previousThreadId===already.previousThreadId&&
       control.nextThreadId===already.nextThreadId&&
       control.expectedGeneration===already.expectedGeneration&&
       control.handoffReceipt===already.handoffReceipt&&
       s.threadId===already.nextThreadId&&s.generation===already.expectedGeneration+1){
      const sessions=this.store.listSessions().filter(x=>x.codexThreadId===s.codexThreadId);
      if(sessions.length===1&&sessions[0].threadId===s.threadId&&
         sessions[0].projectId===s.projectId&&
         sessions[0].orchestratorGeneration===s.generation)
        return s.generation; // Exact accepted, still-authoritative replay.
      throw Error('Orchestrator committed handoff mapping mismatch');
    }
    if(!s||control.previousThreadId!==s.threadId||control.expectedGeneration!==s.generation||
       control.nextThreadId===s.threadId)
      throw Error('stale or conflicting head replacement');
    if(typeof this.verifyHandoff!=='function')throw Error('Independent thread/handoff verifier unavailable');
    const verified=await this.verifyHandoff({projectId:s.projectId,...control});
    if(verified!==true)throw Error('Successor or handoff receipt not verified');
    if(control.previousThreadId!==s.threadId||control.expectedGeneration!==s.generation)
      throw Error('head changed during verification');
    // Persist verification before the Models CAS. If the process dies on either
    // side of CAS, startup reconciles against the authoritative session file.
    s.pendingHandoff={...control};
    this.persist();
    let generation;
    try{
      generation=this.store.compareAndSwapOrchestratorThread({
        codexThreadId:s.codexThreadId,projectId:s.projectId,
        previousThreadId:control.previousThreadId,nextThreadId:control.nextThreadId,
        expectedGeneration:control.expectedGeneration,
      });
    }catch(error){
      // A disk write may succeed before its caller sees an error. Retain the
      // verified stage if ModelStore already advanced, enabling crash repair.
      const saved=this.store.listSessions().find(x=>x.codexThreadId===s.codexThreadId);
      if(saved?.threadId!==control.nextThreadId ||
         saved.orchestratorGeneration!==control.expectedGeneration+1){
        delete s.pendingHandoff;this.persist();
      }
      throw error;
    }
    s.threadId=control.nextThreadId;s.generation=generation;
    s.lastCommittedHandoff=s.pendingHandoff;
    delete s.pendingHandoff;
    this.persist();
    return generation;
  }}
