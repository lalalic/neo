"""Video Director authoring contract: validate semantic input and render canonical Markcut video.md."""
from __future__ import annotations
import json, sys
from pathlib import Path
from typing import Any

class ContractError(ValueError): pass
FORBIDDEN_KEYS={"actions","coordinates","selector","selectors","xpath","click_sequence","keypress_sequence"}
FORBIDDEN_TERMS=("coordinate","css selector","xpath","click sequence","keypress sequence","fixed click","mouse click")
LANES={"demo","capture","image","video"}

def _text(v:Any,n:str)->str:
    if not isinstance(v,str) or not v.strip(): raise ContractError(f"{n} must be a non-empty string")
    return v.strip()

def _reject(v:Any,path="input"):
    if isinstance(v,dict):
        for k,c in v.items():
            if k.lower() in FORBIDDEN_KEYS: raise ContractError(f"{path}.{k} is runtime automation detail")
            _reject(c,f"{path}.{k}")
    elif isinstance(v,list):
        for i,c in enumerate(v): _reject(c,f"{path}[{i}]")
    elif isinstance(v,str):
        low=v.lower()
        for term in FORBIDDEN_TERMS:
            if term in low: raise ContractError(f"{path} contains forbidden runtime detail: {term}")

def validate_input(doc:dict[str,Any])->dict[str,Any]:
    if not isinstance(doc,dict) or doc.get("schema_version")!=1: raise ContractError("schema_version must be 1")
    brief=doc.get("brief")
    if not isinstance(brief,dict): raise ContractError("brief must be an object")
    for f in ("product","audience","channel","style","goal"): _text(brief.get(f),f"brief.{f}")
    dur=brief.get("duration_seconds")
    if not isinstance(dur,(int,float)) or isinstance(dur,bool) or dur<=0: raise ContractError("brief.duration_seconds must be positive")
    scenes=doc.get("scenes")
    if not isinstance(scenes,list) or not scenes: raise ContractError("scenes must be non-empty")
    ids=set(); total=0.0
    for i,s in enumerate(scenes):
        p=f"scenes[{i}]"; sid=_text(s.get("id"),f"{p}.id")
        if sid in ids: raise ContractError(f"duplicate scene id: {sid}")
        ids.add(sid)
        for f in ("purpose","communicates"): _text(s.get(f),f"{p}.{f}")
        ev=s.get("visible_evidence")
        if not isinstance(ev,list) or not ev or any(not isinstance(x,str) or not x.strip() for x in ev): raise ContractError(f"{p}.visible_evidence must be non-empty strings")
        pr=s.get("presentation")
        if not isinstance(pr,dict): raise ContractError(f"{p}.presentation must be object")
        _text(pr.get("focus"),f"{p}.presentation.focus")
        if pr.get("zoom") not in {"none","subtle","emphasis"}: raise ContractError(f"{p}.presentation.zoom is invalid")
        sec=pr.get("duration_seconds")
        if not isinstance(sec,(int,float)) or isinstance(sec,bool) or sec<=0: raise ContractError(f"{p}.presentation.duration_seconds must be positive")
        total+=sec
        req=s.get("execution")
        if req is not None:
            if not isinstance(req,dict) or req.get("type") not in LANES: raise ContractError(f"{p}.execution.type must be one of {sorted(LANES)}")
            _text(req.get("id"),f"{p}.execution.id"); _text(req.get("output"),f"{p}.execution.output")
    if total>dur*1.25: raise ContractError("scene durations exceed brief duration by more than 25%")
    _reject(doc); return doc

def _q(v:str)->str: return json.dumps(v,ensure_ascii=False)

def render_markcut(doc:dict[str,Any])->str:
    validate_input(doc); lines=["# video","width:1920 height:1080 fps:30 layout:series",""]
    for s in doc["scenes"]:
        pr=s["presentation"]; sec=pr["duration_seconds"]
        lines += [f"## {s['id']}",f"title:{_q(s['purpose'])} instruction:{_q(s['communicates'])}"]
        req=s.get("execution")
        if req:
            marker=dict(req); marker["scene_id"]=s["id"]
            marker.setdefault("intent",{"purpose":s["purpose"],"communicates":s["communicates"]})
            marker.setdefault("required_visible_evidence",s["visible_evidence"])
            marker.setdefault("presentation",pr)
            lines.append("<!-- execution "+json.dumps(marker,ensure_ascii=False,separators=(",",":"))+" -->")
            src=req["output"]
        else:
            src=s.get("media",f"assets/{s['id']}.mp4")
        lines.append(f"- video src:{_q(src)} duration:{sec}")
        for caption in pr.get("text",[]): lines.append(f"- component duration:{sec} jsx:{_q(f'<div>{caption}</div>')}")
        if s.get("narration"): lines.append(f"- script {_q(s['narration'])}")
        lines.append("")
    return "\n".join(lines).rstrip()+"\n"

def _main(argv):
    if len(argv) not in {2,3}: print(f"usage: {argv[0]} INPUT.json [OUTPUT.md]",file=sys.stderr); return 2
    try: doc=json.loads(Path(argv[1]).read_text()); out=render_markcut(doc)
    except (OSError,json.JSONDecodeError,ContractError) as e: print(f"invalid video director input: {e}",file=sys.stderr); return 1
    if len(argv)==3: Path(argv[2]).write_text(out)
    else: print(out,end="")
    return 0
if __name__=='__main__': raise SystemExit(_main(sys.argv))
