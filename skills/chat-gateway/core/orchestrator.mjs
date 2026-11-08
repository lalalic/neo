import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = /^g-p-[A-Za-z0-9_-]{8,128}$/;
const THREAD_ID = /^[A-Za-z0-9_-]{8,160}$/;
const PROJECT_NAME = 'orchestrator';
const INSTRUCTIONS_FILE = new URL('../project-instructions.md', import.meta.url);

function parseLastJson(text, label) {
  const lines = String(text).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* other CLI output */ }
  }
  throw new Error(label + ' returned no JSON receipt');
}

/** Existing WebHelm platform Action owns ChatGPT project creation and UI verification. */
export async function createProjectWithWebHelm({
  projectName = PROJECT_NAME, instructions, initialPrompt,
  command = process.env.CHAT_GATEWAY_WEBHELM_COMMAND || 'webhelm',
  timeoutMs = 210_000,
} = {}) {
  if (!instructions?.trim() || !initialPrompt?.trim()) throw new Error('Project initialization text is required');
  const dir = await mkdtemp(join(tmpdir(), 'chat-gateway-project-'));
  try {
    const configPath = join(dir, 'setup.json');
    await writeFile(configPath, JSON.stringify({
      project_name: projectName,
      instructions,
      initial_prompt: initialPrompt,
    }), { mode: 0o600 });
    const args = ['platform', 'run', 'chatgpt', 'project-setup', '--auto-session', '--config', configPath];
    const wrapper = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const append = (buffer, chunk) => (buffer + String(chunk)).slice(-128_000);
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
      const timeout = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (code !== 0) {
          // The CLI emits its Action error on STDOUT as structured JSON.
          // Its stderr often contains only Node experimental warnings.
          let diagnostic = null;
          try {
            const wrapper = parseLastJson(stdout, 'WebHelm failure receipt');
            diagnostic = wrapper?.result?.error || wrapper?.error || null;
          } catch { /* preserve actual exit signal if no receipt */ }
          return reject(new Error('WebHelm project setup failed: ' +
            String(diagnostic || signal || code).slice(0, 450)));
        }
        try { resolve(parseLastJson(stdout, 'WebHelm project setup')); }
        catch (error) { reject(error); }
      });
    });
    if (wrapper?.result?.ok !== true) throw new Error('WebHelm project setup was not acknowledged');
    const receipt = parseLastJson(wrapper.result.stdout, 'ChatGPT project setup');
    if (receipt.status !== 'completed' || !PROJECT_ID.test(receipt.project_id || '') ||
        !THREAD_ID.test(receipt.thread_id || '') ||
        !String(receipt.thread_url || '').includes(receipt.thread_id) ||
        !String(receipt.project_url || '').includes(receipt.project_id)) {
      throw new Error('Project setup did not verify a durable Project and main thread');
    }
    return {
      projectId: receipt.project_id,
      threadId: receipt.thread_id,
      projectUrl: receipt.project_url,
      threadUrl: receipt.thread_url,
      projectReused: receipt.project_reused === true,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Initialize once. A failed WebHelm action does not block job notifications.
 * No new Project/thread is created after a verified binding is persisted.
 */
export function createOrchestratorBootstrap({
  chat, createProject = createProjectWithWebHelm,
  readInstructions = () => readFile(INSTRUCTIONS_FILE, 'utf8'),
  log = () => {}, now = () => Date.now(),
} = {}) {
  let inFlight = null;
  let last = { state: 'pending', lastError: null, lastAttemptAt: null };
  const status = () => ({ ...last });

  async function ensure() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const existing = await chat.head();
      if (existing.bound && PROJECT_ID.test(existing.projectId || '')) {
        last = { state: 'ready', projectId: existing.projectId, threadId: existing.threadId,
          lastError: null, lastAttemptAt: last.lastAttemptAt };
        return last;
      }
      last = { state: 'initializing', lastError: null, lastAttemptAt: new Date(now()).toISOString() };
      try {
        const instructions = await readInstructions();
        const project = await createProject({
          projectName: PROJECT_NAME, instructions,
          initialPrompt: 'Initialize the Neo Orchestrator main thread using these Project Instructions. ' +
            'This is a durable main thread for owner messages arriving through Neo Mobile. ' +
            'Confirm that you understand the optional chat_report protocol and reply READY. ' +
            'Do not start any Relay jobs or publish an attention notification until the owner asks.',
        });
        if (!PROJECT_ID.test(project.projectId || '') || !THREAD_ID.test(project.threadId || '')) {
          throw new Error('Project setup returned unverified identifiers');
        }
        await chat.bindSystem({ threadId: project.threadId, projectId: project.projectId });
        last = { state: 'ready', projectId: project.projectId, threadId: project.threadId,
          lastError: null, lastAttemptAt: last.lastAttemptAt };
        log('orchestrator.ready', { projectId: project.projectId, threadId: project.threadId });
        return last;
      } catch (error) {
        last = { state: 'error',
          lastError: String(error.message || error).slice(0, 200),
          lastAttemptAt: last.lastAttemptAt };
        log('orchestrator.setup_failed', { error: last.lastError });
        return last;
      }
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }
  return { ensure, status };
}
