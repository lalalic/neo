# Neo Project Recipe: Product Prototype

A lightweight explore → try → discuss → implement → test recipe for mobile Apps and websites.

The real product implementation DAG remains in graph.mmd. This recipe runs INSIDE each existing Agent Task; it is not another DAG, scheduler or Relay execution mode.

| Step | What happens | Continue when |
|---|---|---|
| Prototype | Try a tiny script, sample model, temporary UI, website demo or visible experiment on Neo Master/development host | There is something concrete worth discussing |
| Confirm | Show the result and discuss options or changes; try again as needed | User says the approach is good enough to implement |
| Port | Copy the approach into native App / website code, or provide a secure API for heavyweight operations | The product can execute the feature |
| Product E2E | Exercise the SAME feature through App MCP / NeoUse or the actual website / WebHelm | Real behavior works |
| Ready | Use it as a normal product feature | Follow normal product quality/release rules |

No SHA, Git revision, formal review receipt, validation manifest, or full model acceptance is a prerequisite for this DEVELOPMENT flow. Natural user chat confirmation is sufficient to move from prototype to implementation. Managed Review is optional. An owner request to change direction returns the existing Agent to prototyping. Do not create another job for another attempt.

The optional next-step router is located at recipes/product-prototype/route.mjs:

    node <neo-root>/skills/neo-project/recipes/product-prototype/route.mjs \
      --project /absolute/neo-project --run /absolute/project/runs/2026-11-12-test \
      --agent exact-graph-agent

It reads the Project's graph.mmd plus a small config/product-prototype.json with product kind (mobile/web), QA transport (neouse/webhelm), toolPrefix and optional per-Agent prototype entrypoint. It never starts paid work, runs the prototype, sends review, or invokes the phone. An Agent simply follows its suggested step.

## Minimal optional discussion notes

Private runs/YYYY-MM-DD-example/.product-prototype-gates.json may contain:

    {
      "schemaVersion": 1,
      "agents": {
        "toy3d-builder": {
          "prototype": {"status": "tried", "notes": "Website High looked better"},
          "ownerReview": {"decision": "approved", "notes": "Good direction"},
          "productImplementation": {"status": "working", "target": "service"},
          "productE2E": {"status": "passed", "tool": "toy3d.builder.run", "transport": "neouse"}
        }
      }
    }

These are convenient conversational progress notes, not cryptographic or authoritative approvals. For modifications requested by the user, set ownerReview.decision to changes_requested and record brief feedback. The router sends the Agent back to the prototype. A simple optional positive prototype.iteration number distinguishes major approaches without hashing or Git revision requirements.

Mobile products: prototype on the dev host, port portable logic into the App, keep Blender/GPU/provider services off device behind an API, then exercise the actual App method through NeoUse session and its App MCP QA tool. Websites: build a quick prototype, discuss, implement on the real site and validate by WebHelm interacting with the real UI. Do not create a separate fake QA implementation.

Development flexibility does NOT relax actual paid-provider consent, privacy, publication authorization or production artifact checks. A provider job submission alone does not establish a working finished product, but a quick prototype need not be production-ready to discuss its visual quality.

ToyAlive is one example: it has 11 production-stage Agents and an optional Product Prototype config. No ToyAlive-specific algorithms or personal data belong in the shared Neo recipe.

Run the router tests with node --test skills/neo-project/recipes/product-prototype/route.test.mjs.
