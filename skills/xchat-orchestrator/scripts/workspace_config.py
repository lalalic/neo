#!/usr/bin/env python3
"""Read the shared Neo Workspace Root configuration."""
from __future__ import annotations

import json
import os
from pathlib import Path


def load_workspace_config() -> dict[str, object]:
    path = Path(os.environ.get("NEO_WORKSPACE_CONFIG", Path.home() / ".config/neo/workspace.json")).expanduser()
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        root = (Path.home() / "Workspace").resolve()
        return {"schemaVersion": 1, "workspaceRoot": root, "neoRoot": root / "neo"}
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read workspace configuration: {exc}") from exc
    if not isinstance(config, dict):
        raise ValueError(f"Invalid workspace configuration at {path}")
    root_value = config.get("workspaceRoot")
    if config.get("schemaVersion") != 1 or not isinstance(root_value, str) or not Path(root_value).is_absolute():
        raise ValueError(f"Invalid workspace configuration at {path}")
    root = Path(root_value).resolve()
    if not root.is_dir():
        raise ValueError(f"Configured Workspace Root is not an accessible directory: {root}")
    return {"schemaVersion": 1, "workspaceRoot": root, "neoRoot": root / "neo"}
