# Episode 001 录制与素材计划

本集要证明的是当前真实实现：Web ChatGPT 通过 bootstrap 约定，经
MacDevBridge 动态发现本地 Skills，只加载匹配的 `SKILL.md`，然后执行真实
本地任务。不能用旧的 Google Drive/static index 方案冒充当前实现。

| Shot / asset ID | Purpose | Screen or camera source / exact action | Spoken Chinese line or narration intent | Presenter state | Approx. duration | Priority |
| --- | --- | --- | --- | --- | --- | --- |
| `01-web-chat-gap` | 建立差距 | **REQUIRED RECORDING. Browser + safe local context:** 展示一个新的 Web ChatGPT 会话，再切到本地 `skills/` / `~/.agents/skills/` 目录或终端列表。重点是“这些本地能力不会因为新建会话自动出现”，不要试图用 UI 证明不可见的内部状态。 | “我本地已经有一套 Skills，但新开的 Web ChatGPT 会话并不会自己扫描这些目录。” | 开头可隐藏；进入解释后右下角 show。 | 6s | Essential |
| `02-bootstrap-contract` | 展示最小 bootstrap | **REQUIRED RECORDING. Editor/terminal:** 打开真实 `web-chatgpt-skills.md`，只高亮 bootstrap workflow：MacDevBridge、本地 discovery script、按需加载、`#skill-name`。避免展示无关私人内容。 | “我没有把所有 Skill 塞进 prompt，只给 Web ChatGPT 一份很小的 bootstrap：先发现，再按需加载。” | show；遮挡关键行时 fade。 | 8s | Essential |
| `03-dynamic-discovery` | 证明 discovery 是动态的 | **REQUIRED RECORDING. Terminal:** 在 Neo repo 运行 `.bin/list-web-chatgpt-skills`，滚动少量输出，停在 `markcut` / `devmacbridge` / `events-bus` 等真实条目。 | “这个脚本每次从真实目录动态扫描，只返回 name、description 和 SKILL.md 的绝对路径。” | hide/fade，保证 terminal 可读。 | 8s | Essential |
| `04-select-and-load` | 证明不会加载整个库 | **REQUIRED RECORDING. Terminal/editor:** 从 discovery 输出选一个与任务相关的 skill，例如 `markcut`；随后打开对应的 `SKILL.md`。画面明确显示只加载匹配项，而不是所有 Skills。 | “任务匹配到哪个 Skill，就只读那个 Skill 的约定。” | show → 打开文件时 fade。 | 8s | Essential |
| `05-explicit-trigger` | 展示用户 override | **REQUIRED RECORDING. Browser or sanitized text demo:** 展示 `#markcut` 或另一个真实 `#skill-name` 触发方式，以及它优先于自动匹配的规则。若浏览器画面不适合公开，可用真实 bootstrap 文档中的该行作为静态证据。 | “我也保留了一个显式入口：`#skill-name`，需要时我可以直接指定。” | show。 | 4s | Optional |
| `06-local-execution` | 给出端到端 payoff | **REQUIRED RECORDING. Web ChatGPT + terminal/local result:** 选择一个安全、短小的本地任务，让 Web ChatGPT 通过 MacDevBridge 执行，并停在可观察结果。可以使用本集自己的 `markcut verify` / repo 文件变更作为递归例子。 | “发现 Skill 不是终点。真正的价值是它随后可以通过 MacDevBridge 把任务落到我的 Mac 上。” | 重要 UI 时 hide；结果出现后 return。 | 10s | Essential |
| `07-recursive-payoff` | 让本集本身成为证据 | **REQUIRED RECORDING. Terminal/editor:** 展示 `neo-build-log/episodes/001/`、本集 `episode.md`、`RECORDING_PLAN.md`，以及成功的 `markcut verify` 输出。 | “最有意思的是，这第一集本身就在用这套 workflow 被制作出来。” | show lower-right。 | 6s | Essential |
| `presenter-circle` | 系列 presenter 素材 | **Camera / NeoX:** 录制干净的 presenter head-and-shoulders take，供右下圆形 overlay 使用；不替代屏幕证据。 | 用于 hook、取舍、payoff 的短句，可后期切分。 | NeoX camera capture。 | 12–18s | Essential |
| `discovery-flow-overlay` | 支持抽象流程 | **Overlay:** `bootstrap → discover → select → load one skill → execute`。只作为解释层，不代替真实录屏。 | 一句话总结流程。 | show when it does not cover evidence. | 3–5s | Optional |

## Capture notes

- 此文件是完整录制清单。桌面录屏/截图由 Capture Agent 在 Mac 上执行；真人/Presenter 镜头同时生成到 `capture-tour.json` 并交给 NeoX。
- 每个 Essential desktop shot 都必须来自当前真实实现；旧的 static skills index / Google Drive registry 不能作为当前方案的证明。
- Web ChatGPT 画面若包含私人 chat、账号、插件状态或其他敏感信息，应重新构造安全演示，而不是后期模糊大量区域。
- 对 terminal/code 录屏使用可读字号；命令和关键输出必须能在手机竖屏成片里读清。
- `06-local-execution` 必须以可观察结果结束，不能只停在“调用了工具”。

## Capture outputs

- Desktop/screenshot items: Capture Agent 保存到 `assets/`，文件名保留 stable shot ID。
- Human/presenter items: NeoX executable subset in `capture-tour.json`.
- Actual acceptance/privacy/quality/editorial mapping: `CAPTURE_REVIEW.md`.
- Essential capture 未通过 review gate 前，不进入 final Markcut preview/render。
