import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The only executable capable of performing these operations is the
// independently signed, root-owned NeoY helper. No shell or arbitrary path.
export const HELPER = '/Library/PrivilegedHelperTools/com.neox.neoy.helper';
const SUDO = '/usr/bin/sudo';
const help = 'usage: neo privilege list | status | run <approved-action>';

export function executePrivilege(argv, options = {}) {
  const invoke = options.invoke ?? ((bin, args) => {
    const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 15000, shell: false,
      stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error) throw result.error;
    return { code: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  });
  const installed = options.installed ?? existsSync(HELPER);
  const emit = options.emit ?? (value => process.stdout.write(value));
  const fail = options.fail ?? (value => process.stderr.write(value));
  const [verb, action, ...rest] = argv;
  if (verb === 'help' || verb === '--help' || verb === '-h') { emit(help + '\n'); return 0; }
  if (!['list', 'status', 'run'].includes(verb) || rest.length ||
      (verb === 'run' ? !action : action !== undefined)) throw new Error(help);
  if (!installed) {
    emit(JSON.stringify({ state: 'not_installed', hint: 'Install the signed Neo.app Privileged Helper with macOS administrator approval.' }) + '\n');
    return 2;
  }
  if (verb === 'list') {
    const result = invoke(HELPER, ['list']);
    if (result.code !== 0) { fail(result.stderr || 'Could not read approved actions\n'); return result.code; }
    const actions = result.stdout.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    emit(JSON.stringify({ actions, source: 'signed-helper', hint: 'Use neo privilege run <approved-action>; unsupported operations require owner approval and a signed update.' }) + '\n');
    return 0;
  }
  if (verb === 'run' && !/^[a-z0-9]+(?:\.[a-z0-9-]+)+$/.test(action)) {
    throw new Error('Denied: action must be a named operation from neo privilege list');
  }
  // -k ensures verification never depends on unrelated cached admin credentials.
  // No subprocess can prompt for a password; never accept credentials via stdin.
  const result = invoke(SUDO, ['-n', '-k', HELPER, verb === 'status' ? 'check' : 'run', verb === 'status' ? 'dns.flush' : action]);
  if (verb === 'status') {
    emit(JSON.stringify({ state: result.code === 0 ? 'ready' : 'authorization_required',
      ...(result.code !== 0 ? { hint: 'The helper requires one-time administrator installation or authorization.' } : {}) }) + '\n');
    return result.code === 0 ? 0 : 2;
  }
  if (result.code !== 0) {
    fail(result.stderr || `Approved operation failed (exit ${result.code})\n`);
    return result.code;
  }
  emit(result.stdout);
  return 0;
}
