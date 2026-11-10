// Independent Vast.ai cleanup watchdog. No credentials are stored in lease files.
import {readJson,leaseSave,pause} from './common.mjs';
import {cleanupVast} from './providers/vast.mjs';
const path=process.argv[2];
if(!path || !/lease-[0-9a-f]{18}\.json$/.test(path))process.exit(2);
for(let i=0;i<1000;i++){
  const lease=readJson(path);
  if(!lease||lease.phase==='destroyed')process.exit(0);
  if(Date.now()>=lease.deadline||lease.phase==='cleanup_requested'){
    try{await cleanupVast(lease);lease.phase='destroyed';leaseSave(path,lease);process.exit(0);}catch{}
  }
  await pause(5000);
}
process.exit(3);
