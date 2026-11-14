import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const THREAD = /^[A-Za-z0-9_-]{8,160}$/;
const PROJECT = /^g-p-[A-Za-z0-9_-]{8,128}$/;

// This browser action reads only location and presence of the Conversation UI.
// It never reads, transmits, or extracts assistant messages.
const INSPECT_SCRIPT = `return await (async () => {
  for (let i = 0; i < 80; i++) {
    const observed = await js("(() => ({url: location.href, conversation: !!document.querySelector('[role=region][aria-label=Conversation]'), error: /could not load this chatgpt conversation|conversation not found/i.test(document.body?.innerText||'') }))()");
    if (observed?.error || (observed?.conversation && String(observed.url || '').includes('/g/g-p-'))) return observed;
    await sleep(250);
  }
  return {conversation:false};
})()`;

function lastJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/);
  for (let i=lines.length-1;i>=0;i--) {
    try { return JSON.parse(lines[i]); } catch { /* non-JSON diagnostics */ }
  }
  throw new Error('WebHelm did not return a verified receipt');
}

async function runWebHelm(argv) {
  const {stdout} = await execute(process.env.CHAT_GATEWAY_WEBHELM_COMMAND || 'webhelm', argv, {
    shell:false, timeout:35_000, maxBuffer:256_000,
  });
  return lastJson(stdout);
}

/** Verifies an existing thread in the browser; never sends a message. */
export function createThreadProjectVerifier({run = runWebHelm} = {}) {
  return async ({projectId,threadId}) => {
    if (!PROJECT.test(projectId ?? '') || !THREAD.test(threadId ?? '')) {
      throw new Error('Invalid orchestrator Project/thread identity');
    }
    const temp = await mkdtemp(join(tmpdir(),'chat-gateway-head-check-'));
    let sessionId = null;
    try {
      const script = join(temp,'inspect.js');
      await writeFile(script,INSPECT_SCRIPT,{mode:0o600});
      // Do not embed the expected Project in the URL: a wrong-project thread
      // must disclose its real canonical Project after the ChatGPT redirect.
      const start = await run(['session','start','--url',
        `https://chatgpt.com/c/${encodeURIComponent(threadId)}`]);
      sessionId = start?.session_id;
      if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{8,160}$/.test(sessionId)) {
        throw new Error('Could not acquire a read-only WebHelm session');
      }
      const result = await run(['session','exec',sessionId,'--code-file',script]);
      const observed = result?.value;
      if (result?.ok !== true || observed?.conversation !== true || observed.error) {
        throw new Error('Orchestrator thread not loaded and verified');
      }
      let actual;
      try { actual = new URL(observed.url); } catch { throw new Error('Invalid thread URL observed'); }
      const segments = actual.pathname.split('/').filter(Boolean);
      const projectPart = segments.length === 4 ? segments[1] : '';
      const threadPart = segments.length === 4 ? segments[3] : '';
      if (actual.protocol !== 'https:' || actual.hostname !== 'chatgpt.com' ||
          actual.username || actual.password ||
          segments[0] !== 'g' || segments[2] !== 'c' ||
          projectPart !== projectId ||
          threadPart !== threadId) {
        throw new Error('chat_bind refused: thread is not in the bound orchestrator Project');
      }
      return true;
    } finally {
      if (sessionId) {
        try { await run(['session','stop',sessionId]); } catch { /* owned Session expires independently */ }
      }
      await rm(temp,{recursive:true,force:true});
    }
  };
}
