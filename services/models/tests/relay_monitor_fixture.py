"""Synthetic Relay history/inventory + real NATS + native Orchestrator outbox."""
import contextlib, hashlib, json, os, socket, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from gateway_fixture import free_port,wait_port,request,TOKEN

PREFIX="test.monitor.job"
AT="2026-11-24T00:00:00.000Z"
def job(id,state):
    return {"id":id,"repository":"fixture","state":state,"runtimeStatus":state,"createdAt":AT,"updatedAt":AT,"title":"not forwarded"}
def publish(port,event):
    data=json.dumps(event).encode()
    subject=f"{PREFIX}.{event['job_id']}.{event['type']}"
    with socket.create_connection(("127.0.0.1",port),timeout=3) as s:
        f=s.makefile("rb");assert f.readline().startswith(b"INFO ")
        s.sendall(b'CONNECT {"verbose":false}\r\n'+f"PUB {subject} {len(data)}\r\n".encode()+data+b"\r\nPING\r\n")
        while f.readline().strip()!=b"PONG": pass
def stop(p):
    if p.poll() is None:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
def eventually(fn):
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        result=fn()
        if result:return result
        time.sleep(.1)
    raise AssertionError("fixture condition not reached")
def main(binary):
    with tempfile.TemporaryDirectory(prefix="neo-relay-monitor-") as tmp, contextlib.ExitStack() as stack:
        root=Path(tmp);home=root/"home";home.mkdir()
        state=root/"state";orch=state/"orchestrator";orch.mkdir(parents=True)
        (orch/"bootstrap-head.json").write_text(json.dumps({"projectId":"g-p-fixtureproject","threadId":"fixture_thread_123"}))
        monitor=state/"orchestrator-relay-events";monitor.mkdir()
        (monitor/"live-watches.json").write_text(json.dumps({"version":1,"watches":[{"repository":"fixture","jobId":"3","startCursor":0}]}))
        token=root/"token";token.write_text(TOKEN);token.chmod(0o600)
        watch={"type":"task.completed","job_id":"3","task_id":"9","event_id":"fixture_event_123","timestamp":AT,"data":{"message":"UNTRUSTED CONTENT"}}
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                p=urlparse(self.path);q=parse_qs(p.query)
                if p.path=="/api/jobs":value={"jobs":[job("1","COMPLETED"),job("2","ACTIVE"),job("3","ACTIVE")]}
                elif p.path=="/api/job":value=job(q["id"][0],"ACTIVE")
                elif p.path=="/events":
                    after=int(q.get("after",["0"])[0]);value={"job_id":"3","next_cursor":1 if after==0 else after,"events":[{"cursor":1,"event":watch}] if after==0 else []}
                else:self.send_error(404);return
                raw=json.dumps(value).encode();self.send_response(200);self.send_header("Content-Length",str(len(raw)));self.end_headers();self.wfile.write(raw)
        dashboard=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        threading.Thread(target=dashboard.serve_forever,daemon=True).start();stack.callback(dashboard.server_close);stack.callback(dashboard.shutdown)
        p=dashboard.server_port;nats=free_port();port=free_port()
        log=stack.enter_context(open(root/"nats.log","w"));broker=subprocess.Popen(["nats-server","-a","127.0.0.1","-p",str(nats)],stdout=log,stderr=log);stack.callback(stop,broker);wait_port(nats)
        env={**os.environ,"HOME":str(home),"NEO_MODELS_STATE_DIR":str(state),"NEO_MODELS_TOKEN_FILE":str(token),"NEO_MODEL_GATEWAY_PORT":str(port),"EVENTS_BUS_NATS_URL":f"nats://127.0.0.1:{nats}","EVENTS_BUS_SUBJECT_PREFIX":PREFIX,"EVENTS_BUS_CONFIG":str(root/"absent.json"),"NEO_MODEL_REPLY_EVENTS":"0","NEO_ORCHESTRATOR_RELAY_EVENTS":"1","NEO_MODELS_RELAY_URL":f"http://127.0.0.1:{p}","EVENTS_BUS_API_URL":f"http://127.0.0.1:{p}"}
        env.pop("NEO_MODELS_LEGACY_ORIGIN",None)
        log=stack.enter_context(open(root/"gateway.log","w"));server=subprocess.Popen([binary],env=env,stdout=log,stderr=log);stack.callback(stop,server);wait_port(port)
        def pending():return json.load(request(port,"/orchestrator-chat/pending"))["pending"]
        eventually(lambda:len(pending())==1)
        assert pending()[0]["requestId"].startswith("relay-watch-")
        event={"type":"job.runtime_status.changed","job_id":"2","data":{"to":"COMPLETED","updatedAt":AT,"repository":"fixture","message":"UNTRUSTED CONTENT"}}
        publish(nats,event);publish(nats,event);publish(nats,watch)
        eventually(lambda:len(pending())==2)
        assert sorted(x["requestId"].split("-")[1] for x in pending())==["terminal","watch"]
        saved=json.loads((orch/"state.json").read_text())
        assert all("UNTRUSTED CONTENT" not in x["text"] and "not forwarded" not in x["text"] for x in saved["requests"].values())
        assert json.loads((monitor/"live-watch-cursors.json").read_text())["3"]==1
        stop(server)
        server=subprocess.Popen([binary],env=env,stdout=log,stderr=log);stack.callback(stop,server);wait_port(port)
        publish(nats,event);publish(nats,watch);time.sleep(.5)
        assert len(pending())==2
        print("PASS Relay silent baseline, native NATS terminal/watch wakeup, history cursor, deduplication and restart")
if __name__=="__main__":main(sys.argv[1])
