import json, time, re

CFG = json.load(open("__CFG_PATH__"))
OP = CFG["operation"]
TARGET_NOTE_ID = CFG.get("note_id")
TARGET_TITLE = CFG.get("title")


def out(payload):
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def resolve_manager_card():
    new_tab("https://creator.xiaohongshu.com/new/note-manager")
    wait_for_load(); time.sleep(2)
    raw = js('Array.from(document.querySelectorAll(".note-card")).map(function(c){var t=c.querySelector(".note-card__title"); return JSON.stringify({title:t?(t.innerText||t.textContent||"").trim():"", impression:c.dataset.impression||"", text:(c.innerText||"").trim()})}).join("\\n")')
    rows=[]
    for line in (raw or "").splitlines():
        try:
            row=json.loads(line)
            imp=json.loads(row.get("impression") or "{}")
            row["note_id"]=(((imp.get("noteTarget") or {}).get("value") or {}).get("noteId"))
            rows.append(row)
        except Exception:
            pass
    for row in rows:
        if TARGET_NOTE_ID and row.get("note_id")==TARGET_NOTE_ID:
            return row
        if TARGET_TITLE and row.get("title")==TARGET_TITLE:
            return row
    return None


def card_exists_in_current_tab(note_id, title):
    return js('Array.from(document.querySelectorAll(".note-card")).some(function(c){var t=c.querySelector(".note-card__title"); var ttl=t?(t.innerText||t.textContent||"").trim():""; var imp=c.dataset.impression||""; return '+json.dumps(bool(note_id))+' ? imp.indexOf('+json.dumps(note_id or "")+')>=0 : ttl==='+json.dumps(title or "")+'}) ? "yes" : "no"') == "yes"


def resolve_status(row):
    for label,status in [("审核中","reviewing"),("未通过","rejected"),("已发布","published")]:
        clicked=js('var es=Array.from(document.querySelectorAll("*")).filter(function(e){return e.children.length===0 && e.offsetParent && (e.innerText||e.textContent||"").trim()==='+json.dumps(label)+'}); if(es.length){es[0].click();"yes"}else{"no"}')
        if clicked=="yes":
            time.sleep(1.2)
            if card_exists_in_current_tab(row.get("note_id"), row.get("title")):
                return status,label
    return "unknown","unknown"


def own_profile_url():
    new_tab("https://www.xiaohongshu.com")
    time.sleep(3)
    href=js('var a=Array.from(document.querySelectorAll("a[href*=\\"/user/profile/\\"]")).find(function(a){return (a.innerText||a.textContent||"").trim()==="我"}); a?a.href:""')
    return href or None


def open_post_detail(note_id):
    profile=own_profile_url()
    if not profile:
        return None, "own_profile_not_found"
    goto_url(profile); time.sleep(3)
    selector='section.note-item[data-note-id="'+note_id+'"]'
    href=""
    for _ in range(30):
        href=js('var e=document.querySelector('+json.dumps(selector)+' ); var a=e&&e.querySelector("a.cover,a.title"); a?a.href:""')
        if href:
            break
        js('window.scrollBy(0, Math.max(window.innerHeight*0.85, 600)); "scrolled"')
        time.sleep(.6)
    if not href:
        return None, "post_not_visible_in_my_posts"
    # The My Posts card carries the live xsec token. Following that route opens the
    # post detail overlay/page; raw /explore/<id> URLs can 404 without this token.
    goto_url(href); time.sleep(3)
    ready=js('document.querySelector(".note-container") ? "yes" : "no"')
    if ready!="yes":
        return None, "post_detail_not_opened"
    return {"profile_url":profile,"detail_url":page_info()["url"]}, None


def expand_replies():
    for _ in range(8):
        n=js('var es=Array.from(document.querySelectorAll(".comments-el *")).filter(function(e){var t=(e.innerText||e.textContent||"").trim(); return e.offsetParent && e.children.length===0 && (/^展开\\s*\\d+\\s*条回复$/.test(t) || t==="展开更多回复" || t==="展开更多")}); es.slice(0,20).forEach(function(e){e.click()}); es.length')
        try:
            count=int(n or 0)
        except Exception:
            count=0
        if count<=0:
            break
        time.sleep(.8)


def detail_comments(limit):
    expand_replies()
    raw=js('Array.from(document.querySelectorAll(".comment-item")).map(function(c,i){var author=c.querySelector(".author .name"); var content=c.querySelector(".content .note-text"); var date=c.querySelector(".date > span:first-child"); var loc=c.querySelector(".date .location"); var reply=c.querySelector(".reply .count"); return JSON.stringify({dom_index:i,comment_id:(c.id||"").replace(/^comment-/,""),author:author?(author.innerText||author.textContent||"").trim():"",text:content?(content.innerText||content.textContent||"").trim():"",date:date?(date.innerText||date.textContent||"").trim():"",location:loc?(loc.innerText||loc.textContent||"").trim():"",is_reply:c.classList.contains("comment-item-sub"),reply_label:reply?(reply.innerText||reply.textContent||"").trim():"",replyable:!!c.querySelector(".reply")})}).join("\\n")')
    rows=[]
    for line in (raw or "").splitlines():
        try:
            row=json.loads(line)
            row["comment_index"]=len(rows)
            rows.append(row)
            if len(rows)>=limit:
                break
        except Exception:
            pass
    return rows


def activate_composer_for_comment():
    # Top-level composer is present but inert until the visible "评论" affordance is clicked.
    active=js('var e=document.querySelector("p.content-input[contenteditable=true]"); e&&e.offsetParent ? "yes" : "no"')
    if active=="yes":
        return True
    clicked=js('var e=document.querySelector(".content-edit .inner-when-not-active, .content-edit .inner"); if(e){e.click();"yes"}else{"no"}')
    if clicked!="yes":
        return False
    time.sleep(.4)
    return js('var e=document.querySelector("p.content-input[contenteditable=true]"); e&&e.offsetParent ? "yes" : "no"')=="yes"


def type_and_send(text):
    focused=js('var e=document.querySelector("p.content-input[contenteditable=true]"); if(e&&e.offsetParent){e.focus();e.click();"yes"}else{"no"}')
    if focused!="yes":
        return False,"comment_editor_missing"
    type_text(text)
    time.sleep(.2)
    sent=js('var b=document.querySelector("button.btn.submit,button.submit"); if(b && b.offsetParent && !b.disabled){b.click();"yes"}else{"no"}')
    if sent!="yes":
        return False,"comment_submit_missing_or_disabled"
    time.sleep(1.5)
    return True,None


row=resolve_manager_card()
if not row:
    out({"ok":False,"operation":OP,"error":"post_not_found","note_id":TARGET_NOTE_ID,"title":TARGET_TITLE})
    raise SystemExit(2)

if OP=="status":
    status,label=resolve_status(row)
    out({"ok":True,"operation":"status","note_id":row.get("note_id"),"title":row.get("title"),"status":status,"status_label":label,"card_text":row.get("text")})
    raise SystemExit(0)

route,err=open_post_detail(row.get("note_id"))
if err:
    out({"ok":False,"operation":OP,"error":err,"note_id":row.get("note_id"),"title":row.get("title")})
    raise SystemExit(6)

if OP=="comments":
    rows=detail_comments(int(CFG.get("limit",50)))
    out({"ok":True,"operation":"comments","note_id":row.get("note_id"),"title":row.get("title"),"source":"my_posts_detail","detail_url":route["detail_url"],"count":len(rows),"comments":rows})
    raise SystemExit(0)

if OP=="comment":
    if not activate_composer_for_comment():
        out({"ok":False,"operation":"comment","error":"comment_editor_missing"}); raise SystemExit(5)
    ok,send_err=type_and_send(CFG["text"])
    if not ok:
        out({"ok":False,"operation":"comment","error":send_err}); raise SystemExit(5)
    verified=js('Array.from(document.querySelectorAll(".comment-item .content .note-text")).some(function(e){return (e.innerText||e.textContent||"").trim()==='+json.dumps(CFG["text"])+ '}) ? "yes" : "no"')=="yes"
    out({"ok":verified,"operation":"comment","note_id":row.get("note_id"),"title":row.get("title"),"text":CFG["text"],"verified":verified})
    raise SystemExit(0 if verified else 7)

if OP=="reply":
    rows=detail_comments(200)
    target=None
    if CFG.get("comment_id"):
        target=next((r for r in rows if r.get("comment_id")==CFG["comment_id"]),None)
    elif CFG.get("comment_index") is not None:
        idx=int(CFG["comment_index"]); target=next((r for r in rows if r["comment_index"]==idx),None)
    else:
        needle=CFG.get("contains") or ""
        matches=[r for r in rows if needle in (r.get("text") or "")]
        if len(matches)==1: target=matches[0]
        elif len(matches)>1:
            out({"ok":False,"operation":"reply","error":"ambiguous_comment_match","matches":len(matches)}); raise SystemExit(3)
    if not target:
        out({"ok":False,"operation":"reply","error":"comment_not_found"}); raise SystemExit(2)
    if not target.get("replyable"):
        out({"ok":False,"operation":"reply","error":"comment_not_replyable","comment":target}); raise SystemExit(4)
    cid=target.get("comment_id")
    opened=js('var c=document.getElementById('+json.dumps("comment-"+(cid or ""))+'); var r=c&&c.querySelector(".reply"); if(r){r.click();"yes"}else{"no"}')
    if opened!="yes":
        out({"ok":False,"operation":"reply","error":"reply_ui_missing"}); raise SystemExit(5)
    time.sleep(.4)
    ok,send_err=type_and_send(CFG["text"])
    if not ok:
        out({"ok":False,"operation":"reply","error":send_err}); raise SystemExit(5)
    verified=js('Array.from(document.querySelectorAll(".comment-item .content .note-text")).some(function(e){return (e.innerText||e.textContent||"").trim()==='+json.dumps(CFG["text"])+ '}) ? "yes" : "no"')=="yes"
    out({"ok":verified,"operation":"reply","note_id":row.get("note_id"),"title":row.get("title"),"replied_to":target,"text":CFG["text"],"verified":verified})
    raise SystemExit(0 if verified else 7)

out({"ok":False,"error":"unsupported_operation","operation":OP})
raise SystemExit(2)
