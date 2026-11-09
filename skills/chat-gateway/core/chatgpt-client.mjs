import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Direct, durable WebHelm CLI new-turn. No Neo MCP chatgpt-turn relay. */
export function createChatGPTSubmitter({
  command = process.env.CHAT_GATEWAY_WEBHELM_COMMAND || 'webhelm',
  spawnProcess = spawn, timeoutMs = 20_000,
} = {}) {
  return async function submit({ threadId, projectId, text, requestId, file = [] }) {
    if (!threadId || !requestId || (!text && !file.length)) throw Error('Invalid turn request');
    const dir = await mkdtemp(join(tmpdir(), 'chat-gateway-turn-'));
    try {
      const input = join(dir, 'turn.json');
      await writeFile(input, JSON.stringify({
        mode: 'async', thread_id: threadId,
        ...(projectId ? { project_id: projectId } : {}),
        message: text || 'Please review the attached file.',
        file,
        idempotency_key: requestId,
        mergeable: false,
      }), { mode: 0o600 });
      const output = await new Promise((resolve, reject) => {
        const process = spawnProcess(command, ['platform', 'run', 'chatgpt', 'new-turn',
          '--config', input], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        process.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-120000); });
        process.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
        const timer = setTimeout(() => process.kill('SIGTERM'), timeoutMs);
        process.once('error', error => { clearTimeout(timer); reject(error); });
        process.once('close', (code, signal) => {
          clearTimeout(timer);
          if (code !== 0) return reject(Error('WebHelm new-turn failed: ' + (signal || code) +
            ' ' + stderr.slice(-250)));
          resolve(stdout);
        });
      });
      const line = output.trim().split(/\r?\n/).filter(Boolean).at(-1);
      const parsed = JSON.parse(line);
      const receipt = parsed.result ?? parsed;
      if (!receipt.ok || receipt.status !== 'submitted' || receipt.mode !== 'new-turn' ||
          !receipt.queue_id || receipt.thread_id !== threadId) {
        throw Error('WebHelm CLI did not confirm durable queue acceptance');
      }
      return { status: 'submitted', mode: 'new-turn', queueId: receipt.queue_id };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
