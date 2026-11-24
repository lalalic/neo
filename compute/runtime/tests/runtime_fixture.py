"""Run the candidate as an actual process; exercise adversarial and failure paths."""
import contextlib
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

BIN = str(Path(sys.argv[1]).resolve())

def eventually(predicate, timeout=5):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            result=predicate()
            if result:return result
        except OSError:pass
        time.sleep(.03)
    raise AssertionError("runtime condition timeout")

def request(port, method, path, body=None, headers=None):
    with contextlib.closing(http.client.HTTPConnection("127.0.0.1",port,timeout=3)) as c:
        c.request(method,path,body=body,headers=headers or {})
        r=c.getresponse()
        return r.status,r.read()

def status(port):
    code,body=request(port,"GET","/status")
    assert code==200
    return json.loads(body)

@contextlib.contextmanager
def runtime(root,cmd):
    with socket.socket() as s:
        s.bind(("127.0.0.1",0))
        port=s.getsockname()[1]
    root.mkdir()
    env={**os.environ,"NEO_GPU_MODE":"batch","NEO_GPU_PORT":str(port),"NEO_GPU_INPUT_DIR":str(root/"input"),"NEO_GPU_OUTPUT_DIR":str(root/"output"),"NEO_GPU_CMD_JSON":json.dumps(cmd)}
    with (root/"runtime.log").open("w") as log:
        p=subprocess.Popen([BIN],env=env,stdout=log,stderr=log)
        try:
            eventually(lambda:request(port,"GET","/health")[0]==200)
            yield port,p
        finally:
            if p.poll() is None:
                p.terminate()
                try:p.wait(timeout=3)
                except subprocess.TimeoutExpired:p.kill();p.wait()
            assert p.returncode==0,p.returncode

with tempfile.TemporaryDirectory(prefix="neo-native-runtime-") as tmp:
    root=Path(tmp)
    script="""import os,pathlib
i=pathlib.Path(os.environ['NEO_GPU_INPUT_DIR'])
o=pathlib.Path(os.environ['NEO_GPU_OUTPUT_DIR'])
(o/'result.bin').write_bytes((i/'data.bin').read_bytes())
(o/'link.txt').symlink_to('/etc/passwd')
os.mkfifo(o/'pipe.txt')
with (o/'large.bin').open('wb') as f:f.truncate(2*1024*1024*1024+1)
print('a'*5000)
"""
    with runtime(root/"batch",[sys.executable,"-c",script]) as (port,p):
        assert request(port,"GET","/outputs/result.bin")[0]==409
        for name in ("..","%2e%2e","%2fetc","x..txt",".hidden","a.b.c"):
            assert request(port,"POST","/inputs/"+name,b"x")[0]!=200
        assert request(port,"POST","/inputs/empty.bin",b"")[0]==413
        # Incomplete body should never be committed, and start while upload
        # is in progress must fail rather than run against a partial file.
        with socket.create_connection(("127.0.0.1",port),timeout=3) as s:
            s.sendall(b"POST /inputs/data.bin HTTP/1.1\r\nHost: localhost\r\nContent-Length: 8\r\n\r\nabc")
            eventually(lambda:any((root/"batch/input").glob("*.tmp")))
            assert request(port,"POST","/start",b"{}")[0]==409
        eventually(lambda:not list((root/"batch/input").iterdir()))
        data=b"complete payload"
        assert request(port,"POST","/inputs/data.bin",data)[0]==200
        assert request(port,"POST","/start",b"{}")[0]==202
        assert request(port,"POST","/inputs/data.bin",b"overwrite")[0]==409
        eventually(lambda:status(port)["phase"]=="completed")
        state=status(port)
        assert state["exitCode"]==0 and len(state["log"])<=2400,state
        assert request(port,"GET","/outputs/result.bin")== (200,data)
        assert request(port,"GET","/outputs/link.txt")[0]==404
        assert request(port,"GET","/outputs/pipe.txt")[0]==404
        assert request(port,"GET","/outputs/large.bin")[0]==413
        assert request(port,"POST","/start",b"{}")[0]==409
        print("PASS atomic uploads, blocked concurrent start, one-shot execution, bounded logs, safe output")
    with runtime(root/"fail",[sys.executable,"-c","import sys;print('failed');sys.exit(17)"]) as (port,p):
        assert request(port,"POST","/start",b"{}")[0]==202
        eventually(lambda:status(port)["phase"]=="failed")
        assert status(port)["exitCode"]==17 and request(port,"GET","/outputs/result.bin")[0]==409
        print("PASS failed command reports exact exit code")
    with runtime(root/"missing",["/nonexistent/neo-fixture"]) as (port,p):
        assert request(port,"POST","/start",b"{}")[0]==422
        assert status(port)["phase"]=="failed"
        print("PASS missing executable fails without retry")
