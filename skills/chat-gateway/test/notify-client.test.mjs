import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeoNotifier } from '../core/notify.mjs';
import { registerGateway } from '../mcp/admin.mjs';

const policy = {blocked:true,completed:true,failure:true};
const rpcPolicy = () => Response.json({jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:JSON.stringify(policy)}]}});
const uid='123e4567-e89b-42d3-a456-426614174000';
const uid2='123e4567-e89b-42d3-a456-426614174001';
async function configured(t) {
  const {mkdtemp,writeFile,rm} = await import('node:fs/promises');
  const {join}=await import('node:path');
  const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(join(tmpdir(),'neo-apns-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const key=join(dir,'key.p8');await writeFile(key,'test-only-key');
  await writeFile(join(dir,'config.json'),JSON.stringify({topic:'com.neox.app',keyId:'1234567890',teamId:'1234567890',keyPath:key}));
  await writeFile(join(dir,'devices.json'),JSON.stringify({devices:{
    [uid]:{token:'a'.repeat(64),environment:'sandbox',updatedAt:'2026-11-14T22:00:00Z'},
    [uid2]:{token:'b'.repeat(64),environment:'production',updatedAt:'2026-11-14T23:00:00Z'},
  }}));
  return dir;
}

test('Neo notifier honors policy and submits APNs to registered devices, never foreground phone MCP', async t=>{
  const dir=await configured(t);
  const calls=[];
  const notifier=createNeoNotifier({endpoint:'http://127.0.0.1:6767/mcp',apnsDir:dir,
    fetcher:async (url,init)=>{
      const args=JSON.parse(init.body);calls.push({url,args});
      return url.endsWith('/mcp') ? rpcPolicy() : Response.json({accepted:true,status:'apns_submission'});
    }});
  const ready=await notifier.probe();
  assert.equal(ready.transport,'apns');assert.equal(ready.targets,2);
  const result=await notifier.send({kind:'completed',title:'Hello',body:'job 1',idempotencyKey:'key1'});
  assert.equal(result.ok,true);assert.equal(result.response,'apns_accepted');
  assert.equal(calls.filter(x=>x.url.endsWith('/mobile/notify')).length,1,'Neo native route fans out itself; do not duplicate pushes');
  assert.equal(calls.some(x=>x.args?.params?.arguments?.command?.startsWith('events notify')),false);
  const sent=calls.find(x=>x.url.endsWith('/mobile/notify')).args;
  assert.equal(sent.title,'Hello');assert.equal(sent.body,'job 1');
  assert.ok(sent.payload.neoNotificationId);
  assert.equal(sent.token,undefined);
  assert.throws(()=>createNeoNotifier({endpoint:'http://example.com/mcp'}));
});

test('APNs false acknowledgement and disabled policy cannot become delivered',async t=>{
  const dir=await configured(t);
  const rejected=createNeoNotifier({endpoint:'http://127.0.0.1:6767/mcp',apnsDir:dir,
    fetcher:async url=>url.endsWith('/mcp')?rpcPolicy():Response.json({accepted:false,reason:'apns_not_configured'})});
  await assert.rejects(rejected.send({kind:'blocked',title:'review',body:'pending'}),/did not accept/);
  const disabled=createNeoNotifier({endpoint:'http://127.0.0.1:6767/mcp',apnsDir:dir,
    fetcher:async ()=>Response.json({result:{content:[{type:'text',text:JSON.stringify({...policy,blocked:false})}]}})});
  await assert.rejects(disabled.send({kind:'blocked',title:'review',body:'pending'}),/disabled/);
});

test('federation registration authorizes only this provider via Neo applied settings', async () => {
  const commands = [];
  const registered = await registerGateway({
    endpoint: 'http://127.0.0.1:6767/mcp', port: 8791,
    fetcher: async (_url, init) => {
      const command = JSON.parse(init.body).params.arguments.command;
      commands.push(command);
      const receipt = command.startsWith('mcp add')
        ? { configuration: { mcp_servers: [{ name: 'chat-gateway' }] }, ok: true }
        : { ok: true, operation: 'deployment.provider' };
      return Response.json({ jsonrpc: '2.0', id: 1,
        result: { content: [{ type: 'text', text: JSON.stringify(receipt) }] } });
    },
  });
  assert.equal(registered.registered, true);
  assert.equal(registered.remotelyExposed, true);
  assert.deepEqual(commands, [
    'mcp add chat-gateway http://127.0.0.1:8791/mcp',
    'deployment provider enable chat-gateway',
  ]);
});

test('never claims remote exposure if Neo rejects provider grant', async () => {
  let index = 0;
  await assert.rejects(registerGateway({
    endpoint: 'http://127.0.0.1:6767/mcp', port: 8791,
    fetcher: async () => Response.json({
      result: { content: [{ type: 'text', text: JSON.stringify(index++ === 0
        ? { ok: true } : { ok: false, error: 'rejected' }) }] },
    }),
  }), /did not acknowledge/);
});
