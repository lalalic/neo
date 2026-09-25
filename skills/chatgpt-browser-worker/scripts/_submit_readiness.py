"""Bounded polling helpers for ChatGPT submit readiness."""
from __future__ import annotations

import time
from collections.abc import Callable, Mapping


def wait_until_stable(
    read_state: Callable[[], Mapping[str, object]],
    ready: Callable[[Mapping[str, object]], bool],
    *,
    timeout: float,
    interval: float = 0.25,
    stable_samples: int = 2,
    phase: str,
) -> Mapping[str, object]:
    """Return only after the observable state is ready for stable_samples polls."""
    deadline = time.monotonic() + timeout
    stable = 0
    last_state: Mapping[str, object] = {}
    while time.monotonic() < deadline:
        last_state = read_state()
        if ready(last_state):
            stable += 1
            if stable >= stable_samples:
                return last_state
        else:
            stable = 0
        time.sleep(interval)
    raise RuntimeError(f"Temporary Chat {phase} was not observed ready")


def actionable_temporary_chat_candidates(candidates):
    return [
        candidate for candidate in candidates
        if candidate.get("visible")
        and not candidate.get("disabled")
        and candidate.get("pointerEvents") != "none"
    ]


def temporary_chat_enabled_state(url, candidates):
    """Recognize Temporary Chat from stable URL state with semantic UI fallback."""
    if "temporary-chat=true" in (url or ""):
        return True
    return any(
        "turn off" in f"{candidate.get('label') or ''} {candidate.get('text') or ''}".lower()
        for candidate in candidates
        if candidate.get("visible")
        and not candidate.get("disabled")
        and candidate.get("pointerEvents") != "none"
    )


def prompt_text_matches(observed, expected):
    """Verify long composer/user-turn text despite ProseMirror whitespace reshaping."""
    import re
    normalize = lambda value: re.sub(r"\s+", " ", value or "").strip()
    observed_n = normalize(observed)
    expected_n = normalize(expected)
    if expected_n in observed_n:
        return True
    if not expected_n:
        return not observed_n
    span = min(256, max(48, len(expected_n) // 8))
    return (
        len(observed_n) >= int(len(expected_n) * 0.9)
        and expected_n[:span] in observed_n
        and expected_n[-span:] in observed_n
    )


def submission_receipt(turns, before_count, prompt, composer_text):
    """Return a transport receipt after click without requiring one DOM message shape."""
    for turn in turns[before_count:]:
        if prompt_text_matches(turn.get("text"), prompt):
            return {"verified_by": "user-turn", "turn": turn}
    if not (composer_text or "").strip():
        return {
            "verified_by": "composer-cleared",
            "turn": {"id": None, "text": prompt},
        }
    return None
