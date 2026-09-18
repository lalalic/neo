#!/usr/bin/env python3
"""Grade normalized Web/Codex orchestration transcripts without dependencies."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def events(records):
    return [r for r in records if r.get("kind") == "event"]


def fail(msg):
    return {"ok": False, "reason": msg}


def prior_route(records, launch_index, task_id):
    """Return whether this task's visible routing event precedes its launch."""
    return any(
        r.get("kind") == "event"
        and r.get("type") == "model.selected"
        and r.get("task_id") == task_id
        and r.get("visibility") == "user"
        and r.get("data", {}).get("model")
        and r.get("data", {}).get("thinking_effort")
        for r in records[:launch_index]
    )


def check(case, t):
    rs = t.get("records", [])
    if not isinstance(rs, list):
        return fail("records must be an array")
    if case == "bootstrap_project_binding":
        a = next((r for r in rs if r.get("kind") == "action" and r.get("action") == "resolve_project"), None)
        return {"ok": bool(a and a.get("ok") and a.get("local_path") and a.get("git_root") and a.get("repo")), "reason": "resolver must bind local_path, git_root, and repo"}
    if case == "host_project_name_binding":
        host = next((r for r in rs if r.get("kind") == "host_context"), None)
        a = next((r for r in rs if r.get("kind") == "action" and r.get("action") == "resolve_project"), None)
        empty_instructions = host is not None and (host.get("project_instructions") in {"", None} or "project_instructions" not in host)
        return {"ok": bool(host and host.get("project_name") == "neo" and empty_instructions and a and a.get("ok") and a.get("source") == "host_project_name" and a.get("local_path") and a.get("git_root") and a.get("repo")), "reason": "host Project name must bind successfully without Project custom instructions"}
    if case == "resolver_failure":
        a = next((r for r in rs if r.get("kind") == "action" and r.get("action") == "resolve_project"), None)
        return {"ok": bool(a and not a.get("ok") and not any(r.get("kind") == "launch" for r in rs)), "reason": "failed identity resolution must block launch"}
    if case == "ordered_context_and_session_docs":
        ctx = [r for r in rs if r.get("kind") == "context"]
        orders = [r.get("order") for r in ctx]
        mandatory = any("MISSION.md" in str(r.get("path")) and r.get("required") is not False for r in ctx)
        return {"ok": bool(ctx and orders == sorted(orders) and mandatory), "reason": "context files must be read in order and include mandatory session docs"}
    if case == "dynamic_skill_precedence":
        skills = [r for r in rs if r.get("kind") == "skill"]
        names = {r.get("name") for r in skills}
        router = next((r for r in skills if r.get("name") == "model-router"), None)
        return {"ok": bool("model-router" in names and router and router.get("discovered") is True and router.get("precedence") in {"project", "neo", "global"}), "reason": "skills must be dynamically discovered with explicit precedence"}
    if case == "explicit_skill_trigger":
        a = next((r for r in rs if r.get("kind") == "action" and r.get("action") == "explicit_skill"), None)
        return {"ok": bool(a and a.get("trigger", "").startswith("#") and a.get("loaded") is True and a.get("precedence") == "explicit"), "reason": "#skill must load and take explicit precedence"}
    if case in {"route_implementation", "route_research_review"}:
        wanted = {"implementation", "research", "review"} if case == "route_research_review" else {"implementation"}
        launches = [(i, r) for i, r in enumerate(rs) if r.get("kind") == "launch" and r.get("new_worker") is True and r.get("role") in wanted]
        good = all(r.get("routed") is True and prior_route(rs, i, r.get("task_id")) for i, r in launches)
        return {"ok": bool(launches and good), "reason": "every new worker needs a same-task model.selected event earlier in the record stream"}
    if case == "sticky_continuation":
        launch = next((r for r in rs if r.get("kind") == "launch" and r.get("new_worker") is False), None)
        return {"ok": bool(launch and launch.get("sticky") is True and not launch.get("rerouted")), "reason": "persistent continuation must preserve sticky routing"}
    if case == "watch_before_delegation":
        watch = next((i for i, r in enumerate(rs) if r.get("kind") == "action" and r.get("action") == "watch" and r.get("job_id") and r.get("watch_established") is True and isinstance(r.get("after_cursor"), int) and r.get("source") in {"events__watch", "events__history_fresh_job"}), None)
        launch = next((i for i, r in enumerate(rs) if r.get("kind") == "launch"), None)
        return {"ok": watch is not None and launch is not None and watch < launch, "reason": "explicit non-blocking watch must precede delegation"}
    if case == "job_id_propagation":
        launches = [r for r in rs if r.get("kind") == "launch"]
        ids = {r.get("job_id") for r in rs if r.get("kind") in {"launch", "event"} and r.get("job_id")}
        task_ids = {r.get("task_id") for r in launches}
        nested = [r for r in launches if r.get("parent_task_id") is not None]
        meaningful_nested = all(r.get("parent_task_id") in task_ids for r in nested)
        return {"ok": len(ids) == 1 and bool(launches) and bool(nested) and meaningful_nested and all(r.get("job_id") == next(iter(ids), None) for r in launches), "reason": "children and nested tasks must share one job_id and reference a real parent task"}
    if case == "heartbeat":
        long_active = any(r.get("kind") == "action" and r.get("action") == "long_active" and r.get("seconds", 0) > 30 for r in rs)
        heartbeats = [r for r in rs if r.get("kind") == "event" and r.get("type") == "task.heartbeat"]
        return {"ok": long_active and bool(heartbeats) and all(r.get("visibility") == "orchestrator" for r in heartbeats), "reason": "long active work needs non-user-visible orchestrator heartbeat"}
    if case == "render_barrier":
        for i, r in enumerate(rs):
            if r.get("kind") == "event" and r.get("visibility") == "user":
                eid = r.get("event_id")
                if not any(x.get("kind") == "render" and x.get("event_id") == eid for x in rs[i + 1:]):
                    return fail("user-visible event was not rendered")
                first_tool = next((j for j, x in enumerate(rs[i + 1:], i + 1) if x.get("kind") == "tool_call"), None)
                render = next(j for j, x in enumerate(rs[i + 1:], i + 1) if x.get("kind") == "render" and x.get("event_id") == eid)
                if first_tool is not None and first_tool < render:
                    return fail("tool call occurred before render")
        return {"ok": True, "reason": "all user-visible events satisfy render barrier"}
    if case == "task_completion_not_job_terminal":
        types = [e.get("type") for e in events(rs)]
        return {"ok": "task.completed" in types and "job.completed" in types and types.index("task.completed") < types.index("job.completed"), "reason": "task.completed cannot end a multi-task job"}
    if case == "transport_failure_fallback":
        f = next((r for r in rs if r.get("kind") == "fallback"), None)
        return {"ok": bool(f and f.get("structured") is True and f.get("reported") is True and f.get("business_success") is not True), "reason": "transport failure needs structured fallback and degraded-observability report"}
    if case == "unrouted_launch_negative":
        launches = [r for r in rs if r.get("kind") == "launch" and r.get("new_worker") is True]
        bad = any(r.get("routed") is not True for r in launches)
        return {"ok": bad and t.get("expected_failure") is True, "reason": "an unrouted new-worker launch must fail the eval"}
    return fail("unknown case")


def grade(t):
    cases = t.get("cases") or ["bootstrap_project_binding", "host_project_name_binding", "resolver_failure", "ordered_context_and_session_docs", "dynamic_skill_precedence", "explicit_skill_trigger", "route_implementation", "route_research_review", "sticky_continuation", "watch_before_delegation", "job_id_propagation", "render_barrier", "task_completion_not_job_terminal", "transport_failure_fallback", "heartbeat", "unrouted_launch_negative"]
    results = {c: check(c, t) for c in cases}
    return {"ok": all(x["ok"] for x in results.values()), "results": results}


def fixture():
    records = [
        {"kind":"host_context","project_name":"neo","project_instructions":""},{"kind":"action","action":"resolve_project","ok":True,"source":"host_project_name","local_path":"/w/neo","git_root":"/w","repo":"o/r"},
        {"kind":"context","path":"/w/AGENTS.md","order":1},{"kind":"context","path":"/w/neo/AGENTS.md","order":2},{"kind":"context","path":"/w/neo/README.md","order":3},{"kind":"context","path":"/w/neo/MISSION.md","order":4},
        {"kind":"skill","name":"model-router","discovered":True,"precedence":"neo"},{"kind":"action","action":"explicit_skill","trigger":"#events-bus","loaded":True,"precedence":"explicit"},
        {"kind":"action","action":"watch","job_id":"job-1","source":"events__watch","watch_established":True,"after_cursor":0,"buffered_event_count":0},
        {"kind":"event","event_id":"m1","job_id":"job-1","task_id":"impl","type":"model.selected","visibility":"user","data":{"model":"m","thinking_effort":"high"}},
        {"kind":"render","event_id":"m1"},{"kind":"launch","task_id":"impl","role":"implementation","new_worker":True,"routed":True,"job_id":"job-1"},
        {"kind":"event","event_id":"m2","job_id":"job-1","task_id":"research","type":"model.selected","visibility":"user","data":{"model":"m","thinking_effort":"unknown"}},
        {"kind":"render","event_id":"m2"},{"kind":"launch","task_id":"research","role":"research","new_worker":True,"routed":True,"job_id":"job-1"},
        {"kind":"launch","task_id":"impl","new_worker":False,"sticky":True,"rerouted":False,"job_id":"job-1"},
        {"kind":"event","event_id":"m3","job_id":"job-1","task_id":"nested","type":"model.selected","visibility":"user","data":{"model":"m","thinking_effort":"high"}},{"kind":"render","event_id":"m3"},
        {"kind":"launch","task_id":"nested","new_worker":True,"role":"review","routed":True,"job_id":"job-1","parent_task_id":"impl"},
        {"kind":"action","action":"long_active","seconds":31},{"kind":"event","event_id":"hb1","job_id":"job-1","task_id":"impl","type":"task.heartbeat","visibility":"orchestrator"},
        {"kind":"event","event_id":"t1","job_id":"job-1","task_id":"impl","type":"task.completed","visibility":"orchestrator"},{"kind":"tool_call","name":"shell_job_status"},{"kind":"event","event_id":"j1","job_id":"job-1","task_id":"root","type":"job.completed","visibility":"user"},{"kind":"render","event_id":"j1"},
    ]
    return {"cases":["bootstrap_project_binding","host_project_name_binding","ordered_context_and_session_docs","dynamic_skill_precedence","explicit_skill_trigger","route_implementation","route_research_review","sticky_continuation","watch_before_delegation","job_id_propagation","render_barrier","task_completion_not_job_terminal","heartbeat"],"records":records}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("transcript", nargs="?")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()
    if args.self_test:
        result = grade(fixture())
        extra = {
            "resolver_failure": grade({"cases":["resolver_failure"],"records":[{"kind":"action","action":"resolve_project","ok":False}]}),
            "transport_failure_fallback": grade({"cases":["transport_failure_fallback"],"records":[{"kind":"fallback","structured":True,"reported":True,"business_success":False}]}),
            "history_fresh_job_watch": grade({"cases":["watch_before_delegation"],"records":[
                {"kind":"action","action":"watch","job_id":"fresh-job","source":"events__history_fresh_job","watch_established":True,"after_cursor":0,"buffered_event_count":0},
                {"kind":"launch","task_id":"worker","new_worker":True},
            ]}),
        }
        negative = grade({"cases":["unrouted_launch_negative"],"expected_failure":True,"records":[{"kind":"launch","new_worker":True,"routed":False}]})
        missing_route = {
            role: grade({"cases":["route_implementation" if role == "implementation" else "route_research_review"],"records":[{"kind":"launch","task_id":role,"role":role,"new_worker":True,"routed":False}]})
            for role in ("implementation", "research", "review")
        }
        after_launch = grade({"cases":["route_implementation"],"records":[
            {"kind":"launch","task_id":"late","role":"implementation","new_worker":True,"routed":True},
            {"kind":"event","task_id":"late","type":"model.selected","visibility":"user","data":{"model":"m","thinking_effort":"high"}},
        ]})
        sticky = grade({"cases":["sticky_continuation"],"records":[{"kind":"launch","task_id":"sticky","new_worker":False,"sticky":True,"rerouted":False}]})
        watch_after_launch = grade({"cases":["watch_before_delegation"],"records":[
            {"kind":"event","task_id":"impl","type":"model.selected","visibility":"user","data":{"model":"m","thinking_effort":"high"}},
            {"kind":"launch","task_id":"impl","new_worker":True},
            {"kind":"action","action":"watch","job_id":"job-1","source":"events__history_fresh_job","watch_established":True,"after_cursor":1},
        ]})
        nested_bad = grade({"cases":["job_id_propagation"],"records":[
            {"kind":"launch","task_id":"root","new_worker":True,"job_id":"job-a"},
            {"kind":"launch","task_id":"child","new_worker":True,"job_id":"job-b","parent_task_id":"root"},
        ]})
        render_bad = grade({"cases":["render_barrier"],"records":[
            {"kind":"event","event_id":"bad","type":"task.completed","visibility":"user"},
            {"kind":"tool_call","name":"events__wait"},
            {"kind":"render","event_id":"bad"},
        ]})
        result["self_test_extra"] = extra
        result["self_test_negative"] = {"unrouted_launch": negative, "missing_route": missing_route, "after_launch": after_launch, "watch_after_launch": watch_after_launch, "nested_job_mismatch": nested_bad, "tool_before_render": render_bad}
        result["self_test_sticky"] = sticky
        result["ok"] = result["ok"] and all(x["ok"] for x in extra.values()) and negative["ok"] and all(not x["ok"] for x in missing_route.values()) and not after_launch["ok"] and not watch_after_launch["ok"] and not nested_bad["ok"] and not render_bad["ok"] and sticky["ok"]
    elif args.transcript:
        result = grade(json.loads(Path(args.transcript).read_text(encoding="utf-8")))
    else:
        ap.error("provide a transcript or --self-test")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
