# MV3 内 Agent Harness 复用研究

日期：2026-10-18。范围：仅官方文档、官方源码；未访问 beehelper 业务代码，未在 beehelper 安装依赖或开发功能。外部 agent 桥接与 PWA 由主 agent 另行研究，本文不重复。

## 结论

**浏览器内的成熟基础 agent loop 可行；完整 coding harness 不能据此认定可低成本移植。** Nanobrowser 是 MV3 内模型调用、浏览器工具、观察和继续循环的一手案例；DeepSeek Harness（下称 dsh）甚至已有真实浏览器 Worker hosting，但其现有动态模块加载机制不符合 MV3 特权页面/Worker 的 CSP。[N1][D4][C1]

**建议优先级：**已有完整 coding harness 诉求时，优先采用主 agent 研究的外部连接路线；必须浏览器内运行时，复用成熟 loop，并将微应用源码存储、patch、预览执行、验证和恢复定义为独立工具/provider。保留 everything-is-a-plugin 思路，但不要把 Cordis core、dsh 完整产品和浏览器执行层当成同一件东西。此为基于下述边界的工程判断，不是已完成移植的结论。

**不推荐直接把 dsh Worker preview 当作 beehelper 的现成 MV3 coding runtime。** 它证明浏览器 hosting 已被上游认真实现，避免了“只能 Node 跑”的误判；但不能证明支持任意 npm/Node 程序、动态插件安装、任意构建测试或 MV3 原样部署。[D4][D5][C1]

## 证据与层次

源码快照：dsh `687f282e8625c6b8d11ff58211a90524be2e4317`，提交时间 2026-10-17；Cordis 上游 `df4431eb43086bd1f8263a0e8c03e9b7c5233b68`，提交时间 2026-10-16；Nanobrowser `f1e912d7c9e859eec6638702be920c78a8eff0ea`，提交时间 2026-10-15。均为本轮官方仓库 shallow clone 所得固定快照，不代表未来版本。

| 层次 | 应承担什么 | 本轮证据 |
|---|---|---|
| Agent loop | 模型 streaming、工具调度、结果回填、继续/停止/取消 | dsh agent-loop、Nanobrowser loop 已有实现。[D2][N2] |
| Coding harness | loop 之外的工程文件、执行环境、上下文、权限、恢复、验证配套 | dsh 多组插件共同组成；不是导入一个 loop 包就全部拥有。[D1][D3][D8] |
| 浏览器工具执行层 | 页面观察、ref、点击输入、截图、导航及回执 | Nanobrowser browser-control；dsh browser-use provider 是另一种集成。[N3][D9] |
| 插件容器 | 注入、服务作用域、事件、生命周期、清理 | Cordis core；它本身不调用模型或提供 coding loop。[K1][K2] |

这里“已有基础 loop”不等于“已有可零改动放入 beehelper 的 npm 组合”；尤其不能将仓库的开发者 build/test scripts 当作 agent 已拥有的工具。[N4]

## DeepSeek Harness

### 模块与 Node 边界

dsh 官方架构将模型、工具、会话、agent loop 都定义为可替换插件；core 内再拆 `scope/session/system-prompt/tools/agent/agent-loop`。`agent` 是公共契约，`agent-loop` 是具体驱动，扩展依赖前者。适合作为 everything-is-a-plugin 参考，而非必须照搬全部产品组合。[D1]

`agent-loop` 不是无依赖浏览器函数：manifest 声明 Cordis、agent、LLM、scope、session、persistence、projection、system-prompt、tools 等 peer；自身还有 Schemastery、Zod 等依赖。根项目 Node engine 为 `^22.19.0 || >=24.0.0`。[D3]

| 模块 | 已见运行时依赖 | 移植影响 |
|---|---|---|
| `core/agent/src/index.ts:10–11,248–249` | `node:async_hooks` 的 AsyncLocalStorage、`node:util/types` | 不是简单替换 UUID；需维持异步 initiator 作用域语义。[D6] |
| `core/agent-loop/src/index.ts:10`、`core/session/src/index.ts:10` | `node:crypto`、`node:path` | 需要浏览器替代或适配，不能仅凭 TS 判断兼容。[D6] |
| `session-persistence-jsonl/src/index.ts:16–21` | fs/promises、path、perf_hooks、timers、crypto | IndexedDB 不能直接作为 JSONL provider 的无行为差异替代。[D7] |
| `subprocess-local/src/spawn.ts:11–13`、`fs-local/src/index.ts:8–12` | child_process、stream、chokidar、path | 本地 shell、文件监控等 provider 不能原样在 MV3 执行。[D7] |

### Private Browser WebWorker Preview：已有真实能力

`docs/architecture.md:43–45` 明确提及 private browser WebWorker preview，并将它与受支持 Node launcher 区分。不能漏掉这个一手线索，也不能把 private/experimental preview 当作稳定浏览器产品承诺。[D4]

runtime 文档与源码显示：专用 Worker 装载打包 VFS 镜像，通过自有 CommonJS wrapper loader 启动 harness 插件树；提供 Node builtin proxy、process shim、内存文件系统与 postMessage HTTP tunnel。`./worker` 和 `./client` 是公开包入口，但部署还要单独提供镜像。[D4][D5]

其 shell 不是纯假接口：`spawn` 会启动子 Web Worker，运行内置命令和 VFS 操作，支持终止；但不是原生进程或完整 Bash。没有 git/网络工具，不支持循环、函数等完整 shell 语法。**因此可称“浏览器 hosting + 有限执行设施”，不可称“任意 coding 工程运行环境”。**[D5]

已明确的限制包括：不能运行 pnpm/安装插件和 native dependencies；PTC Node 程序不可执行；`node:vm/net/sqlite/worker_threads` 等为拒绝调用的 stub；pi-ai 推理入口被替换为拒绝调用的实现；HMR 可应用配置，但不替换已加载模块。这里的 pi-ai 限制是 dsh 镜像的替换策略，不能反推 Pi 上游一定不支持浏览器。[D5]

源码 loader `module-loader.ts:398–401` 用 `new Function` 编译镜像模块；client 通过 Blob 执行加载的 bundle；动态 Cordis client runner 也使用 `new Function`。MV3 extension pages CSP 同时覆盖页面和 Worker，不允许加入 `unsafe-eval`。因此现成 preview **不能原样运行于特权扩展上下文**。[D10][C1]

可考虑静态预打包、移除表达式 loader，或分离 sandbox 与特权工具 RPC，但这是待设计的移植工作。官方 sandbox 页面不能直接访问扩展 API；不是通过配置一项 CSP 就保留原有权限模型。下载执行插件还需单独核查远程代码规则，不能承诺商店审核结果。[C1][C3]

**独立 Web/PWA Worker 是另一条候选，不能与“原样放进 MV3”一并否定。**普通 Web 可采用自己的 CSP，可能保留现有模块求值机制，再由扩展提供浏览器操作；价值来自 Web 执行上下文而非 PWA 安装。dsh 文档明确 preview 可以在无 Node host 的情况下运行打包插件树，但本轮没有验证真实模型调用、微应用改码运行或扩展工具往返。对以 JS 微应用为主的 BeeHelper，缺少原生 Bash/npm 不必然是阻断条件；是否足够必须围绕实际创作闭环验证，不能按“完整 Node 环境”标准直接淘汰。[D4][D5][C1][C4]

### 会话、Stream、取消、压缩

agent-loop 已支持 create/resume、streamed response、工具调度、持久事件；取消是合作式 AbortSignal，保留已展示文本，不能撤销已产生的副作用。无 persistence backend 时仍能运行，但会话只在内存。[D2]

persistence 有独立 contract：append-only、单 writer、flush durability barrier；恢复时为中断轮次补闭合事件，不是从半次模型调用或半个工具动作精确续跑。官方还列出 root shutdown 最终 `turn/end` 可能未持久化，以及 loop 无内置 turn budget 等限制。[D2][D8]

上下文压缩是 `compaction-basic` 等插件提供的额外能力：按 token 压力总结旧历史、保留近期消息、处理确认的 overflow；总结需额外模型请求，不能压缩系统提示、工具定义或不可分割的超大单元。不是所有自选最小 loop 组合自动包含。[D11]

## Cordis：可复用 Core，不等于可复用 Loader

Cordis 上游 core 提供 `Context/Service/Fiber`、注入、事件与生命周期；loader/include 是独立包。上游 loader 有 `node:module/fs/path` 和 `new Function/eval`，include 有 fs/path；不可将“core 可 browser bundle”扩大成“整套配置驱动插件系统 MV3 兼容”。[K1][K2]

dsh 使用 `@deepseek-ai/cordis` 等 vendored fork，官方记录了 rescope、生命周期加固、volatile config 等本地修改；与上游 `cordis` 并非可直接替换的同一版本/API 保证。[K3]

**本轮轻量验证已通过：**仅 dsh vendored Cordis core + vendored Cosmokit，用 esbuild `--platform=browser --format=esm` bundle；16 个输入，69,510 bytes，无外部 import。随后在 Node VM 的无 Node 全局、禁止字符串代码生成环境中，验证 `Context`、插件挂载和 effect 清理/销毁成功。未验证依赖注入全部路径、真实浏览器/MV3、loader、dsh 完整组合；不能把此结果写成扩展端到端成功。

建议将受信任内置插件静态打包、程序化挂载到 Cordis core；不要默认保留运行时 npm 安装和任意代码热加载。微应用源码与拥有扩展权限的 harness 插件应有不同信任边界。此为设计建议，未实现。

## Pi：浏览器基础 Loop 的明确候选

主 agent 补核对官方快照 `482c1381a00d8d00bc81697e4a980c593db6803e`（2026-10-18）。该快照 `packages/agent/package.json` 的实际包名是 `@earendil-works/pi-agent-core`，版本 `1.3.0`，依赖对应版本的 `@earendil-works/pi-ai` 与 TypeBox；许可证为 MIT。不要照搬旧资料中的 npm scope。[P1][P4]

`pi-ai` 官方 README 明确支持浏览器，core 和 provider factory 可按需打包；浏览器需显式提供凭据或凭据存储，Bedrock 调用和 OAuth 登录不支持纯浏览器，相关场景需要外部服务。该说明是上游浏览器支持声明，不是本项目 MV3/provider 兼容性实测。[P2]

`pi-agent-core` 提供状态、stream、工具执行循环、取消、steering/follow-up、`transformContext` 等钩子，README 还给出 browser app 经后端 proxy 的方式。主 agent 读取了 `agent.ts`、`agent-loop.ts` 及 `pi-ai/src/index.ts`；这几个入口没有直接引入 Node builtin，但未完整验证传递依赖及构建产物。[P1][P3]

**可以优先用于内置基础 agent 的小型验证，而不必从零写循环。**不过 `transformContext` 是压缩/裁剪的扩展点，不等于自动拥有持久会话、恢复、完整 coding 工作区和验证设施；源码 patch、运行与观测仍需 BeeHelper 提供。不能把 Pi coding agent 的能力整体归入 agent-core。[P1][P3]

旧候选 `packages/web-ui` 在本轮固定快照的官方 `packages` 列表中不存在，因此没有将旧 web-ui 视为当前可安装 UI 方案；完整 Pi coding agent 的移植也未验证。[P5] 本轮未安装、bundle、调用模型或加载真实扩展；基础 loop 可以复用的源码证据成立，“低成本完成整个 AI coding 工作台”仍未证实。

## Nanobrowser：MV3 原生一手案例

固定快照已经是 v0.3 单 agent loop，不应沿用旧版多 agent 描述。循环执行 steering、浏览器观察、上下文整理/压缩、模型 streaming、工具批次和继续/结束；read 可并行，修改动作有序，并有重复、连续错误等 guards。[N1][N2]

浏览器执行链为 `AgentLoop → LayerPort → Session/Controller → Puppeteer ExtensionTransport → chrome.debugger/CDP`。使用浏览器侧 Puppeteer 入口，不是 Node Puppeteer server；AX tree/DOMSnapshot 提供观察，ref 绑定文档，过期后要求重观察。[N3]

worker 管理 conversation；IndexedDB 保存会话/entries/run records，UI journal 支持增量与重连。Stop 使用 AbortController；已下发动作不能回滚。worker 重启不会自动继续模型或重放工具，未知修改标为 delivery unknown，旧 ref 失效，等待用户继续。[N5]

压缩已有实现：旧页面 payload stub、action ledger 加模型总结、缩短工具结果，仍超预算则停止。但产品工具目录没有工程源码 patch、shell、build/test；`save_file` 是生成下载内容，不是项目工作区。`eval/devtools` 不向产品 agent 提供。**推荐作为浏览器执行层与运行恢复参考，不推荐直接当 coding harness。**[N4][N6]

运行依赖包括 AI SDK、模型 provider、puppeteer-core、idb；工具链声明 Node `>=24.11.0`。本轮只读源码，未构建、未运行单测、未在 Chrome/真实模型上验收；Puppeteer internal imports 和 debugger/host permissions 是集成与升级风险。[N7]

## 许可证与决策门槛

| 项目 | 本轮核实 | 决策 |
|---|---|---|
| dsh | MIT；vendored LICENSE 保留，第三方另有 notices。[L1][K3] | 架构参考推荐；完整 Worker preview 原样 MV3 移植淘汰，成本高。 |
| Cordis | 上游 core/loader manifest 为 MIT，dsh fork 亦 MIT。[K1][K3] | 推荐评估 core 静态插件容器；不采用现成 Node/eval loader。 |
| Nanobrowser | Apache-2.0；未做全传递依赖许可证审计。[L2] | 推荐执行层参考；作为完整 coding harness 淘汰。 |
| Pi agent-core / pi-ai | 固定快照 manifest 与 MIT 已核实；官方明确 pi-ai 浏览器支持。[P1][P2][P4] | 内置基础 loop 优先验证候选；未完成 MV3 构建与完整 coding harness 验收。 |

浏览器内路线至少还须证明：源码 patch 的版本/冲突处理、隔离预览执行、可观察验证结果、取消后的未知副作用处理、Worker 重启恢复、真实 provider streaming/CORS/凭证边界。只把模型回复接到几个工具上，不能满足这些 coding harness 验收项。Chrome 明确要求为 Worker 意外终止做持久化设计；debugger 活跃可延长生命周期，但不能替代恢复设计。[C2]

实际执行范围：官方源码 shallow clone/read-only 检查；dsh/Cordis 临时 clone 工作树无修改；仅上述 Cordis 小型 bundle/VM smoke。未安装完整项目依赖、未完整构建 dsh/Nanobrowser、未做扩展加载或真实模型请求。所有“推荐/成本”均为源码证据推导，不是生产性能、安全认证或工期估算。

## 官方引用

- [D1] dsh 模块/架构：[packages/core/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/README.md)、[docs/architecture.md](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.md)。
- [D2] loop 生命周期及限制：[packages/core/agent-loop/README.md:12,59–75,114–130,215–220](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/README.md#L59-L130)。
- [D3] 依赖：[agent-loop/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/package.json)、[根 package.json:9](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/package.json#L9)。
- [D4] preview 定位：[architecture.md:43–45](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/architecture.md#L43-L45)、[webworker-runtime/README.md:12–36](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/README.md#L12-L36)。
- [D5] preview 限制：[webworker-runtime/README.md:55–73](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/README.md#L55-L73)；源码表：[src/module-proxies.ts:23–91](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/src/module-proxies.ts#L23-L91)。
- [D6] core Node 依赖：[agent/src/index.ts:8–17,248–249](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent/src/index.ts#L8-L17)、[agent-loop/src/index.ts:10](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/agent-loop/src/index.ts#L10)、[session/src/index.ts:10](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/index.ts#L10)。
- [D7] providers：[session-persistence-jsonl/src/index.ts:16–21](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence-jsonl/src/index.ts#L16-L21)、[subprocess-local/src/spawn.ts:11–13](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/subprocess/subprocess-local/src/spawn.ts#L11-L13)、[fs-local/src/index.ts:8–12](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/fs/fs-local/src/index.ts#L8-L12)。
- [D8] persistence contract/恢复：[session-persistence/README.md:28–67,150–155](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence/README.md#L28-L67)；最小 coding 组合仍含 shell/FS/compaction：[sdk-minimal/README.md:12,51](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/sdk-minimal/README.md#L51)。
- [D9] 浏览器 provider 的 Node 启动及状态边界：[browser-use-playwright-mcp/README.md:60–62,100–105](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/browser-use-playwright-mcp/README.md#L60-L62)。
- [D10] 动态求值：[module-loader.ts:398–401](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/src/module-system/module-loader.ts#L398-L401)、[client.ts:383](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/webworker-runtime/src/client/client.ts#L383)、[evaluator.ts:180](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/extensions/cordis-client-runner/src/client/evaluator.ts#L180)。
- [D11] 上下文压缩：[compaction-basic/README.md:12,28–32,80–90,113–119](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/README.md#L80-L119)。
- [K1] 上游 Cordis：[core/package.json](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/core/package.json)、[core/src/index.ts](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/core/src/index.ts)。
- [K2] 上游非 core 依赖：[loader/src/internal.ts](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/loader/src/internal.ts)、[loader/src/resolve.ts](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/loader/src/resolve.ts)、[loader/src/config/utils.ts](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/loader/src/config/utils.ts)、[include/src/index.ts](https://github.com/cordiverse/cordis/blob/df4431eb43086bd1f8263a0e8c03e9b7c5233b68/packages/include/src/index.ts)。
- [K3] dsh fork 与许可：[vendor/README.md:3–5,15–27,31–63](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/README.md)、[vendor/cordis/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/vendor/cordis/package.json)。
- [N1] MV3 与当前架构：[AGENTS.md:7–17,94–103](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/AGENTS.md#L7-L17)、[entrypoints/background.ts](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/entrypoints/background.ts)。
- [N2] 主循环：[src/agent/loop.ts:774–845,980–1054](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/loop.ts#L774-L845)、[guards.ts](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/guards.ts)。
- [N3] 执行/观察：[host/puppeteer.ts:1–38](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/browser-control/host/puppeteer.ts#L1-L38)、[perception/capture.ts:217–264](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/browser-control/core/perception/capture.ts#L217-L264)、[refs.ts:286–306](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/browser-control/core/refs.ts#L286-L306)。
- [N4] 非 coding 工具目录：[tools.ts:20–49,99–129](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/tools.ts#L20-L129)、[save-file.ts:6–55](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/save-file.ts#L6-L55)、[package.json:12–26](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/package.json#L12-L26)。
- [N5] 状态/取消/恢复：[run-manager.ts:189–197,313–316](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/extension/run-manager.ts#L189-L197)、[db.ts](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/store/db.ts)、[journal.ts](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/extension/journal.ts)、[restore.ts:1–88](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/restore.ts#L1-L88)。
- [N6] 压缩：[compaction.ts:263–303,444–491](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/compaction.ts#L263-L303)、[loop.ts:217–335](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/agent/loop.ts#L217-L335)。
- [N7] 依赖/权限：[package.json:28–74](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/package.json#L28-L74)、[manifest-permissions.ts:19–30](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/ui/manifest-permissions.ts#L19-L30)。
- [L1] dsh：[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/LICENSE)、[THIRD_PARTY_NOTICES.md](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/THIRD_PARTY_NOTICES.md)。
- [L2] Nanobrowser：[LICENSE](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/LICENSE)、[src/options/licences.ts](https://github.com/nanobrowser/nanobrowser/blob/f1e912d7c9e859eec6638702be920c78a8eff0ea/src/options/licences.ts)。
- [C1] Chrome 官方 [Manifest CSP：extension pages / sandbox pages](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy?hl=en)。
- [C2] Chrome 官方 [Extension service worker lifecycle：Idle and shutdown / Persist data / Chrome 118](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle?hl=en)。
- [C3] Chrome 官方 [Remote hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code?hl=en)。
- [C4] MDN [CSP script-src 与 eval/WASM 的区别](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)。
- [P1] Pi core：[agent/package.json](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/agent/package.json)、[agent/README.md](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/agent/README.md)。
- [P2] Pi 官方浏览器支持与限制：[ai/README.md，Browser Usage](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/ai/README.md#browser-usage)。
- [P3] Pi 源码入口：[agent.ts](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/agent/src/agent.ts)、[agent-loop.ts](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/agent/src/agent-loop.ts)、[ai/src/index.ts](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/ai/src/index.ts)。
- [P4] Pi 固定快照许可：[LICENSE](https://github.com/badlogic/pi-mono/blob/482c1381a00d8d00bc81697e4a980c593db6803e/LICENSE)。
- [P5] Pi 官方固定快照目录：[packages](https://github.com/badlogic/pi-mono/tree/482c1381a00d8d00bc81697e4a980c593db6803e/packages)。
