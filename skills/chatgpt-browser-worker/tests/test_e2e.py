import os
import secrets
import subprocess
from pathlib import Path

import pytest


INFER = Path(__file__).resolve().parents[1] / "bin" / "chatgpt-browser-infer"


@pytest.mark.skipif(
    os.environ.get("CHATGPT_BROWSER_E2E") != "1",
    reason="set CHATGPT_BROWSER_E2E=1 to run the authenticated real-browser test",
)
def test_real_browser_reads_fact_number_from_attachment(tmp_path):
    fact_number = str(secrets.randbelow(900_000_000) + 100_000_000)
    attachment = tmp_path / "fact.txt"
    attachment.write_text(f"The fact number is {fact_number}.\n", encoding="utf-8")

    completed = subprocess.run(
        [
            str(INFER),
            "--prompt",
            "Read the attached file and tell me the fact number it contains.",
            "--file",
            str(attachment),
            "--attempts",
            "1",
        ],
        text=True,
        capture_output=True,
        timeout=360,
    )

    assert completed.returncode == 0, completed.stderr or completed.stdout
    assert fact_number in completed.stdout
