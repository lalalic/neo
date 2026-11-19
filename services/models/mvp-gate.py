#!/usr/bin/env python3
"""MANDATORY real Codex CLI MVP gate for Neo Model Gateway releases.

This script NEVER invokes publish, chat_report or writes response state. It only
sends user prompts through Codex CLI and reads the Gateway's recorded receipts.
Pass requires actual model tool calls and Codex turn completion.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import pexpect


def sessions(state):
    for file in (state / 'sessions').glob('*.json'):
        try:
            s = json.loads(file.read_text())
            user = [m.get('text', '') for m in s.get('lastInput', []) if m.get('role') == 'user']
            if not user or not s.get('lastResponseId'):
                continue
            r = json.loads((state / 'responses' / (s['lastResponseId'] + '.json')).read_text())
            yield user[-1], s, r
        except (OSError, ValueError, KeyError):
            continue


def find_response(state, marker, started_ms):
    matching = [(s, r) for text, s, r in sessions(state)
                if text.startswith(marker) and s.get('createdAt', 0) >= started_ms]
    return matching[-1] if matching else None


def validate_response(state, marker, started_ms, answer, expected_reports):
    pair = find_response(state, marker, started_ms)
    if pair is None:
        raise RuntimeError('No Model Gateway response found for ' + marker)
    session, response = pair
    if response.get('status') != 'completed':
        raise RuntimeError(f'{marker} not completed: {response.get("status")}: {response.get("error")}')
    if response.get('reports') != expected_reports:
        raise RuntimeError(f'{marker} unexpected streamed reports: {response.get("reports")}')
    if (response.get('output') or [{}])[0].get('content', [{}])[0].get('text') != answer:
        raise RuntimeError(f'{marker} output text did not match expected answer')
    if not session.get('threadId'):
        raise RuntimeError(f'{marker} did not produce a durable ChatGPT Thread')
    if not session.get('codexThreadId'):
        raise RuntimeError(f'{marker} did not persist a Codex Thread ID mapping')
    return session, response


def codex_exec(label, prompt, expected, config, state, cwd, folder, started_ms, expected_reports):
    cmd = ['codex', 'exec', '-p', 'neo', '-c', config, '--json',
           '--sandbox', 'read-only', '--skip-git-repo-check', '-C', str(cwd), prompt]
    result = subprocess.run(cmd, stdin=subprocess.DEVNULL, text=True, capture_output=True, cwd=str(cwd), timeout=210)
    (folder / (label + '.jsonl')).write_text(result.stdout)
    (folder / (label + '.stderr')).write_text(result.stderr)
    if result.returncode != 0:
        raise RuntimeError(f'{label} Codex CLI failed exit={result.returncode}: {result.stderr[-300:]}')
    events = [json.loads(x) for x in result.stdout.splitlines() if x.strip().startswith('{')]
    answer_events = [x['item']['text'] for x in events if x.get('type') == 'item.completed'
                     and x.get('item', {}).get('type') == 'agent_message']
    if not any(x.get('type') == 'turn.completed' for x in events) or expected not in answer_events:
        raise RuntimeError(f'{label} Codex did not report final exact answer and turn.completed')
    session, response = validate_response(state, label, started_ms, expected, expected_reports)
    codex_ids = [x.get('thread_id') for x in events if x.get('type') == 'thread.started']
    if len(codex_ids) != 1 or codex_ids[0] != session['codexThreadId']:
        raise RuntimeError(f'{label} Codex CLI Thread ID does not match persisted Gateway mapping')
    return {'codex_completed': True, 'model_status': response['status'],
            'reports': len(expected_reports), 'session': session['id'], 'thread': session['threadId']}


def native_two_turns(config, state, cwd, folder, started_ms, nonce):
    m1 = f'MVP2_NATIVE_{nonce}_T1'
    m2 = f'MVP2_NATIVE_{nonce}_T2'
    a1 = f'EVENT_NATIVE_FIRST_PASS_{nonce}'
    a2 = f'EVENT_NATIVE_SECOND_PASS_{nonce}'
    p1 = (m1 + f'. Answer exactly the words EVENT, NATIVE, FIRST, PASS, {nonce} joined by underscores. '
          'Use the connected Events Bus publish tool with reply.text seq 1 then separate reply.completed. No chat_report.')
    p2 = (m2 + f'. Second turn in the SAME Codex session. Answer exactly the words EVENT, NATIVE, SECOND, PASS, {nonce} joined by underscores. '
          'Publish reply.text and separate reply.completed. Do not edit files.')
    argv = ['-p', 'neo', '-c', config, '-s', 'read-only', '-C', str(cwd), p1]
    child = pexpect.spawn('codex', argv, cwd=str(cwd), env={**os.environ,
        'TERM':'xterm-256color', 'COLUMNS':'120', 'LINES':'38'},
        encoding='utf-8', timeout=0.5, dimensions=(38, 120))
    output = ''; sent = False; title_done = False; sent_at = 0; retries = 0
    first = None; second = None
    try:
        with (folder / 'mvp2-tui.log').open('w', buffering=1) as log:
            deadline = time.monotonic() + 210
            while time.monotonic() < deadline and child.isalive():
                try:
                    chunk = child.read_nonblocking(size=16384, timeout=0.2)
                    output = (output + chunk)[-250000:]
                    log.write(chunk)
                except (pexpect.TIMEOUT, pexpect.EOF):
                    pass
                first = find_response(state, m1, started_ms) or first
                second = find_response(state, m2, started_ms) or second
                if not title_done:
                    title_done = any(text.startswith('Generate a concise, single-line task title')
                                     and s.get('createdAt', 0) >= started_ms
                                     and r.get('status') in ('completed', 'failed')
                                     for text, s, r in sessions(state))
                if first and first[1].get('status') == 'completed' and title_done and a1 in output and not sent:
                    time.sleep(2)
                    child.send(p2)
                    time.sleep(0.8)
                    child.send('\r')
                    sent = True; sent_at = time.monotonic()
                if sent and second is None and retries < 2 and time.monotonic() - sent_at > 4 + retries * 3:
                    child.send('\r')
                    retries += 1
                if sent and second and second[1].get('status') == 'completed' and a2 in output:
                    s1, r1 = first  # Cached before the Session's lastInput becomes Turn 2.
                    s2, r2 = second
                    if r1.get('reports') != [a1] or r2.get('reports') != [a2]:
                        raise RuntimeError('Native Codex TUI reports did not match the expected autonomous responses')
                    if s1['id'] != s2['id'] or s1.get('threadId') != s2.get('threadId') or s1.get('codexThreadId') != s2.get('codexThreadId'):
                        raise RuntimeError('Native Codex TUI did not reuse Gateway session / Codex Thread / ChatGPT Thread')
                    return {'codex_completed': True, 'same_session': True, 'same_thread': True,
                            'session':s1['id'], 'thread':s1['threadId']}
            raise RuntimeError('Native TUI did not finish two turns: '+str({
                'first':first[1].get('status') if first else None,
                'second':second[1].get('status') if second else None,
                'title_done':title_done,'submitted_second':sent,'visible_first':a1 in output,
                'visible_second':a2 in output}))
    finally:
        if child.isalive():
            child.sendcontrol('c')
            try: child.expect(pexpect.EOF, timeout=3)
            except (pexpect.TIMEOUT, pexpect.EOF): child.terminate(force=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', required=True, help='Staged or live Neo responses API, e.g. http://127.0.0.1:8786/v1')
    parser.add_argument('--state-dir', required=True, type=Path, help='Read-only ModelStore path used by target Gateway')
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    if not args.state_dir.joinpath('sessions').is_dir():
        raise RuntimeError('state-dir has no Gateway sessions directory')
    folder = args.output_dir.resolve()
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    cwd = folder / 'codex'
    cwd.mkdir(parents=True, exist_ok=True)
    nonce = uuid.uuid4().hex[:8].upper()
    config = 'model_providers.neo-local.base_url="' + args.base_url + '"'
    print(json.dumps({'gate':'start','nonce':nonce,'api':args.base_url}), flush=True)

    m1=f'MVP1_SINGLE_{nonce}'
    a1=f'EVENT_SINGLE_PASS_{nonce}'
    p1=m1+f'. Answer exactly the words EVENT, SINGLE, PASS, {nonce} joined by underscores. Publish reply.text with seq 1 then separate reply.completed. No chat_report.'
    started=int(time.time()*1000)
    r1=codex_exec(m1,p1,a1,config,args.state_dir,cwd,folder,started,[a1])
    print(json.dumps({'gate':'MVP1_PASS',**r1}),flush=True)

    started=int(time.time()*1000)
    r2=native_two_turns(config,args.state_dir,cwd,folder,started,nonce)
    print(json.dumps({'gate':'MVP2_PASS',**r2}),flush=True)

    m3=f'MVP3_STREAM_{nonce}'
    x1=f'EVENT_STREAM_FIRST_{nonce}'
    x2=f'EVENT_STREAM_SECOND_{nonce}'
    a3=x1+'\n'+x2
    p3=(m3+f'. Publish THREE separate Events Bus events, without combining text: '
        f'1) reply.text seq=1 text={x1}; 2) reply.text seq=2 text={x2}; '
        '3) reply.completed. Source must include response ID from top instructions. No chat_report.')
    started=int(time.time()*1000)
    r3=codex_exec(m3,p3,a3,config,args.state_dir,cwd,folder,started,[x1,x2])
    print(json.dumps({'gate':'MVP3_PASS',**r3}),flush=True)
    print(json.dumps({'gate':'ALL_3_MVPS_PASS','nonce':nonce}),flush=True)


if __name__=='__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'gate':'FAIL','error':str(error)}),file=sys.stderr,flush=True)
        sys.exit(1)
