import {readFileSync,writeFileSync,renameSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {key,isPrefix} from './input.mjs';

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
  resolve(messages,previous,sessionHint){
    if(previous){const p=this.response(previous);if(!p)throw Error('unknown previous_response_id');const session=this.session(p.sessionId);if(!session)throw Error('missing previous session');return session;}
    if(sessionHint){if(!/^[A-Za-z0-9_-]{8,80}$/.test(sessionHint))throw Error('invalid metadata.session_id');
      const matches=this.listSessions().filter(s=>s.clientSessionId===sessionHint);
      if(matches.length>1)throw Error('duplicate session ID');return matches[0]??null;
    }
    // Codex store:false replays message history; find its unique longest prefix.
    const candidates=this.listSessions().filter(s=>Array.isArray(s.history)&&(isPrefix(messages,s.history)||isPrefix(s.history,messages)));
    if(!candidates.length)return null;
    const longest=Math.max(...candidates.map(s=>s.history.length));
    const winners=candidates.filter(s=>s.history.length===longest);
    if(winners.length!==1)throw Error('ambiguous conversation history; specify metadata.session_id');
    return winners[0];
  }
  create(messages,hint){
    const s={id:'sess_'+key(),clientSessionId:hint??null,threadId:null,threadUrl:null,status:'new',history:messages,lastResponseId:null,lastInput:messages,createdAt:Date.now()};
    return this.putSession(s);
  }
}
