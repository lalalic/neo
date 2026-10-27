import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspaceConfig } from './workspace-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = resolve(root, 'skills/xchat-orchestrator/scripts');
const fail = message => { throw new Error(message); };
export const run = (command, args, options = {}) => {
  const result = (options.spawn ?? spawnSync)(command, args, { encoding: 'utf8', timeout: 20000 });
  if (result.error) throw result.error;
  return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};
export function serviceRows(processes) {
  if (!Array.isArray(processes)) throw new Error('PM2 response must be an array');
  return processes.filter(p => typeof p?.name === 'string').map(p => ({
    name: p.name, state: p.pm2_env?.status ?? 'unknown', pid: p.pid ?? null,
    manager: 'pm2', managed: true, health: 'not_checked',
  })).sort((a,b) => a.name.localeCompare(b.name));
}
export function executeControl(argv, options = {}) {
  const [category, command, ...args] = argv;
  const invoke = options.run ?? run;
  const emit = options.emit ?? (text => process.stdout.write(text));
  const execute = (binary, params) => {
    const result = invoke(binary, params);
    if (result.stdout) emit(result.stdout);
    if (result.stderr) (options.error ?? (text => process.stderr.write(text)))(result.stderr);
    return result.code;
  };
  if (category === 'status' || category === 'doctor') {
    if (command !== undefined) return fail(`usage: neo ${category}`);
    const gateway = invoke('curl', ['--fail', '--silent', '--show-error', '--max-time', '3', 'http://127.0.0.1:6767/']);
    const node = invoke('node', ['--version']);
    const python = invoke('python3', ['--version']);
    const probe = {gateway_http: gateway.code === 0 && gateway.stdout.includes('mcp_endpoint') ? 'reachable' : 'unreachable', mcp_federation: 'not_checked',
      node: node.code === 0 ? node.stdout.trim() : 'missing',
      python: python.code === 0 ? (python.stdout || python.stderr).trim() : 'missing'};
    if (category === 'doctor') {
      probe.remediation = [];
      if (probe.gateway_http !== 'reachable') probe.remediation.push('Start or diagnose NeoY native gateway');
      if (probe.node === 'missing') probe.remediation.push('Install Node.js 18+');
      if (probe.python === 'missing') probe.remediation.push('Install Python 3 for Neo project/skill discovery');
    }
    emit(JSON.stringify(probe, null, 2)+'\n');
    return probe.gateway_http === 'reachable' && probe.node !== 'missing' && probe.python !== 'missing' ? 0 : 2;
  }
  if (category === 'project') {
    if (command === 'list' && args.length === 0) return execute(resolve(scripts, 'list-xchat-projects'), []);
    if (command === 'resolve' && args.length === 1 && !args[0].startsWith('-')) return execute(resolve(scripts, 'list-xchat-projects'), ['--resolve', args[0]]);
    if (command === 'setup-agent' && args.length === 1 && !args[0].startsWith('-')) {
      const selected = invoke(resolve(scripts, 'list-xchat-projects'), ['--resolve', args[0]]);
      if (selected.code !== 0) return fail(selected.stderr.trim() || 'project resolution failed');
      let project;
      try { project = JSON.parse(selected.stdout); } catch { return fail('invalid project resolution JSON'); }
      const bootstrap = project.setup?.bootstrap;
      if (typeof bootstrap !== 'string' || !bootstrap.startsWith('/')) return fail('project has no setup/bootstrap.md');
      const prompt = `Set up ${project.xchat_project} using @neo on my Mac. Read and follow this bootstrap file at its absolute path: ${bootstrap}. Check existing state first, ask for necessary permissions, and verify the real outcome.`;
      const target = new URL('https://chatgpt.com/');
      target.searchParams.set('prompt', prompt);
      const opened = invoke('/usr/bin/open', ['-a', 'Google Chrome', target.href]);
      if (opened.code !== 0) return fail(opened.stderr.trim() || 'could not open Google Chrome');
      emit(JSON.stringify({ project: project.xchat_project, bootstrap, opened: true, browser: 'Google Chrome', promptSubmitted: false }) + '\n');
      return 0;
    }
    return fail('usage: neo project list | resolve NAME | setup-agent NAME');
  }
  if (category === 'skill') {
    if (command === 'package' && args.length === 2 && args.every(value => value && !value.startsWith('-')))
      return execute(resolve(root, '.bin/package-web-chatgpt-skill'), args);
    if (command !== 'list') return fail('usage: neo skill list [--project PATH] | package SKILL_DIR OUTPUT.zip');
    if (args.length && !(args.length === 2 && args[0] === '--project' && args[1] && !args[1].startsWith('-'))) return fail('usage: neo skill list [--project PATH] | package SKILL_DIR OUTPUT.zip');
    return execute(resolve(scripts, 'list-xchat-skills'), args);
  }
  if (category === 'workspace') {
    if (command !== 'show' || args.length) return fail('usage: neo workspace show');
    const workspace = options.workspace ?? loadWorkspaceConfig();
    emit(JSON.stringify({ workspaceRoot: workspace.workspaceRoot, neoRoot: workspace.neoRoot }, null, 2) + '\n');
    return 0;
  }
  if (category !== 'service') return fail('unsupported control command');
  if (!['list','status','start','stop','restart'].includes(command)) return fail('usage: neo service list | status NAME | start|stop|restart NAME --apply');
  const list = invoke('pm2', ['jlist']);
  let rows = [];
  if (list.code === 0) {
    try { rows = serviceRows(JSON.parse(list.stdout)); } catch { return fail('invalid pm2 jlist JSON'); }
  } else {
    (options.error ?? (text => process.stderr.write(text)))(`PM2 unavailable: ${list.stderr.trim() || 'jlist failed'}\n`);
  }
  // Native NeoY is launchd-managed, not PM2. Keep its stable label and health separate.
  const launchLabel = `gui/${process.getuid()}/com.neox.neoy.keepalive`;
  const launchResult = invoke('launchctl', ['print', launchLabel]);
  if (launchResult.code === 0) {
    const pid = /^\s*pid = (\d+)/m.exec(launchResult.stdout)?.[1];
    const state = /^\s*state = (.+)$/m.exec(launchResult.stdout)?.[1]?.trim() ?? 'unknown';
    const pm2Duplicate = rows.some(x => x.name === 'neoy' || x.name === 'neoy/app');
    rows = rows.filter(x => x.name !== 'neoy' && x.name !== 'neoy/app');
    rows.push({name: 'neoy/app', nativeLabel: 'com.neox.neoy.keepalive', state, pid: pid ? Number(pid) : null, manager: 'launchd', managed: true, health: 'not_checked',
      ...(pm2Duplicate ? {warning:'legacy PM2 neoy duplicate detected; native launchd is authoritative'} : {})});
    rows.sort((a,b)=>a.name.localeCompare(b.name));
  }
  if (list.code !== 0 && rows.length === 0) return fail('no accessible PM2 or NeoY launchd service manager');
  if (command === 'list' && args.length === 0) { emit(JSON.stringify(rows,null,2)+'\n'); return 0; }
  if (command === 'status' && args.length === 1) {
    const row = rows.find(x => x.name === args[0]);
    if (!row) return fail(`unknown managed service: ${args[0]}`);
    emit(JSON.stringify(row,null,2)+'\n'); return 0;
  }
  if (['start','stop','restart'].includes(command) && args.length === 2 && args[1] === '--apply') {
    const name = args[0];
    if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(name)) return fail('invalid service name');
    if (!rows.some(x => x.name === name)) return fail(`unknown managed service: ${name}`);
    const selected = rows.find(x => x.name === name);
    if (selected.manager === 'launchd') {
      if (command === 'start') return execute('launchctl', ['kickstart', launchLabel]);
      if (command === 'stop') return fail('NeoY launchd keepalive cannot be stopped safely by this CLI; use the native setup/installer lifecycle');
      return execute('launchctl', ['kickstart', '-k', launchLabel]);
    }
    return execute('pm2', [command, name]);
  }
  return fail('usage: neo service list | status NAME | start|stop|restart NAME --apply');
}
