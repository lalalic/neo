#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const part = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export function serviceId(skill, service) {
  if (!part.test(skill ?? '') || !part.test(service ?? '')) throw new Error('service ID must be <skillname>/<service-name> (lowercase kebab-case)');
  return `${skill}/${service}`;
}
export function parse(argv) {
  const [action, ...input] = argv;
  if (!['define', 'status', 'start', 'stop', 'restart', 'logs'].includes(action)) throw new Error('usage: serviceman define|status|start|stop|restart|logs --skill NAME --service NAME [--apply] [-- COMMAND ARGS...]');
  const options = {};
  const boundary = input.indexOf('--');
  const flags = boundary < 0 ? input : input.slice(0, boundary);
  const command = boundary < 0 ? [] : input.slice(boundary + 1);
  for (let i = 0; i < flags.length; i++) {
    const token = flags[i];
    if (token === '--apply') { options.apply = true; continue; }
    if (['--skill', '--service'].includes(token) && flags[i+1] && !flags[i+1].startsWith('--')) { options[token.slice(2)] = flags[++i]; continue; }
    throw new Error(`unknown or incomplete option: ${token}`);
  }
  const id = serviceId(options.skill, options.service);
  if (action === 'define' && command.length === 0) throw new Error('define requires -- COMMAND ARGS...');
  if (action !== 'define' && command.length) throw new Error('only define accepts a command');
  return {action, id, apply: Boolean(options.apply), command};
}
export function pm2Arguments(request) {
  const {action,id,apply,command} = request;
  if (action === 'define') return ['start', command[0], '--name', id, '--', ...command.slice(1)];
  if (action === 'status') return ['describe', id];
  if (action === 'logs') return ['logs', id, '--lines', '100', '--nostream'];
  if (['start','stop','restart'].includes(action)) return [action,id];
  throw new Error('unsupported action');
}
export function main(argv, spawn = spawnSync, write = console.log) {
  const request = parse(argv);
  if (request.action !== 'status' && request.action !== 'logs' && !request.apply) {
    write(JSON.stringify({dryRun:true,serviceId:request.id,pm2:pm2Arguments(request)}));return 0;
  }
  if (request.action === 'define' && request.apply) {
    const current = spawn('npx', ['--yes','pm2','jlist'], {encoding:'utf8'});
    if (current.error) throw current.error;
    if (current.status !== 0) throw new Error('cannot inspect PM2 before define');
    const existing = JSON.parse(current.stdout).find(p => p.name === request.id);
    if (existing) {
      write(JSON.stringify({serviceId:request.id,existing:true,state:existing.pm2_env?.status ?? 'unknown',changed:false}));
      return 0;
    }
  }
  const result = spawn('npx', ['--yes','pm2',...pm2Arguments(request)], {stdio:'inherit'});
  if (result.error) throw result.error;
  return result.status ?? 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
