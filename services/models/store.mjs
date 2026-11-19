import {readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {key} from './input.mjs';
import {canonicalModel} from './catalog.mjs';

export class ModelStore {
  constructor(base=process.env.NEO_MODELS_STATE_DIR??join(homedir(),'.local','share','neo','model-gateway')){
    this.base=base;this.sessions=join(base,'sessions');this.responses=join(base,'responses');
    for(const p of [base,this.sessions,this.responses])mkdirSync(p,{recursive:true,mode:0o700});
  }
  #file(kind,id){if(!/^[a-z0-9_-]{8,80}$/i.test(id))throw Error('invalid ID');return join(kind==='session'?this.sessions:this.responses,id+'.json');}
  #read(path){try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
  #write(path,value){const temp=path+'.'+process.pid+'-'+key()+'.tmp';writeFileSync(temp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(temp,path);}
  session(id){return this.#read(this.#file('session',id));}
  response(id){return this.#read(this.#file('response',id));}
  putSession(item){this.#write(this.#file('session',item.id),item);return item;}
  putResponse(item){this.#write(this.#file('response',item.id),item);return item;}
  listSessions(){return readdirSync(this.sessions).filter(x=>x.endsWith('.json')).map(x=>this.#read(join(this.sessions,x))).filter(Boolean);}
  resolve(previous,sessionHint,codexThreadId,model='chatgpt'){
    if(sessionHint&&(!/^[A-Za-z0-9_-]{8,80}$/.test(sessionHint)))throw Error('invalid metadata.session_id');
    if(previous){
      const p=this.response(previous);
      if(!p)throw Error('unknown previous_response_id');
      const byPrevious=this.session(p.sessionId);
      if(!byPrevious)throw Error('missing previous session');
      if(byPrevious.codexThreadId&&byPrevious.codexThreadId!==codexThreadId)
        throw Error('previous_response_id belongs to a different Codex Thread');
      if(sessionHint&&byPrevious.clientSessionId!==sessionHint)
        throw Error('previous_response_id belongs to a different client session');
      if(canonicalModel(byPrevious.model??'chatgpt')===model)return byPrevious;
      if(!codexThreadId&&!sessionHint)throw Error('previous_response_id belongs to a different model');
      // Switching models in one Codex Thread selects that model's own session.
    }
    if(codexThreadId){
      const matches=this.listSessions().filter(s=>s.codexThreadId===codexThreadId&&canonicalModel(s.model??'chatgpt')===model);
      if(matches.length>1)throw Error('duplicate Codex Thread mapping');
      const mapped=matches[0]??null;
      if(mapped&&sessionHint&&mapped.clientSessionId&&mapped.clientSessionId!==sessionHint)
        throw Error('Codex Thread maps to a different client session');
      return mapped;
    }
    if(sessionHint){
      const matches=this.listSessions().filter(s=>s.clientSessionId===sessionHint&&canonicalModel(s.model??'chatgpt')===model);
      if(matches.length>1)throw Error('duplicate client session ID');
      return matches[0]??null;
    }
    // No identity: each request starts a distinct conversation. Never match
    // transcript content (including a repeated hello) to an old session.
    return null;
  }

  create(messages,hint,codexThreadId=null,model='chatgpt'){
    const s={id:'sess_'+key(),model,clientSessionId:hint??null,codexThreadId:codexThreadId??null,threadId:null,threadUrl:null,status:'new',history:messages,lastResponseId:null,lastInput:messages,createdAt:Date.now()};
    return this.putSession(s);
  }
}
