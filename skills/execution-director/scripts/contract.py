"""Compile Markcut execution markers into typed execution lanes."""
from __future__ import annotations
import json,re,sys
from pathlib import Path
from typing import Any
class ContractError(ValueError): pass
LANES=("demo","capture","image","video")
FORBIDDEN_KEYS={"actions","coordinates","selector","selectors","xpath","click_sequence","keypress_sequence"}
MARKER=re.compile(r"<!--\s*execution\s+(\{.*?\})\s*-->")

def _text(v,n):
    if not isinstance(v,str) or not v.strip(): raise ContractError(f"{n} must be a non-empty string")
    return v.strip()
def _reject(v,path="item"):
    if isinstance(v,dict):
        for k,c in v.items():
            if k.lower() in FORBIDDEN_KEYS: raise ContractError(f"{path}.{k} is runtime automation detail")
            _reject(c,f"{path}.{k}")
    elif isinstance(v,list):
        for i,c in enumerate(v): _reject(c,f"{path}[{i}]")
def validate_item(item:dict[str,Any])->dict[str,Any]:
    if not isinstance(item,dict): raise ContractError("item must be object")
    for f in ("id","type","scene_id","output"): _text(item.get(f),f"item.{f}")
    if item["type"] not in LANES: raise ContractError("item.type is invalid")
    _reject(item)
    if item["type"]=="demo":
        for f in ("identity","intent","required_visible_evidence","success","presentation","autonomy"):
            if f not in item: raise ContractError(f"demo item missing {f}")
        ident=item["identity"]
        for f in ("product","surface","feature"): _text(ident.get(f),f"identity.{f}")
        if item["success"].get("fresh_ui_required") is not True: raise ContractError("demo success.fresh_ui_required must be true")
    elif item["type"]=="capture":
        if item.get("capture_kind") not in {"human","desktop"}: raise ContractError("capture_kind must be human or desktop")
        _text(item.get("description"),"capture.description")
    elif item["type"] in {"image","video"}:
        _text(item.get("prompt"),f"{item['type']}.prompt")
    return item

def parse_markcut(text:str)->list[dict[str,Any]]:
    items=[]; ids=set()
    for m in MARKER.finditer(text):
        try: item=json.loads(m.group(1))
        except json.JSONDecodeError as e: raise ContractError(f"invalid execution marker JSON: {e}")
        validate_item(item)
        if item["id"] in ids: raise ContractError(f"duplicate execution id: {item['id']}")
        ids.add(item["id"]); items.append(item)
    return items

def compile_execution(text:str, source="video.md"):
    items=parse_markcut(text)
    index={"schema_version":1,"source":source,"items":[]}
    lanes={lane:{"schema_version":1,"items":[]} for lane in LANES}
    for item in items:
        index["items"].append({"id":item["id"],"type":item["type"],"scene_id":item["scene_id"],"status":"pending","output":item["output"]})
        lanes[item["type"]]["items"].append(item)
    return index,lanes

def write_execution(video_path:Path,out_dir:Path):
    index,lanes=compile_execution(video_path.read_text(),video_path.name); out_dir.mkdir(parents=True,exist_ok=True)
    (out_dir/"index.json").write_text(json.dumps(index,indent=2,ensure_ascii=False)+"\n")
    for lane,doc in lanes.items():
        if doc["items"]: (out_dir/f"{lane}.json").write_text(json.dumps(doc,indent=2,ensure_ascii=False)+"\n")
    return index,lanes

def _main(argv):
    if len(argv)!=3: print(f"usage: {argv[0]} VIDEO.md EXECUTION_DIR",file=sys.stderr); return 2
    try: index,_=write_execution(Path(argv[1]),Path(argv[2]))
    except (OSError,ContractError) as e: print(f"invalid execution source: {e}",file=sys.stderr); return 1
    print(json.dumps({"valid":True,"item_count":len(index["items"])})); return 0
if __name__=='__main__': raise SystemExit(_main(sys.argv))
