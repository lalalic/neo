#!/usr/bin/env node
/** Actual native CLI + TLS + OAuth PKCE, disposable loopback issuer.
 * No NeoY production operator credential, production token or public request.
 */
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const binary=join(root,'target/debug/neo-rs');
const base=mkdtempSync(join(tmpdir(),'neo-oauth-blackbox-'));
const results=[];let server;
const verify=async(name,fn)=>{try{await fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',reason:e.code==='ERR_ASSERTION'?'Assertion failed':e.name});}};
try {
 const home=join(base,'home');mkdirSync(home);
 const config=join(base,'openssl.cnf'),ca=join(base,'ca.pem'),cakey=join(base,'ca.key'),key=join(base,'server.key'),csr=join(base,'server.csr'),cert=join(base,'server.pem');
 writeFileSync(config,'[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Neo disposable issuer\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n');
 const openssl=(args)=>execFileSync('/usr/bin/openssl',args,{stdio:['ignore','ignore','ignore']});
 openssl(['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',config,'-extensions','v3_ca','-keyout',cakey,'-out',ca]);
 openssl(['req','-new','-newkey','rsa:2048','-nodes','-config',config,'-keyout',key,'-out',csr]);
 openssl(['x509','-req','-in',csr,'-CA',ca,'-CAkey',cakey,'-CAcreateserial','-days','1','-extfile',config,'-extensions','server','-out',cert]);
 const dummy=randomBytes(24).toString('hex'),op=join(home,'operator');writeFileSync(op,dummy,{mode:0o600});
 const calls=[],revoked=new Set(),issued=new Set();let state,challenge,origin,mode='normal',access,refresh,code;
 server=createServer({key:readFileSync(key),cert:readFileSync(cert)},async(req,res)=>{
   try{
    const url=new URL(req.url,origin);let body='';for await(const chunk of req)body+=chunk;
    const route=req.method+' '+url.pathname;calls.push(route);
    const reply=(status,doc)=>{res.writeHead(status,{'content-type':'application/json'});res.end(doc===undefined?'':JSON.stringify(doc));};
    if(route==='POST /register'){
      const data=JSON.parse(body);assert.equal(data.client_name,'Neo blackbox fixture');assert.ok(data.redirect_uris.includes('http://127.0.0.1:8765/neo/oauth/callback'));
      reply(201,{client_id:'fixture-client'});
    }else if(route==='GET /authorize'){
      state=url.searchParams.get('state');challenge=url.searchParams.get('code_challenge');assert.ok(state&&challenge);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('resource'),origin+'/mcp');
      res.writeHead(200,{'content-type':'text/html'}).end('<input type="hidden" name="rid" value="fixture-rid">');
    }else if(route==='POST /authorize'){
      const f=new URLSearchParams(body);assert.equal(f.get('rid'),'fixture-rid');assert.equal(f.get('token'),dummy);code=randomBytes(12).toString('hex');
      const cb=new URL('http://127.0.0.1:8765/neo/oauth/callback');cb.searchParams.set('state',mode==='bad-state'?'wrong-state':state);cb.searchParams.set('iss',origin);cb.searchParams.set('code',code);
      res.writeHead(302,{location:cb.href}).end();
    }else if(route==='POST /token'){
      const f=new URLSearchParams(body);assert.equal(f.get('code'),code);assert.equal(f.get('client_id'),'fixture-client');assert.equal(createHash('sha256').update(f.get('code_verifier')).digest('base64url'),challenge);
      access=randomBytes(24).toString('hex');refresh=randomBytes(24).toString('hex');issued.add(access);issued.add(refresh);reply(200,{access_token:access,refresh_token:refresh,expires_in:3600});
    }else if(route==='POST /revoke'){
      const token=new URLSearchParams(body).get('token');assert.ok(issued.has(token));if(mode==='reject-revoke'){reply(503);return;}revoked.add(token);reply(200);
    }else reply(404);
   }catch{res.writeHead(400).end();}
 });
 await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
 origin='https://127.0.0.1:'+server.address().port;
 const env={...process.env,HOME:home,NEO_MCP_OPERATOR_TOKEN_FILE:op,NEO_MCP_LOOPBACK_CA_FILE:ca};
 function cli(args,e=env){return new Promise(done=>{const child=spawn(binary,['mcp','token',...args],{cwd:root,env:e,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});});}
 const output=join(home,'access.token');
 const issue=(file,options={})=>cli(['issue','--output',file,'--origin',options.origin||origin,'--client-name','Neo blackbox fixture'],options.env||env);
 await verify('untrusted HTTPS certificate fails closed without HTTP requests',async()=>{const noCA={...env};delete noCA.NEO_MCP_LOOPBACK_CA_FILE;const before=calls.length;const r=await issue(output,{env:noCA});assert.notEqual(r.code,0);assert.equal(calls.length,before);assert.ok(!existsSync(output));});
 await verify('private CA rejected for non-loopback origin',async()=>{const before=calls.length;const r=await issue(output,{origin:'https://example.invalid'});assert.notEqual(r.code,0);assert.match(r.stderr,/Custom OAuth CA requires HTTPS 127.0.0.1/);assert.equal(calls.length,before);assert.ok(!existsSync(output));});
 await verify('HTTPS PKCE issue validates challenge and revokes refresh, writes mode 0600',async()=>{const r=await issue(output);assert.equal(r.code,0);const doc=JSON.parse(r.stdout);assert.equal(doc.expires_in_seconds,3600);assert.equal(doc.mcp_url,origin+'/mcp');assert.equal(readFileSync(output,'utf8').trim(),access);assert.equal(statSync(output).mode&0o777,0o600);assert.ok(revoked.has(refresh));assert.ok(!revoked.has(access));assert.ok(!r.stdout.includes(access));});
 await verify('existing output cannot be overwritten or trigger new registration',async()=>{const before=calls.length;const r=await issue(output);assert.notEqual(r.code,0);assert.equal(calls.length,before);assert.equal(readFileSync(output,'utf8').trim(),access);});
 await verify('failed revocation preserves the token file',async()=>{mode='reject-revoke';try{const r=await cli(['revoke','--file',output,'--origin',origin]);assert.notEqual(r.code,0);assert.equal(readFileSync(output,'utf8').trim(),access);}finally{mode='normal';}});
 await verify('successful HTTPS revocation deletes the exact private token file',async()=>{const r=await cli(['revoke','--file',output,'--origin',origin]);assert.equal(r.code,0);assert.equal(JSON.parse(r.stdout).revoked,true);assert.ok(revoked.has(access));assert.ok(!existsSync(output));});
 await verify('mismatched OAuth callback state rejects before token exchange and rolls back file',async()=>{mode='bad-state';try{const before=calls.filter(x=>x==='POST /token').length;const r=await issue(output);assert.notEqual(r.code,0);assert.equal(calls.filter(x=>x==='POST /token').length,before);assert.ok(!existsSync(output));}finally{mode='normal';}});
}finally{if(server){server.closeAllConnections();await new Promise(ok=>server.close(ok));}rmSync(base,{recursive:true,force:true});}
const passed=results.filter(r=>r.status==='PASS').length;
console.log(JSON.stringify({scope:'native-cli-https-loopback-oauth',passed,total:results.length,results,productionTouched:false},null,2));if(passed!==results.length)process.exitCode=1;
