#!/usr/bin/env python3
"""Resolve the sole Neo Projects root; Harness assets follow the installed CLI."""
from __future__ import annotations
import json
import os
from pathlib import Path


def load_workspace_config() -> dict[str, object]:
    path = Path(os.environ.get('NEO_WORKSPACE_CONFIG', Path.home() / '.config/neo/workspace.json')).expanduser()
    try:
        config = json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        config = {'schemaVersion': 1, 'neoRoot': str(Path.home() / 'Workspace')}
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f'Cannot read Neo configuration: {exc}') from exc
    if not isinstance(config, dict) or set(config) != {'schemaVersion', 'neoRoot'} or type(config.get('schemaVersion')) is not int or config.get('schemaVersion') != 1:
        raise ValueError(f'Invalid Neo configuration at {path}')
    value = os.environ['NEO_ROOT'] if 'NEO_ROOT' in os.environ else config['neoRoot']
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError('NEO_ROOT must be an absolute path')
    root = Path(value).resolve()
    if not root.is_dir():
        raise ValueError(f'NEO_ROOT is not an accessible directory: {root}')
    harness = Path(__file__).resolve().parents[3]
    return {'schemaVersion': 1, 'neoRoot': root, 'harnessRoot': harness}
