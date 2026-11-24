"""Native HTTP/NATS/WebHelm CLI fixture. No browser or paid provider calls."""
import contextlib
import hashlib
import base64
import re
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

TOKEN = "fixture-token-not-a-real-secret-0123456"
CODEX = "11111111-1111-4111-8111-111111111111"

def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

def wait_port(port):
    end = time.monotonic() + 15
    while time.monotonic() < end:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=.3):
                return
        except OSError:
            time.sleep(.05)
    raise RuntimeError("listener not ready")

def publish(port, prefix, ident, kind, data):
    value = json.dumps({"type":kind,"source":{"id":"reply/models/"+ident},"data":data}).encode()
    subject = prefix + ".reply.models." + ident
    with socket.create_connection(("127.0.0.1",port),timeout=3) as sock:
        stream=sock.makefile("rb")
        assert stream.readline().startswith(b"INFO ")
        sock.sendall(b'CONNECT {"verbose":false}\r\n'+f"PUB {subject} {len(value)}\r\n".encode()+value+b"\r\nPING\r\n")
        while stream.readline().strip()!=b"PONG":
            pass

def request(port, path, body=None, auth=True, headers=None):
    hdr={"Content-Type":"application/json",**(headers or {})}
    if auth: hdr["Authorization"]="Bearer "+TOKEN
    req=urllib.request.Request(f"http://127.0.0.1:{port}{path}",headers=hdr,
        data=None if body is None else json.dumps(body).encode())
    try: return urllib.request.urlopen(req,timeout=10)
    except urllib.error.HTTPError as e:return e

def main(binary):
    with tempfile.TemporaryDirectory(prefix="neo-models-rust-") as tmp:
        root=Path(tmp);home=root/"home";home.mkdir()
        state=root/"state";token=root/"token";token.write_text(TOKEN);token.chmod(0o600)
        actions=root/"actions.jsonl"
        fixture=root/"webhelm";fixture.write_text("""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
if args[:2]==["session","start"]:
 print(json.dumps({"session_id":"0123456789abcdef","workspace":"WebHelm"}))
elif args[:2] in [["session","stop"],["session","heartbeat"]]:
 print('{"ok":true}')
elif args[:3]==["platform","run","chatgpt"]:
 config=json.loads(Path(args[args.index("--config")+1]).read_text())
 with open(os.environ["FIXTURE_ACTIONS"],"a") as f:f.write(json.dumps({"action":args[3],"config":config})+"\\n")
 print(json.dumps({"status":"submitted","thread_id":"fixture_thread_123","thread_url":"https://chatgpt.com/c/fixture_thread_123","verified_by":"fixture"}))
else: sys.exit(2)
""");fixture.chmod(0o700)
        nats_port=free_port();port=free_port();prefix="test.models.native.job"
        with contextlib.ExitStack() as stack:
            log=stack.enter_context(open(root/"nats.log","w"))
            broker=subprocess.Popen(["nats-server","-a","127.0.0.1","-p",str(nats_port)],stdout=log,stderr=log)
            def stop(p):
                if p.poll() is None:
                    p.terminate()
                    try:p.wait(timeout=4)
                    except subprocess.TimeoutExpired:p.kill();p.wait()
            stack.callback(stop,broker);wait_port(nats_port)
            env={**os.environ,"HOME":str(home),"NEO_MODELS_STATE_DIR":str(state),
                "NEO_MODELS_TOKEN_FILE":str(token),"NEO_MODEL_GATEWAY_PORT":str(port),
                "NEO_MODELS_WEBHELM_COMMAND":str(fixture),"FIXTURE_ACTIONS":str(actions),
                "EVENTS_BUS_NATS_URL":f"nats://127.0.0.1:{nats_port}","EVENTS_BUS_SUBJECT_PREFIX":prefix,
                "EVENTS_BUS_CONFIG":str(root/"absent.json"),"NEO_MODEL_REPLY_EVENTS":"1",
                "NEO_MODEL_HOLD_CHATGPT_SESSION":"1","NEO_MODEL_WEBHELM_PLATFORM":"chatgpt"}
            env.pop("NEO_MODELS_LEGACY_ORIGIN",None)
            slog=stack.enter_context(open(root/"models.log","w"))
            server=subprocess.Popen([binary],env=env,stdout=slog,stderr=slog)
            stack.callback(stop,server);wait_port(port)
            assert request(port,"/v1/models",auth=False).status==401
            assert json.load(request(port,"/v1/models"))["data"][0]["id"]=="neo"
            assert json.load(request(port,"/v1/models?client_version=0.165.0"))["models"][0]["slug"]=="neo"
            print("PASS authenticated OpenAI/Codex catalogs",flush=True)
            body={"model":"neo","stream":False,"input":[{"role":"system","content":"DO NOT FORWARD"},{"role":"user","id":"fixture_item_one","content":"first turn"}]}
            headers={"thread-id":CODEX}
            with request(port,"/v1/responses",body,headers=headers) as r:
                assert r.status==202,r.read()
                ident=json.load(r)["id"]
            def wait_action(count):
                for _ in range(150):
                    if actions.exists():
                        rows=[json.loads(x) for x in actions.read_text().splitlines()]
                        if len(rows)>=count:return rows
                    time.sleep(.02)
                raise RuntimeError("WebHelm fixture action not called")
            rows=wait_action(1);assert rows[0]["action"]=="new-thread"
            assert rows[0]["config"]["message"]=="[USER]\nfirst turn\n[/USER]"
            assert ident in rows[0]["config"]["enforcement_context"]
            publish(nats_port,"test.models.native",ident,"reply.text",{"seq":1,"text":"first report"})
            publish(nats_port,"test.models.native",ident,"reply.completed",{})
            for _ in range(100):
                result=json.load(request(port,"/v1/responses/"+ident))
                if result["status"]=="completed":break
                time.sleep(.03)
            assert result["output"][0]["content"][0]["text"]=="first report",result
            print("PASS real native NATS reply completion and durable first turn",flush=True)
            # A replay must not dispatch another browser action.
            replay=request(port,"/v1/responses",body,headers=headers)
            assert replay.status==200 and json.load(replay)["id"]==ident
            assert len(wait_action(1))==1
            # Stream second turn. SSE opening is delivered before terminal.
            body={"model":"neo","stream":True,"input":[{"role":"user","id":"fixture_item_two","content":"second turn"}]}
            with request(port,"/v1/responses",body,headers=headers) as stream:
                assert stream.status==200
                assert stream.readline().strip()==b"event: response.created"
                created=json.loads(stream.readline().decode()[6:]);second=created["response"]["id"]
                rows=wait_action(2);assert rows[1]["action"]=="new-turn"
                assert rows[1]["config"]["thread_id"]=="fixture_thread_123"
                assert rows[1]["config"]["message"]=="[USER]\nsecond turn\n[/USER]"
                publish(nats_port,"test.models.native",second,"reply.text",{"seq":1,"text":"one"})
                def next_delta():
                    while True:
                        line=stream.readline()
                        if not line:raise AssertionError("premature SSE EOF")
                        if line.startswith(b"data: "):
                            value=json.loads(line[6:])
                            if value["type"]=="response.output_text.delta":return value["delta"]
                assert next_delta()=="one"
                publish(nats_port,"test.models.native",second,"reply.text",{"seq":2,"text":"two"})
                assert next_delta()=="\ntwo"
                publish(nats_port,"test.models.native",second,"reply.completed",{})
                rest=stream.read().decode();assert "event: response.completed" in rest,rest
            print("PASS real HTTP streaming, two separate deltas and explicit terminal",flush=True)
            sessions=[json.loads(x.read_text()) for x in (state/"sessions").glob("*.json")]
            assert len(sessions)==1 and sessions[0]["codexThreadId"]==CODEX and sessions[0]["threadId"]=="fixture_thread_123"
            assert len(wait_action(2))==2
            bad=request(port,"/v1/responses",{"model":"neo","input":"wrong owner","previous_response_id":ident},headers={"thread-id":"22222222-2222-4222-8222-222222222222"})
            assert bad.status==400
            print("PASS exact persisted Thread identity and cross-owner rejection",flush=True)
            stop(server)
            server=subprocess.Popen([binary],env=env,stdout=slog,stderr=slog);stack.callback(stop,server);wait_port(port)
            assert json.load(request(port,"/v1/responses/"+second))["status"]=="completed"
            print("PASS persisted response readback after process restart",flush=True)
            # Bootstrap only the synthetic project/head, never the production one.
            stop(server)
            (state/"orchestrator"/"bootstrap-head.json").write_text(json.dumps({"projectId":"g-p-fixtureproject","threadId":"fixture_thread_123"}))
            server=subprocess.Popen([binary],env=env,stdout=slog,stderr=slog);stack.callback(stop,server);wait_port(port)
            health=json.load(request(port,"/orchestrator-chat/health"))
            assert health["ready"],health
            rid="fixture_mobile_request"
            attachment="fixture_attachment"
            data=b"native attachment fixture"
            chunk={"requestId":rid,"attachmentId":attachment,"name":"fixture.txt","sha256":hashlib.sha256(data).hexdigest(),"size":len(data),"chunkCount":1,"chunkIndex":0,"contentBase64":base64.b64encode(data).decode()}
            assert json.load(request(port,"/orchestrator-chat/attachments",chunk))["complete"]
            assert json.load(request(port,"/orchestrator-chat/attachments",chunk))["complete"]
            msg={"requestId":rid,"text":"mobile turn","attachments":[{"id":attachment,"name":"fixture.txt"}]}
            assert request(port,"/orchestrator-chat/messages",msg).status==400
            hdr={"Idempotency-Key":rid}
            assert request(port,"/orchestrator-chat/messages",msg,headers=hdr).status==202
            assert request(port,"/orchestrator-chat/messages",msg,headers=hdr).status==202
            assert request(port,"/orchestrator-chat/messages",{**msg,"text":"different"},headers=hdr).status==409
            assert request(port,"/orchestrator-chat/attachments",chunk).status==400
            rows=wait_action(3)
            config=rows[2]["config"]
            assert config["thread_id"]=="fixture_thread_123"
            assert len(config["file"])==1 and Path(config["file"][0]).read_bytes()==data,config
            assert "mobile turn" in config["message"]
            mobile_id=re.search(r"resp_[0-9a-f]{40}",config["enforcement_context"]).group()
            envelope=json.dumps({"schema":"neo.orchestrator.reply.v1","message":{"text":"mobile report","level":"info","needs":"none"}})
            publish(nats_port,"test.models.native",mobile_id,"reply.text",{"seq":1,"text":envelope})
            publish(nats_port,"test.models.native",mobile_id,"reply.completed",{})
            for _ in range(100):
                pending=json.load(request(port,"/orchestrator-chat/pending?requestId="+rid))
                item=pending["pending"][0]
                if item["status"]=="completed":break
                time.sleep(.05)
            assert item["status"]=="completed" and item["message"]["text"]=="mobile report",item
            assert pending["accepted"] and len(wait_action(3))==3
            print("PASS native Orchestrator queue, idempotency, verified attachments and private Responses transport",flush=True)
            with request(port,"/orchestrator-chat/events?cursor=0") as stream:
                names=[]
                while "event: message.completed" not in names:
                    line=stream.readline().decode().strip()
                    assert line or stream.status==200
                    if line.startswith("event: "):names.append(line)
                assert names==["event: message.accepted","event: message.processing","event: message.completed"],names
            assert request(port,"/orchestrator-chat/events?cursor=999999").status==400
            assert request(port,"/orchestrator-chat/ack",{"deliveryId":item["deliveryId"]}).status==200
            pending=json.load(request(port,"/orchestrator-chat/pending?requestId="+rid))
            assert pending["accepted"] and not pending["pending"],pending
            assert not Path(config["file"][0]).exists()
            assert json.load(request(port,"/v1/responses/"+mobile_id))["output"]==[]
            assert request(port,"/v1/responses",{"model":"neo","input":"forged"},headers={"thread-id":CODEX,"x-neo-orchestrator-grant":"forged"}).status==403
            print("PASS native Orchestrator cursor replay, ACK privacy cleanup and forged grant rejection",flush=True)


if __name__=="__main__":
    main(sys.argv[1])
