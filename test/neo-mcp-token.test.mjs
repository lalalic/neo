import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueNeoMcpToken, parseNeoMcpTokenArgs, runNeoMcpToken } from '../.bin/neo-mcp-token.mjs';

const ACCESS_TOKEN = 'private-test-access-token';
const REFRESH_TOKEN = 'private-test-refresh-token';

function oauthFixture() {
  const seen = [];
  return {
    seen,
    fetcher: async (url, init) => {
      const uri = new URL(url);
      const path = uri.pathname;
      seen.push({path,url,method:init.method,body:String(init.body ?? '')});
      if (path === '/register') return Response.json({client_id:'cli-test'}, {status:201});
      if (path === '/authorize' && init.method === 'GET') return new Response('<input type="hidden" name="rid" value="requestID_9">');
      if (path === '/authorize' && init.method === 'POST') {
        const query = new URL(seen.find(x=>x.path==='/authorize'&&x.method==='GET').url);
        return new Response('',{status:302,headers:{location:'http://127.0.0.1:8765/neo/oauth/callback?code=real-test-code&state='+query.searchParams.get('state')+'&iss=https%3A%2F%2Fneoy.qili2.com'}});
      }
      if (path === '/token') return Response.json({access_token:ACCESS_TOKEN,expires_in:3600,refresh_token:REFRESH_TOKEN});
      if (path === '/revoke') return new Response('',{status:200});
      throw Error('Unexpected API route '+path);
    },
  };
}

test('interactive OAuth PKCE authenticates and revokes unused refresh credential', async () => {
  const fixture=oauthFixture();
  const credential=await issueNeoMcpToken({operatorToken:'trusted-operator-test-only',fetcher:fixture.fetcher,clientName:'Z.ai interactive'});
  assert.equal(credential.accessToken,ACCESS_TOKEN);
  assert.equal(credential.expiresInSeconds,3600);
  assert.equal(credential.mcpUrl,'https://neoy.qili2.com/mcp');
  assert.deepEqual(fixture.seen.map(x=>x.path), ['/register','/authorize','/authorize','/token','/revoke']);
  const registration=JSON.parse(fixture.seen[0].body);
  assert.equal(registration.client_name,'Z.ai interactive');
  assert.ok(registration.redirect_uris.includes('http://127.0.0.1:8765/neo/oauth/callback'));
  const query=new URL(fixture.seen[1].url).searchParams;
  assert.equal(query.get('code_challenge_method'),'S256');
  assert.equal(query.get('scope'),'mcp');
  const exchange=new URLSearchParams(fixture.seen[3].body);
  assert.ok(exchange.get('code_verifier')?.length>=43);
  assert.equal(new URLSearchParams(fixture.seen[4].body).get('token'),REFRESH_TOKEN);
});

test('tokens are stored in a private file, metadata never prints credentials, and revoke deletes the file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'neo-mcp-token-test-'));
  const output=join(dir,'private-access.token');
  const fixture=oauthFixture();
  try {
    const metadata=await runNeoMcpToken(['issue','--output',output,'--client-name','Z.ai interactive'],{
      fetcher:fixture.fetcher,readOperator:async()=> 'trusted-operator-test-only',
    });
    assert.equal(await readFile(output,'utf8'),ACCESS_TOKEN+'\n');
    assert.equal((await stat(output)).mode & 0o777,0o600);
    assert.ok(!JSON.stringify(metadata).includes(ACCESS_TOKEN));
    assert.ok(!JSON.stringify(metadata).includes('trusted-operator-test-only'));
    await assert.rejects(runNeoMcpToken(['issue','--output',output],{
      fetcher:fixture.fetcher,readOperator:async()=> 'trusted-operator-test-only',
    }), /EEXIST/);
    const revoked=await runNeoMcpToken(['revoke','--file',output],{fetcher:fixture.fetcher});
    assert.deepEqual(revoked,{revoked:true,removed_file:output});
    await assert.rejects(readFile(output),{code:'ENOENT'});
    assert.equal(new URLSearchParams(fixture.seen.at(-1).body).get('token'),ACCESS_TOKEN);
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('strict CLI arguments reject relative, unknown and repeated options',()=>{
  assert.throws(()=>parseNeoMcpTokenArgs(['issue','--output','token.txt']), /absolute/);
  assert.throws(()=>parseNeoMcpTokenArgs(['issue','--output','/tmp/a','--output','/tmp/b']), /repeated/);
  assert.throws(()=>parseNeoMcpTokenArgs(['issue','--file','/tmp/a']), /absolute/);
  assert.throws(()=>parseNeoMcpTokenArgs(['revoke','--file','/tmp/a','--client-name','oops']), /Unsupported/);
  assert.throws(()=>parseNeoMcpTokenArgs(['issue','--output','/tmp/a','--format','json']), /Invalid/);
});

test('failed issuance removes the empty private file without leaking an operator secret',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'neo-mcp-token-test-'));
  const output=join(dir,'incomplete.token');
  try{
    await assert.rejects(runNeoMcpToken(['issue','--output',output],{
      fetcher:async()=>new Response('',{status:403}),
      readOperator:async()=> 'secret-never-printed',
    }),/registration rejected/);
    await assert.rejects(readFile(output),{code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true})}
});
