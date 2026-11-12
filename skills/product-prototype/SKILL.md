---
name: product-prototype
description: Quickly prototype a mobile App or website capability, discuss and revise, then move the confirmed approach into native code or a service API and test the real product through App MCP or WebHelm.
---

# Product Prototype

Goal: try something quickly and discuss the result. This is an exploratory developer recipe, not a heavyweight validation or release workflow.

Read the shared Recipe at ../neo-project/recipes/product-prototype.md. Continue using the one project implementation DAG in graph.mmd and the ordinary Relay Task.

1. Prototype first. Try a small script, temporary webpage, Blender sample, model API call, screenshot or quick UI. No SHA, commit, formal benchmarking or mandatory Review before the first try.
2. Discuss. Show what worked, take user feedback and iterate. Natural messages such as "looks good, implement it" count as direction confirmation. If user wants changes, return to the prototype.
3. Implement. After confirmation, copy the behavior into the real native App or website when possible; for heavy or nonportable operations, provide an authenticated service API.
4. Product E2E. Verify the same feature through the product's QA interface. Mobile uses NeoUse/App MCP, websites use WebHelm. Real UI and QA tool must use the same code, not mock or shadow implementations.

Optional read-only development router:

    node <neo-root>/skills/neo-project/recipes/product-prototype/route.mjs \
      --project PROJECT_ROOT --run RUN_PATH --agent AGENT_FROM_GRAPH

Missing optional notes mean start with the prototype. Save only brief discussion progress in the ignored Run file .product-prototype-gates.json. Never use development notes to authorize paid calls, photo upload or public release. A product's production media/QA checks remain separate.
