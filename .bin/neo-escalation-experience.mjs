import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync, writeFileSync, linkSync, unlinkSync, openSync, closeSync, fsyncSync,
  readdirSync, readFileSync, lstatSync, existsSync, renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_DIR = join(homedir(), '.local/share/neo/escalation/cases');
const CATEGORIES = new Set([
  'authentication', 'permissions', 'browser', 'desktop', 'shell',
  'network', 'tooling', 'human', 'runtime', 'other',
]);
const TOOLS = new Set(['shell', 'webhelm', 'computer-use', 'wechat-bro', 'imessage', 'skills']);
const STATUSES = new Set(['resolved', 'failed', 'needs_user']);
const LIBRARY_STATUSES = new Set([...STATUSES, 'taught']);

function sha(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function categoryKey(input, fallback = 'unknown') {
  if (typeof input !== 'string' || /@|https?:\/\/|\/Users\/|\/private\/|\bsk-[a-z0-9_-]{8,}/i.test(input)) return fallback;
  const tokens = input.toLowerCase().trim().replace(/[^a-z0-9._ -]+/g, '')
    .replace(/[\s-]+/g, '_').replace(/_+/g, '_').replace(/\.+/g, '.')
    .replace(/^[_\.]+|[_\.]+$/g, '');
  // Explicitly refuse secrets, identifiers, URLs and arbitrary long strings
  // as classification keys. The caller uses a one-way digest fallback.
  if (tokens.length < 3 || tokens.length > 84 || /[a-f0-9]{20,}/.test(tokens) ||
      tokens.split(/[._]/).some(part => part.length > 36)) return fallback;
  return tokens;
}

export function sanitizeLesson(input, max = 210) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/(?:https?:\/\/|www\.)[^\s"'<>]+/gi, '[url]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]')
    .replace(/\b(?:Bearer|Basic)\s+[a-z0-9._~+\/-]+/gi, '[credential]')
    .replace(/\b(?:sk|pk|rk|ghp|gho|glpat|xoxb|xoxp)-[a-z0-9_-]{8,}\b/gi, '[credential]')
    .replace(/\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|cookie|secret)\s*[:=]\s*[^\s,;]+/gi, '[credential]')
    .replace(/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[credential]')
    .replace(/(?:\/Users\/|\/private\/|\/tmp\/|~\/|[A-Za-z]:\\)[^\s"'<>;,]+/g, '[path]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b(?:[a-f0-9]{8}-){1,}[a-f0-9]{12}\b/gi, '[identifier]')
    .replace(/\b(?:otp|one[- ]time[- ]code|verification[- ]code|passcode)\s*(?:[:=]|is)?\s*\d{4,8}\b/gi, '[one-time-code]')
    .replace(/\b\d{6,}\b/g, '[identifier]')
    .replace(/\b[a-zA-Z0-9_-]{18,}\b/g, '[identifier]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeSteps(raw) {
  return Array.isArray(raw) ? raw.slice(0, 7).map(step => sanitizeLesson(step, 165)).filter(Boolean) : [];
}

export function toolsObserved(events = []) {
  const tools = new Set();
  let calls = 0;
  let failures = 0;
  for (const event of events) {
    if (event?.type === 'tool_result') {
      if (event.is_error === true) failures++;
      continue;
    }
    if (event?.type !== 'tool_use') continue;
    calls++;
    const name = String(event.name || '').toLowerCase();
    const command = typeof event.input?.command === 'string' ? event.input.command : '';
    if (name === 'terminal' || name === 'execute_code') tools.add('shell');
    if (name === 'skills') tools.add('skills');
    if (name === 'webhelm') tools.add('webhelm');
    if (name === 'computer_use' || name === 'computer-use') tools.add('computer-use');
    if (/\bwebhelm\b/.test(command)) tools.add('webhelm');
    if (/\bneo\s+computer-use\b/.test(command)) tools.add('computer-use');
    if (/\bwechat-bro\b/.test(command)) tools.add('wechat-bro');
    if (/\bimsg\b/.test(command)) tools.add('imessage');
  }
  return { tools: [...tools].filter(tool => TOOLS.has(tool)).sort(), calls, failures };
}

export function prepareExperience({
  handoff, result, experience, events = [], backend = 'local', captureMethod = 'executor',
  model = 'unknown', engine = 'unknown', error,
} = {}) {
  if (!result || !STATUSES.has(result.status)) throw new Error('Experience outcome must be resolved, failed or needs_user');
  const category = CATEGORIES.has(experience?.category) ? experience.category : 'other';
  const suppliedScenario = categoryKey(experience?.scenario_key, '');
  const suppliedStrategy = categoryKey(experience?.strategy_key, '');
  const scenarioKey = suppliedScenario || `unclassified.${sha(String(handoff || '')).slice(0, 16)}`;
  const strategyKey = suppliedStrategy || (error ? `runtime.${categoryKey(error.name, 'error')}` : 'unclassified');
  const source = suppliedScenario && suppliedStrategy ?
    (captureMethod === 'postrun_model' ? 'postrun_model' : 'agent') : 'fallback';
  const observed = toolsObserved(events);
  const record = {
    version: 1,
    id: sha(JSON.stringify([scenarioKey, result.status, strategyKey])),
    captured_at: new Date().toISOString(),
    source,
    scenario: {
      key: scenarioKey,
      category,
      symptom: sanitizeLesson(experience?.symptom, 220),
    },
    outcome: result.status,
    strategy: {
      key: strategyKey,
      steps: safeSteps(experience?.steps),
      verification: sanitizeLesson(experience?.verification, 200),
      failure_reason: sanitizeLesson(experience?.failure_reason, 180),
      lesson: sanitizeLesson(experience?.lesson, 200),
    },
    observation: observed,
    runtime: {
      backend: categoryKey(backend, 'local'),
      engine: categoryKey(engine, 'unknown'),
      // Avoid storing full model repository names that could contain user ids or paths.
      model_family: categoryKey(String(model).split('/').at(-1)?.split(':')[0], 'unknown'),
    },
    // All records remain unreviewed until deliberately curated for training.
    training_reviewed: false,
  };
  if (error && !record.strategy.failure_reason) {
    record.strategy.failure_reason = `Runtime error class: ${sanitizeLesson(error.name || 'Error', 45)}`;
  }
  return record;
}

export function experienceDirectory(env = process.env) {
  const raw = env.NEO_ESCALATION_CASES_DIR || DEFAULT_DIR;
  if (typeof raw !== 'string' || !raw.startsWith('/')) {
    throw new Error('NEO_ESCALATION_CASES_DIR must be an absolute local path');
  }
  return resolve(raw);
}

function ensurePrivateDirectory(folder) {
  mkdirSync(folder, {recursive:true, mode:0o700});
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Experience storage must be a real directory');
  // The leaf directory must not be accessible by other users.
  if ((stat.mode & 0o077) !== 0) throw new Error('Experience directory permissions must be 0700');
}

export function storeExperience(record, {dir = experienceDirectory()} = {}) {
  if (!record || !/^[a-f0-9]{64}$/.test(record.id)) throw new Error('Invalid experience identifier');
  ensurePrivateDirectory(dir);
  const destination = join(dir, `${record.id}.json`);
  if (existsSync(destination)) return {stored:false, duplicate:true, id:record.id};
  const scratch = join(dir, `.${record.id}.${randomBytes(8).toString('hex')}.tmp`);
  const fd = openSync(scratch, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(record, null, 2) + '\n', 'utf8');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    // Hardlink gives atomic create-if-absent, including concurrent writers.
    linkSync(scratch, destination);
    return {stored:true, duplicate:false, id:record.id};
  } catch (error) {
    if (error.code === 'EEXIST') return {stored:false, duplicate:true, id:record.id};
    throw error;
  } finally {
    unlinkSync(scratch);
  }
}

export function listExperience({dir = experienceDirectory(), limit = 30, search = ''} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error('Experience limit must be 1..200');
  }
  if (!existsSync(dir)) return [];
  if (!lstatSync(dir).isDirectory()) throw new Error('Invalid experience library directory');
  const query = String(search).toLowerCase().trim();
  const matches = [];
  for (const entry of readdirSync(dir).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const data = JSON.parse(readFileSync(join(dir, entry), 'utf8'));
    if (!data || data.version !== 1 || !LIBRARY_STATUSES.has(data.outcome)) continue;
    const searchable = JSON.stringify([
      data.scenario, data.strategy, data.outcome, data.observation?.tools,
    ]).toLowerCase();
    if (!query || searchable.includes(query)) matches.push(data);
  }
  matches.sort((a,b)=>b.captured_at.localeCompare(a.captured_at));
  return matches.slice(0,limit);
}

export async function generateExperience({
  baseUrl, experiencePrompt, handoff, result, events = [],
  fetcher = fetch, timeoutMs = 150_000,
} = {}) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(baseUrl || '')) throw new Error('Experience recorder requires the local model endpoint');
  const observation = toolsObserved(events);
  const context = {
    sanitized_scenario: sanitizeLesson(handoff, 1100),
    outcome: result?.status,
    result_summary: sanitizeLesson(result?.summary, 250),
    result_reason: sanitizeLesson(result?.reason, 220),
    observed_tools: observation.tools,
    tool_calls: observation.calls,
    tool_errors: observation.failures,
  };
  let response;
  try {
    response = await fetcher(baseUrl + '/chat/completions', {
      method: 'POST',
      redirect: 'error',
      headers: {'content-type':'application/json'},
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model:'neo-escalation',
        messages:[
          {role:'system',content:experiencePrompt},
          {role:'user',content:JSON.stringify(context)},
        ],
        temperature:0,
        max_tokens:950,
        response_format:{type:'json_object'},
        chat_template_kwargs:{enable_thinking:false},
      }),
    });
  } catch (error) { throw new Error('Local experience recorder connection failed: ' + error.message); }
  if (!response.ok) throw new Error('Local experience recorder returned HTTP ' + response.status);
  const payload = await response.json();
  const answer = payload?.choices?.[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) throw new Error('Local experience recorder produced no JSON text');
  let candidate;
  try { candidate = JSON.parse(answer.trim()); }
  catch { throw new Error('Local experience recorder returned malformed JSON'); }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Local experience candidate is not an object');
  return candidate;
}


/** Owner-confirmed teaching is not evidence of an executed task. */
export function prepareTaughtExperience(candidate, {engine='llama', model='unknown'}={}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw Error('Invalid taught lesson');
  }
  const scenario=categoryKey(candidate.scenario_key,'');
  const strategy=categoryKey(candidate.strategy_key,'');
  if(!scenario || !strategy) throw Error('Teaching requires safe stable scenario and strategy keys');
  const record=prepareExperience({
    handoff:'owner-taught lesson',result:{status:'resolved'},experience:candidate,
    engine,model,backend:'local',
  });
  if (!record.strategy.steps.length || !record.strategy.lesson || !record.scenario.symptom) {
    throw Error('Teaching requires symptom, at least one step, and principle');
  }
  // Preserve more of the owner's detailed teaching than the compact auto-captured case.
  record.scenario.symptom=sanitizeLesson(candidate.symptom,400);
  record.strategy.steps=candidate.steps.slice(0,12).map(step=>sanitizeLesson(step,450)).filter(Boolean);
  record.strategy.verification=sanitizeLesson(candidate.verification || 'Not verified; owner described procedure',400);
  record.strategy.lesson=sanitizeLesson(candidate.lesson,550);
  record.id=sha(JSON.stringify([scenario,'taught',strategy]));
  record.source='owner_taught';
  record.outcome='taught';
  record.owner_confirmed=true;
  record.observation={tools:[],calls:0,failures:0};
  record.training_reviewed=false;
  return record;
}

/** Allow revisions to owner-taught lessons, never overwrite execution evidence. */
export function storeTaughtExperience(record, {dir=experienceDirectory()}={}) {
  if(!record || record.source!=='owner_taught' || record.outcome!=='taught' ||
      !record.owner_confirmed || !/^[a-f0-9]{64}$/.test(record.id)) {
    throw Error('Only confirmed owner-taught lessons can be saved');
  }
  ensurePrivateDirectory(dir);
  const destination=join(dir,record.id+'.json');
  if(existsSync(destination)) {
    if(lstatSync(destination).isSymbolicLink()) throw Error('Unsafe existing lesson path');
    const current=JSON.parse(readFileSync(destination,'utf8'));
    if(current.source!=='owner_taught' || current.outcome!=='taught') {
      throw Error('Cannot overwrite observed Escalation evidence');
    }
    const scratch=join(dir,'.'+record.id+'.'+randomBytes(8).toString('hex')+'.tmp');
    const fd=openSync(scratch,'wx',0o600);
    try {writeFileSync(fd,JSON.stringify(record,null,2)+'\n');fsyncSync(fd);}
    finally {closeSync(fd);}
    try {renameSync(scratch,destination);} finally {if(existsSync(scratch)) unlinkSync(scratch);}
    return {stored:true,updated:true,id:record.id};
  }
  return {...storeExperience(record,{dir}),updated:false};
}

function tokens(text) {
  const stop=new Set(['with','from','have','that','this','when','after','before','should',
    'error','failed','using','into','need','your','user','then','what','can',
    '怎么','什么','这个','那个','需要','失败','完成','进行','可以','如何']);
  const found=new Set();
  for(const word of String(text||'').toLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\p{Script=Han}]{2,}/gu)||[]) {
    if(/^[\p{Script=Han}]+$/u.test(word)){
      for(let i=0;i<word.length-1;i++){
        const pair=word.slice(i,i+2);
        if(!stop.has(pair)) found.add(pair);
      }
    } else if(!stop.has(word)) found.add(word);
  }
  return found;
}

export function relevantTaughtExperience(handoff,{dir=experienceDirectory(),limit=4}={}) {
  const terms=tokens(handoff);
  if(!terms.size) return [];
  return listExperience({dir,limit:200}).filter(item=>item.source==='owner_taught' && item.owner_confirmed)
    .map(item=>{
      const surface=tokens([item.scenario.key.replace(/[._]/g,' '),item.scenario.symptom,
        item.strategy.key.replace(/[._]/g,' '),item.strategy.lesson,...item.strategy.steps].join(' '));
      return {item,score:[...terms].filter(word=>surface.has(word)).length};
    }).filter(row=>row.score>=2)
    .sort((a,b)=>b.score-a.score || b.item.captured_at.localeCompare(a.item.captured_at))
    .slice(0,limit).map(row=>row.item);
}

export function renderTaughtExperience(handoff,options={}) {
  const items=relevantTaughtExperience(handoff,options);
  if(!items.length) return '';
  return items.map(item=>[
    'Scenario: '+item.scenario.symptom,
    'Strategy: '+item.strategy.key,
    ...item.strategy.steps.map((step,i)=>String(i+1)+'. '+step),
    'Verify: '+item.strategy.verification,
    'Lesson: '+item.strategy.lesson,
  ].join('\n')).join('\n\n').slice(0,4500);
}
