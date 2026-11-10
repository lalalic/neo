// Deadline enforcement survives a gateway restart/crash. HF Jobs also has an
// independent provider-side --timeout. The watchdog never extends a lease.
import {session,saveSession} from './store.mjs';
import {destroyProviderSession,reconcileUnknown} from './providers.mjs';
import {pause} from '../common.mjs';
const name=process.argv[2];
if(!/^[a-z][a-z0-9-]{0,63}$/.test(name||''))process.exit(2);
for(;;){
  const state=session(name);
  if(['stopped','failed'].includes(state.phase))process.exit(0);
  if(Date.now()>=state.deadline && state.phase==='running'){
    try{
      const status=await destroyProviderSession(state);
      saveSession(name,{...state,phase:'stopped',terminalStatus:status,stoppedAt:Date.now()});
      process.exit(0);
    }catch{
      saveSession(name,{...state,phase:'cleanup_failed'});
    }
  }
  if(state.phase==='cleanup_failed'||(state.phase==='stopping'&&Date.now()>=state.deadline)){
    try{
      const status=await destroyProviderSession(state);
      saveSession(name,{...state,phase:'stopped',terminalStatus:status,stoppedAt:Date.now()});
      process.exit(0);
    }catch{}
  }
  if(['starting','unreconciled'].includes(state.phase)&&Date.now()>=state.deadline){
    try{
      const result=await reconcileUnknown(state);
      saveSession(name,{...state,phase:'stopped',terminalStatus:result,stoppedAt:Date.now()});
      process.exit(0);
    }catch{
      saveSession(name,{...state,phase:'unreconciled'});
    }
  }
  await pause(Math.max(1000,Math.min(8000,state.deadline-Date.now())));
}
