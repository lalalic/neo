---
name: demo-agent
description: Execute one item from execution/demo.json against the real product, using the shared demo skill and the product .demo inventory, and return fresh-UI recording/evidence.
---

# Demo Agent

Input is one **demo execution lane item** plus runtime policy. There is no separate demo plan or demo script contract.

The agent:
1. reads the item's semantic intent, required visible evidence, success criteria, presentation, and output path;
2. loads the shared `demo` skill;
3. reads `<product>/.demo/inventory.md` and only the fixtures/scenarios/scripts needed for this item;
4. chooses runtime navigation and recovery using allowed tools;
5. records/captures the real product state and verifies fresh UI evidence;
6. writes the requested media asset and execution evidence.

Execution Director must not put selectors or fixed automation sequences in the item. Those are resolved at runtime from the product demo inventory and live UI.
