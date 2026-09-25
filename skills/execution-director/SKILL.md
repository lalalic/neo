---
name: execution-director
description: Turn Video Director semantic shot intent into stable executable contracts for Demo Agent.
---

# Execution Director

The Execution Director is the contract boundary between the Video Director and
the Demo Agent. It preserves the requested product story while adding the
runtime-independent facts and recovery boundaries needed to execute a shot.

It consumes a `video-director-plan-v1` scene and emits an
`execution-director-plan-v1` document. The output identifies the product,
surface, and feature; states the visible evidence that must be observed from a
fresh UI; carries editorial presentation metadata; and defines what recovery
and autonomy are allowed.

The contract deliberately excludes selectors, coordinates, click/keypress
sequences, and tool-specific navigation. The Demo Agent chooses the runtime
tool and navigation strategy, then returns fresh-UI and artifact evidence.

Use `scripts/contract.py` for pure validation and conversion. It has no browser,
recorder, Markcut, or network dependency.

```sh
python skills/execution-director/scripts/contract.py skills/execution-director/examples/product-demo.json
python -m unittest discover -s skills/execution-director/tests -p 'test_*.py'
```

