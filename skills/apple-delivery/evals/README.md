# Apple Delivery capability/eval matrix

| User outcome | Positive check | Negative/boundary check |
| --- | --- | --- |
| Reuse identity without Xcode GUI login | Apple App ID/bundle match; ES256 signing shape; target-specific config | Insecure private key permissions; cross-origin API pagination |
| Build right app, avoid reused number | plist and XcodeGen YAML versions, monotonic bump, archived bundle identity | stale build; wrong archive identity; dry-run source mutation |
| Reuse reviewed compliance truthfully | Info.plist boolean matches project; readback after Apple PATCH | Missing Compliance left pending without explicit action; conflicting classification rejected; legacy archive distinguished |
| Internal beta is not merely uploaded | processing state, group linkage, beta readback | `PROCESSING` never marked ready; missing group stays pending |
| Preserve one shared implementation | Neox/ToyAlive wrappers resolve the `apple-delivery` Skill and project configs | no copy of engine in either project; unavailable skill yields clear error |
| Human final gate | Skill requires real TestFlight web + phone verification | no claim based on `VALID` alone |

Executable deterministic checks: `python3 -m unittest discover -s skills/apple-delivery/tests -v`. Behavioral agent evaluation is a review checklist and not misrepresented as an executed model-based eval.
