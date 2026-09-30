prompt = CFG["prompt"]
_new_owned_tab(temporary_chat_entry_url(prompt))
wait_for_load()

_click_temporary_chat_toggle()
deadline = time.time() + 20
while time.time() < deadline:
    if _temporary_chat_enabled():
        break
    time.sleep(.25)
else:
    raise RuntimeError("Temporary Chat activation was not observed")

result = _submit_current_page(prompt, temporary=True, mode_label="Temporary Chat")
print(json.dumps(result, ensure_ascii=False), flush=True)
_wait_for_release()
