# 具体外部 Agent 的连接可行性

调研日期：**2026-10-20**。这是接口与源码取证，不是已经实现的连接器或真实模型兼容性测试。范围为 Claude Code、DeepSeek Harness、腾讯 WorkBuddy、Google Antigravity；不重复 Codex、ACP 公共协议和 README 的工作。

## 结论速览

| 候选 | 连接判断 | 主要边界 |
| --- | --- | --- |
| Claude Agent SDK | 官方可编程入口，适合直接做本地连接器。[官方介绍](https://code.claude.com/docs/en/agent-sdk/overview.md) | SDK 不是 ACP；不能据技术可行性承诺第三方复用 claude.ai 登录/额度。 |
| Claude ACP adapter | Zed 出品的开源适配层，可与 DeepSeek 共用 ACP 客户端方向。[固定源码](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts) | 不是 Anthropic 官方 ACP；steering 是扩展且须协商。 |
| DeepSeek Harness ACP | 官方原生实现，new/list/resume/cancel/model 均有源码。[固定契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md) | 同会话在途 prompt 不接受第二条；恢复不重放历史。 |
| 腾讯 WorkBuddy | 官方本地助理 REST 与云任务 REST + ACP 路径均存在。[官方接口](https://open.workbuddy.cn/docs/openapi) | 本地助理完整会话管理、取消/模型控制和运行中输入语义未确认；云任务不能视为接管 PC。 |
| Google Antigravity | 官方独立 CLI、Python SDK 和 ACP 发布物均有证据。[CLI 文档](https://www.antigravity.google/docs/cli/headless/)、[SDK 源码](https://github.com/google-antigravity/antigravity-sdk-python/tree/91dc5f84565bb505577ac9524f107f453a6e8d1f)、[官方 ACP 安装指引](https://www.antigravity.google/docs/ide/extensions/zed/) | 官方 ACP 逐方法行为未确认；CLI/SDK 的会话不能默认与 IDE 互通。 |

建议先做 Claude / DeepSeek 的本地受控连接验证，再评估 WorkBuddy 与 Antigravity。选择依据是本轮可复核的控制面，而非模型效果或价格；下面所有“可行”均未包含真实模型与浏览器工具闭环验收。

## 1. 证据口径与时间

- **已确认**：本次读到官方文档或具体实现；不等于已经通过 BeeHelper 端到端测试。
- **未确认**：公开证据不足或本次未核验，不能写成“不支持”。
- **明确限制**：官方文档或实现明确拒绝、遗漏该方法，结论仅适用于固定快照。
- “运行中消息”分为服务端输出、客户端追加输入、排队跟进、即时 steering；不能用流式输出证明后面三项。
- “恢复”分为恢复持久上下文、重放历史、重连活动进程、恢复中断工具；不能互相替代。
- MCP 工具接入、模型推理 API、启动桌面窗口均不能单独证明可驱动 agent 会话。下面逐项列出实际会话接口，而不是按产品名推定能力。

本次只读了 BeeHelper 的既有研究、README 与 `connector/host.mjs`。读取时仓库 HEAD 为 `c01a99d16c67e4b169fdb2494569b058e5ae02ce`；现有连接器的 `rpc`、事件映射和工具进程均绑定具体后端，运行时 `busy` 会拒绝再次聊天。后续多后端适配需要能力协商，不能仅替换可执行文件名称。此为本地代码判断，参见 [现有连接器](../../connector/host.mjs)。

### 抓取记录

| 对象 | 抓取时间与可取得版本 | 解释边界 |
| --- | --- | --- |
| Claude 官方 SDK | 2026-10-20 08:56:36–09:00:24 UTC；TS 观察版本 `0.3.304`、commit `b8060fa5ac705b8f69ea32aafd21d32a9851000e`；Python `0.2.168`、commit `c01a99416a02805b0a050d058da51bde53f6df64` | 提交时间分别为 2026-10-19 21:34:18 / 21:36:52 UTC。[TS 固定提交](https://github.com/anthropics/claude-agent-sdk-typescript/commit/b8060fa5ac705b8f69ea32aafd21d32a9851000e)、[Python 固定提交](https://github.com/anthropics/claude-agent-sdk-python/commit/c01a99416a02805b0a050d058da51bde53f6df64)。在线文档未取得 commit，不将文档能力反推至旧版。 |
| Claude ACP adapter | 同上；`0.94.0`，`7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1`，提交时间 2026-10-19 21:29:13 UTC | [固定 manifest](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/package.json)依赖 SDK `0.3.303`，不是另行观察到的 `0.3.304`。 |
| DeepSeek Harness | 2026-10-20 08:56:35–08:58:42 UTC；`687f282e8625c6b8d11ff58211a90524be2e4317`，提交时间 2026-10-17 07:22:43 UTC；源码 CLI 包 `0.2.1-rc.2` | [固定 commit](https://github.com/deepseek-ai/deepseek-harness/commit/687f282e8625c6b8d11ff58211a90524be2e4317)、[包版本](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/apps/cli/package.json)。不是 npm 发布版核验，也不保证全球最新。 |
| WorkBuddy Open API | 2026-10-20 08:57–08:59 UTC；重复直取时间 `2026-10-20T08:59:29.676Z` | [官方页面](https://open.workbuddy.cn/docs/openapi)暴露资源构建标识 `0679f9de38aabc426ebe1a106b98b732766616e2`，没有可核实的公开源码 commit 映射。此次 HTML SHA-256 为 `1f76bf315ae73c41ce4463fe06b870fdfee8008d4a0402934d351188057a8d23`，仅为内容指纹，不是版本承诺。 |
| WorkBuddy / CodeBuddy 文档站 | 2026-10-20 08:58–09:01 UTC；页面自报 `main@aafbbf51beed`，资源路径完整标识 `aafbbf51beede9ed92e891325729f1e61074e0a4` | [官方文档入口](https://www.workbuddy.cn/docs/workbuddy/)自报 build `2026/10/19 11:15:33`、commit `2026/10/19 11:14:09`，未标时区；这是文档构建信息，不是 WorkBuddy 客户端版本或已核实的公开源码提交。 |
| 社区 workbuddy-api | 2026-10-20 08:57–08:59 UTC；`747dffa4db05582fb60599fd38efa9b590d106be`，提交时间 2026-09-18 09:33:15 UTC | [固定 commit](https://github.com/simplast/workbuddy-api/commit/747dffa4db05582fb60599fd38efa9b590d106be)。非腾讯官方，只作反例和风险说明。 |
| Antigravity 官方文档 / SDK | 2026-10-20 08:59:18–09:00:55 UTC；SDK commit `91dc5f84565bb505577ac9524f107f453a6e8d1f`，提交时间 2026-10-13 17:47:42 UTC | [固定源码](https://github.com/google-antigravity/antigravity-sdk-python/tree/91dc5f84565bb505577ac9524f107f453a6e8d1f)。文档无 commit；云 API 页面标注 2026-10-16 UTC 更新，不等于产品发布日期。 |
| Antigravity ACP 发布元数据 | 同上；registry commit `c804c2a1d170990efeda771e4433aa31bcdc0123`，条目版本 `1.4.1` | [固定 JSON](https://raw.githubusercontent.com/agentclientprotocol/registry/c804c2a1d170990efeda771e4433aa31bcdc0123/antigravity-acp/agent.json)。这是 registry 的 commit，不是闭源 server 的源码 commit；未执行握手。 |
| 社区 Antigravity adapter | 同上；`d10aa13c932236ef241863f2c8b3afdda2a2be12` | [固定仓库](https://github.com/shubzkothekar/antigravity-acp/tree/d10aa13c932236ef241863f2c8b3afdda2a2be12)，非 Google 官方；本轮不以它证明官方 ACP 方法。 |

**网络版本差异：**本轮搜索结果为空时改用官方 URL 与 `curl`。同一 WorkBuddy Open API URL 的网页读取结果与 `curl` 返回的接口集合不同：前者呈现过另一套助理会话接口，后者为下文的 `/openapi/v2/localassistant` 和 `/openapi/v2/tasks`。本文以重复直取可核实内容为保守依据，不混合两版能力。HTTP Date 只说明响应时间；示例时间、文档构建时间和抓取日期均不能证明“截至 2026-10-20 所有部署已支持”。后续接入须重新确认目标部署、授权范围与协议返回值。

## 2. Claude Code：官方 SDK 与 ACP adapter 是两层

### 身份与许可不能混写

Claude Agent SDK 是 Anthropic 官方编程入口，原 Claude Code SDK 已更名，复用 Claude Code 的执行能力；不是仅调用模型的 Anthropic Client SDK。底层依赖 CLI/运行进程，不是可直接放进扩展页面的纯浏览器库。[官方介绍](https://code.claude.com/docs/en/agent-sdk/overview.md)、[Python CLI 传输源码](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/_internal/transport/subprocess_cli.py)。

**Claude Code / TS SDK 按专有商业许可处理**：官方许可证保留全部权利，不能因 GitHub 仓库公开就称完整实现开源。**Python SDK 封装源码为 MIT**，但不能将其许可扩大到捆绑 CLI、模型和服务。[Claude Code 许可，浮动分支](https://github.com/anthropics/claude-code/blob/main/LICENSE.md)、[TS 固定许可证](https://github.com/anthropics/claude-agent-sdk-typescript/blob/b8060fa5ac705b8f69ea32aafd21d32a9851000e/LICENSE.md)、[Python MIT](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/LICENSE)、[捆绑 CLI 与条款说明](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/README.md#L342-L377)。

`claude-agent-acp` 则是 **Zed Industries 出品、Apache-2.0 开源的 SDK → ACP 适配层，不是 Anthropic 官方原生 ACP**。旧 `zed-industries/claude-agent-acp` 地址本轮重定向至 `agentclientprotocol/claude-agent-acp`；固定 manifest 仍署名 Zed，命令为 `claude-agent-acp`，依赖 Anthropic SDK。它不是通过逆向私有登录得到的会话接口；adapter 自身的开源许可也不豁免 Anthropic 服务条款。[固定 manifest](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/package.json)、[adapter 许可](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/LICENSE)。

### 会话能力对照

| 能力 | Anthropic 官方 Agent SDK | Zed ACP adapter 固定快照 |
| --- | --- | --- |
| New | **已确认** TS `query()`；Python `ClaudeSDKClient.connect()` 创建所管理的会话。不是附着任意桌面进程。[官方 API](https://code.claude.com/docs/en/agent-sdk/typescript#query)、[Python client](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/client.py) | **已确认** `session/new` 转到 `createSession()`。[实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3036-L3043) |
| List | **已确认** TS `listSessions()`、Python `list_sessions()`；持久化会话目录，不是活动进程清单。[官方会话文档](https://code.claude.com/docs/en/agent-sdk/sessions.md)、[Python 枚举](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/_internal/sessions.py#L680-L706) | **已确认** `session/list`，含 cwd、分页及标题/时间。[实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3172-L3200) |
| Resume | **已确认** `resume: sessionId`；`continue` 为最近会话。恢复历史上下文，不是文件系统快照或原进程。[官方语义](https://code.claude.com/docs/en/agent-sdk/sessions.md) | **已确认 v1** `session/resume` 不回放历史，`session/load` 回放历史。[实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3144-L3169) |
| Cancel | **已确认** TS `Query.interrupt()`、Python `interrupt()`；TS `close()` 终止底层进程，不能等同。[官方 Query](https://code.claude.com/docs/en/agent-sdk/typescript#query)、[Python 实现](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/client.py#L308-L312) | **已确认** `session/cancel` notification 调用 SDK interrupt，并处理队列；不保证撤销工具副作用或停止所有后台工作。[实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L8725-L8738) |
| Model | **已确认** 初始 `model`，TS `setModel()` / `supportedModels()`，Python `set_model()`。不能据此保证替换当前正在生成的响应。[官方 Query](https://code.claude.com/docs/en/agent-sdk/typescript#query)、[Python 实现](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/client.py#L341-L362) | **已确认** `session/set_config_option`、`configId: model` 转到 SDK `setModel()`；不能假设旧 `session/set_model`。[配置常量](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/session-model.ts#L6)、[实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L9021-L9034) |
| 运行中输入 | **已确认持续输入**：TS `AsyncIterable<SDKUserMessage>`；Python client 发送/接收分离。输入优先级和时序需按所用 SDK 版本验证。[官方输入模式](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md)、[Python 发送实现](https://github.com/anthropics/claude-agent-sdk-python/blob/c01a99416a02805b0a050d058da51bde53f6df64/src/claude_agent_sdk/client.py#L272-L306) | **已确认运行中接收/入队**：普通 prompt 立即送 SDK；不能承诺严格隔轮处理。另有非标准 `_session/steering`，见下文。[入队实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3919-L3949) |
| 运行中输出 | SDK 异步消息流；`includePartialMessages` / `include_partial_messages` 额外启用部分增量，不能与输入 streaming 混写。[官方输出模式](https://code.claude.com/docs/en/agent-sdk/streaming-output.md) | 通过 `session/update` 映射消息、工具与状态；最终响应与 SDK 生命周期由 adapter 管理。[官方 adapter 源码](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts) |

当前在线 TS 文档区分 `priority: next`（默认，可在工具完成后进入当前轮）、`later`（等轮结束）、`now`（中断生成）；adapter 普通 prompt 没有显式指定 `later`。因此“接收运行中消息”不能写成“必定下一轮执行”。更强的即时注入应检查初始化返回的 `_meta.steering.supported`，再使用 `_session/steering`；固定实现通常选 `now`，等待审批/elicitation 时选 `later`，空闲行为也须明确。**该扩展仅在 adapter v1 路径确认，实验 v2 不应继承此结论。**[官方输入类型](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage)、[adapter 消息字段](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L12738-L12752)、[steering 实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L4285-L4388)、[v1/v2 边界](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/README.md#L96-L107)。

**建议：**直连官方 SDK 可减少一层映射；优先统一 ACP 时可复用 Zed adapter，但锁定 adapter 与其依赖 SDK，不把在线新 SDK 文档直接当成 adapter 的保证。不采用旧 TS `createSession/send/stream` 示例；官方会话文档称该接口在 `0.3.142` 已移除。[官方会话文档](https://code.claude.com/docs/en/agent-sdk/sessions.md#automatic-session-management)。

**授权是独立门槛：**官方明确，未经预先批准，不允许第三方产品提供 claude.ai 登录或额度，应采用其文档描述的 API key 方式。不能因为 adapter 能读本机配置，就承诺 BeeHelper 可以商用复用订阅额度。本次没有读取配置、凭据或自动执行登录。[官方 SDK 认证提示](https://code.claude.com/docs/en/agent-sdk/overview.md)。

## 3. DeepSeek Harness：原生 ACP 可以驱动，注意不是完整 IDE 协议

### 身份、许可与入口

这是 `deepseek-ai` 官方仓库的 agent harness，不是 DeepSeek 模型 HTTP API，也不是名称相近的社区客户端。主项目 **MIT 开源**，第三方代码另有许可声明；上游仍标记 developer preview，并明确尚未安全审计。[官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/README.md)、[LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/LICENSE)、[安全声明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/SAFETY.md)。

官方入口为 `dsh acp` 或 `dsh --profile acp`，传输为 stdio JSON-RPC；本次没有证实它提供可直接连接的远程 HTTP agent 服务。ACP profile 装配持久化，`initialize` 声明能力；`authMethods: []` 和 `authenticate` 立即成功只描述本地协议层，**不代表模型请求无需授权**。[CLI 帮助](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/cli-help.md#L82-L98)、[profile 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/bundle/acp-app/README.md)、[连接实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L180-L198)。

### 实际能力

| 能力 | 结论与一手证据 |
| --- | --- |
| New | **已确认** `session/new`；校验绝对工作目录及 MCP 配置，创建持久会话并返回 `sessionId`、`configOptions`。[实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L200-L240) |
| List | **已确认但非全量活动列表** `session/list`；分页查询可恢复的持久化根会话，可按 `cwd` 筛选，排除当前 Context 已激活会话和子会话。[实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L296-L334) |
| Resume | **已确认** `session/resume`；检查目录与非活动状态，恢复日志但不重放旧输出；跨进程须保留同一持久化根并重新给出 MCP 配置。**明确不提供 `session/load`**。[恢复实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L243-L293)、[限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#known-limitations-and-deferred-work) |
| Cancel | **已确认** `session/cancel` 通知及 `$/cancel_request`；未知会话 no-op，原 prompt 可返回 `stopReason: cancelled`。取消不等于撤销工具副作用。[注册实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/index.ts#L365-L394)、[取消测试源码，未执行](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/tests/turns.spec.ts#L318-L342) |
| Model | **已确认** `session/set_config_option`，`configId` 使用 `model` / `reasoning_effort`，取值来自返回选项；不是假定存在 `session/set_model`。当前 turn 固定入场时模型，并发修改用于后续 turn。[模型控制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/model-control.ts#L62-L133)、[协议契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#protocol-contract) |
| 运行中追加输入 | **明确限制**：每会话只能有一个在途 `session/prompt`；第二个报 `already in flight`。一条连接可并行多个不同会话，但不能由此推导单会话 steering。[实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/session.ts#L239-L272) |
| 运行中输出 | **已确认** `session/update` 的消息、思考、工具调用及更新，符合条件时有 usage；属于已提交会话事件的语义投影，**不是原始 provider token delta**。以 prompt 的最终响应判定结束。[事件转换](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/src/updates.ts#L16-L100)、[语义说明](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#understand-the-implementation) |

`session/close` 会取消、排空、刷新持久化并释放目标会话，不删除历史。该 profile 不提供 transcript 重放、fork、客户端文件系统、terminal、plans 等完整交互界面能力。客户端必须处理 `session/request_permission`；MCP 只负责工具挂载，不能代替上述会话控制。[官方契约与限制](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/acp/acp/README.md#protocol-contract)。

### 不要与自有 SDK / headless 混用

`dsh sdk` 是另一套 stdio JSON-RPC 协议，包含 `session/prompt`、`session/resume`、`session/wait` 等；新 ID 首次使用可创建会话，prompt 返回 `messageId` 并允许继续入队。**入队不保证立即 steering**。这套服务端方法表没有独立 new/list/cancel/close 或动态选模型方法，不能把 ACP 方法直接发给它。[SDK 方法分派](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/server/src/server.ts#L343-L375)、[入队实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/server/src/server.ts#L191-L212)、[SDK 契约](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/sdk/protocol/README.md)。

CLI 还有单任务退出的 `dsh headless`、`--json` 事件和 `--session-id` 恢复；本轮未确认存在统一的 `dsh session new/list/resume/cancel/model` 子命令组。[官方帮助](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/cli-help.md#L100-L145)。

**对 BeeHelper 的建议：优先验证原生 ACP。** 本地 Native Messaging 桥接进程可管理 stdio 子进程，BeeHelper 另存可显示的 transcript 和活动会话索引；busy 时禁止重复 prompt，或明确采用“取消后再发”的产品语义。不要承诺恢复正在执行的工具或接管其他前端已经激活的会话。这是依据上述接口的工程建议，尚未实现。

## 4. 腾讯 WorkBuddy：确有官方 API，须区分本地助理与云端任务

### 产品身份与开源判断

这里的 WorkBuddy 是腾讯云代码助手推出的 AI Agent 办公产品，官方主页结构化数据也标注 Tencent Cloud；不是泛指 CodeBuddy IDE 或 CodeBuddy Code CLI。[WorkBuddy 官方主页](https://www.workbuddy.cn/)。

本轮未找到完整 WorkBuddy 客户端/harness 的官方开源仓库及开源授权。**按专有/闭源分发产品处理，完整源码开放状态未确认**；开放平台文档公开不等于客户端开源，不应套用社区同名项目的 MIT 许可。此为本次证据范围判断，并非对腾讯内部源码状态的断言。[官方产品与文档入口](https://www.workbuddy.cn/docs/workbuddy/)、[官方开放平台](https://open.workbuddy.cn/docs/openapi)。

CodeBuddy Code 则有官方 `codebuddy --acp` 入口，页面 canonical 指向 CodeBuddy 文档，即使从 WorkBuddy 域名也能访问。**它证明 CodeBuddy Code 可作为 ACP server，不证明启动的是 WorkBuddy 桌面会话。** 若后续选择它，应列为独立后端，而不是 WorkBuddy 的“已验证 CLI”。[CodeBuddy 官方 ACP 文档](https://www.codebuddy.cn/docs/cli/acp)。

### 本地助理 API：官方可发消息，但不是已证实的完整 session manager

下面是重复直取的官方 Open API 版本。调用需第三方应用通过官方 OAuth 2.1 获得用户授权，并获得对应 scope；本次未登录、注册应用或申请授权。[授权与本地助理 API](https://open.workbuddy.cn/docs/openapi)。

| 能力 | 结论与证据 |
| --- | --- |
| 连接与发送 | **已确认文档接口** `GET /openapi/v2/localassistant` 查询在线状态，`POST /openapi/v2/localassistant/message` 触发 PC 助理执行，返回 `message_id`；scope 分别为 `user.localassistant.readable` / `user.localassistant.invokable`。[官方本地助理章节](https://open.workbuddy.cn/docs/openapi#本地助理%20API) |
| New / List / Resume | **独立会话生命周期未确认**；这版文档没有上述会话方法，消息请求也未给出可选的 session ID。消息历史不等于 session list，更不能推断可以恢复任意 PC 对话。[发送与查询参数](https://open.workbuddy.cn/docs/openapi#发送消息给本地助理) |
| Cancel / Model | **未确认**；本次直取的该章节未公开取消或模型选择端点，不能据其他产品或另一页面版本补齐。[同一官方章节](https://open.workbuddy.cn/docs/openapi#本地助理%20API) |
| 运行中输出 | **已确认历史/增量查询** `GET /openapi/v2/localassistant/message`；分页参数 `limit` / `offset`，或以 `message_id` 查询后续消息。没有据此证明本地助理提供 token 级流式输出。[消息历史](https://open.workbuddy.cn/docs/openapi#查询本地助理消息历史) |
| 运行中输入 | 普通 `msg_type: text` 可发送；`permission_response` 可回答 AskQuestion / 工具审批。**busy 时普通消息的排队、拒绝或 steering 语义未确认**。[请求体说明](https://open.workbuddy.cn/docs/openapi#发送消息给本地助理) |

### 云端任务 API：官方 REST 创建/列举，ACP 继续对话

| 能力 | 结论与证据 |
| --- | --- |
| New | **已确认文档接口** `POST /openapi/v2/tasks`，提交初始 `prompt`，返回 `task_id`、ACP `link` 和有期限的 `token`。这是云端任务，不是已证实的新建本地 PC 会话。[创建云端任务](https://open.workbuddy.cn/docs/openapi#创建云端任务) |
| List | **已确认** `GET /openapi/v2/tasks` 分页查询；列表不返回 ACP token，需查询详情获取。[任务列表](https://open.workbuddy.cn/docs/openapi#查询云端任务列表) |
| Resume / Reconnect | **已确认到加载已有云任务层面**：`GET /openapi/v2/tasks/{task_id}` 获取连接信息，初始化后 `session/load`，`sessionId` 使用 task ID，再 `session/prompt` 追问；token 过期按官方详情接口换新。**中断工具续跑、完整历史重放和任意桌面会话接管未确认**。[查询任务](https://open.workbuddy.cn/docs/openapi#查询云端任务)、[ACP 说明](https://open.workbuddy.cn/docs/openapi#ACP%20使用说明) |
| Cancel | **未确认实际可调用的取消方法**：文档列出终止结果可为 `cancelled`，但这不是 `session/cancel` 已实现的充分证据；没有调用服务测试。[结束信号说明](https://open.workbuddy.cn/docs/openapi#ACP%20使用说明) |
| Model | **未确认外部选择/切换接口**：这版创建 body 为 prompt/name；尚无本次可核验的模型配置方法。[创建参数](https://open.workbuddy.cn/docs/openapi#创建云端任务) |
| 运行中输出/交互 | **已确认** `session/update`、`session/request_permission` 及 prompt 最终 response；须回权限请求，以最终 response 判定轮次结束。重复 `session/prompt` 可追问，但**同会话运行中并发输入语义未确认**。[协议流程](https://open.workbuddy.cn/docs/openapi#ACP%20使用说明) |

传输是厂商文档定义的 **GET SSE 接收 + POST JSON-RPC 发送**，使用 `Acp-Connection-Id` 关联，协议示例 `protocolVersion: 1`。这证明它公开了一条 ACP 风格会话控制通路，**不证明可不加适配地替换 stdio ACP、支持所有标准/扩展方法，或等同于公共协议已标准化的网络传输**。`session/load` 示例中的 `mcpServers: []` 也不足以证明能挂载 BeeHelper 的本机 MCP 工具。[官方传输及示例](https://open.workbuddy.cn/docs/openapi#ACP%20使用说明)。

**对 BeeHelper 的建议：分别评估两条官方路线。** 本地助理可先做消息交互验证，不能承诺完整多会话管理；云端任务更接近外部 UI 驱动，但首要验证应用准入、授权、跨域/桥接、权限请求及云端到本机浏览器工具的可达性。不能把云端 API 已存在推导成浏览器操作闭环已通。

### 社区适配不是 WorkBuddy 会话接口

`simplast/workbuddy-api` 是 **非官方、MIT** 的本地代理；固定快照说明它把 Chat Completions 客户端接到 CodeBuddy，依赖 CLI 请求头指纹与 prompt 替换，并从 WorkBuddy/CodeBuddy 本地配置缓存读取模型目录。它暴露 `/v1/chat/completions`、`/v1/models`，**不是代理 WorkBuddy 的持久 agent 执行会话**。[固定 README](https://github.com/simplast/workbuddy-api/blob/747dffa4db05582fb60599fd38efa9b590d106be/README.md)、[许可](https://github.com/simplast/workbuddy-api/blob/747dffa4db05582fb60599fd38efa9b590d106be/LICENSE)。

这类行为属于对非稳定内部请求形态的适配/逆向路线，风险包括服务条款、接口漂移、认证泄露和错误复用模型上下文；MIT 只授权代理代码，不授权上游账户或服务。**不推荐作为 BeeHelper 首选，更不建议自动化私有登录、读取本地 token 或冒充官方客户端。** 本次没有读取任何所述缓存、凭据或请求真实模型。

## 5. Google Antigravity：已有独立官方驱动入口，不能只按早期 IDE 判断

### 身份与许可

本次可取的 Google 官方文档已区分 Antigravity 产品、独立 CLI、Python SDK 与 IDE 集成；另有云端 Antigravity Agent API。它们不是“Gemini 模型 API”一个名字的同义词，也不能默认互通所有 session ID。[官方产品概览](https://www.antigravity.google/docs/overview/)、[SDK 概览](https://www.antigravity.google/docs/sdk/overview/)、[云端 Agent API](https://ai.google.dev/gemini-api/docs/antigravity-agent)。

**产品/CLI/官方 ACP 按专有分发处理；Python SDK 仓库为 Apache-2.0 开源。** 官方 ACP 发布元数据直接标记 `proprietary`；SDK README 明确依赖 wheel 内的编译 runtime，仅克隆源码不能运行，不能将 SDK 仓库的开源许可扩大为整个产品或编译运行时完整开源。[产品条款](https://www.antigravity.google/terms)、[ACP 发布元数据](https://raw.githubusercontent.com/agentclientprotocol/registry/c804c2a1d170990efeda771e4433aa31bcdc0123/antigravity-acp/agent.json)、[SDK LICENSE](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/LICENSE)、[runtime 说明](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/README.md)。

### CLI / SDK 的实际证据

| 能力 | 独立 CLI `agy` | 官方 Python SDK 固定快照 |
| --- | --- | --- |
| New | **已确认文档入口** `agy -p`，结果含 `conversation_id`。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | **已确认** `Agent` 或 `Conversation.create()`。[会话源码](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/conversation/conversation.py) |
| List | `/resume` 交互选择器有文档；**机器可读列表未确认**。[会话文档](https://www.antigravity.google/docs/cli/conversations/) | **会话枚举未确认**；不能用单个对象的 `history` 代替全局 list。[会话源码](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/conversation/conversation.py) |
| Resume | **已确认** `--continue/-c`、`--conversation ID`。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | **已确认持久恢复示例**：同一 `save_dir` 和 `conversation_id`；不是已证实附着 IDE 进程。[官方持久化示例](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/examples/getting_started/persistence.py) |
| Cancel | 文档列出 SIGINT 对应 `INTERRUPTED`；**独立按 ID 取消未确认**。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | **已确认** `Conversation.cancel()`，官方例子也有 `response.cancel()`。[会话源码](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/conversation/conversation.py)、[取消示例](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/examples/getting_started/cancellation.py) |
| Model | **已确认启动选择** `--model`、`agy models`；不等于热切换。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | **已确认配置选择** `LocalAgentConfig(model=…)`；运行中热切换未确认。[配置源码](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/connections/local/local_connection_config.py) |
| 运行中输入 | NDJSON stdin 多轮有文档，但要求等待当前 `result` 后再发；**中途 steering 未确认**。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | `send()` 若忙会先排空当前轮或等待 idle，再发新消息；**不能称即时注入当前轮**。[发送实现](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/conversation/conversation.py) |
| 运行中输出 | **已确认** `--output-format stream-json`，消息与 result 为不同事件。[headless 文档](https://www.antigravity.google/docs/cli/headless/) | **已确认** `receive_steps()`、`receive_chunks()`，输出文本、思考与工具事件。[实现](https://github.com/google-antigravity/antigravity-sdk-python/blob/91dc5f84565bb505577ac9524f107f453a6e8d1f/google/antigravity/conversation/conversation.py) |

CLI 文档明确拒绝流输入中的 `control_request` / `control_response` 和 `/model`；不能照抄 Claude stream-json 控制消息。关闭 stdin 会等待当前轮结束后退出，不能作为取消实现。[官方 headless 协议说明](https://www.antigravity.google/docs/cli/headless/)。

### 官方 ACP：发布物存在，逐方法仍未确认

Google 官方 Zed 文档指引从 Registry 安装 Antigravity；固定 registry 条目作者为 Google LLC、版本 `1.4.1`，下载产物在 `dl.google.com`。因此不是“只能找社区 ACP”的状态。[Google 安装文档](https://www.antigravity.google/docs/ide/extensions/zed/)、[固定 registry JSON](https://raw.githubusercontent.com/agentclientprotocol/registry/c804c2a1d170990efeda771e4433aa31bcdc0123/antigravity-acp/agent.json)。

但本轮没有下载执行 server、没有 capability 握手，也未取得官方服务端源码；**官方 ACP 的 new/list/load/resume/cancel/model 和运行中追加输入，逐方法行为均标记未确认**。registry 存在不是这些方法全部支持的证明，更不是 IDE 历史可接管的证明。下一步应先做无模型的初始化能力核验，再决定是否替代 CLI/SDK；本轮按要求没有启动。

### 云端 Agent API：另一条官方路线，不是本地 IDE API

官方文档快照提供 Preview Agent API，示例 agent 标识为 `antigravity-preview-09-2026`。可用 `POST /v1beta/interactions` 新建，按 ID 查询；传 `previous_interaction_id` 与原 `environment_id` 多轮续接；后台任务有 `POST /interactions/ID:cancel`，模型用 `agent_config.model`。**全历史枚举、运行中改写当前 interaction、附着本地 IDE 均未确认。** 这些是完整云端 agent 任务接口，不应与普通 Gemini 生成模型接口或本地会话混称。[Google 官方 Agent API](https://ai.google.dev/gemini-api/docs/antigravity-agent)。

### 社区样本与推荐

非官方 `shubzkothekar/antigravity-acp` 固定快照为 MIT，代码有 new/list/load/resume/cancel/model 路径，但 list 仅覆盖 adapter 自己的持久化记录；每轮另起 CLI、stdin 为 ignore，不能证明正在运行时可注入输入。这是 **CLI 包装适配，不是 Google 官方 server，也不据此归类为私有 API 逆向**。存在 CLI 参数变化、进程取消和会话存储兼容风险，不能用它替官方 ACP 填能力表。[会话源码](https://github.com/shubzkothekar/antigravity-acp/blob/d10aa13c932236ef241863f2c8b3afdda2a2be12/src/acp/agent.ts)、[进程源码](https://github.com/shubzkothekar/antigravity-acp/blob/d10aa13c932236ef241863f2c8b3afdda2a2be12/src/agy/process.ts)、[MIT 许可](https://github.com/shubzkothekar/antigravity-acp/blob/d10aa13c932236ef241863f2c8b3afdda2a2be12/LICENSE)。

**建议：优先官方 CLI/SDK 或进一步核验官方 ACP。** 本地桥接可转换事件并转接 BeeHelper 工具，但 session ID 互通、审批、取消效果及工具连接均需独立验证。已有官方入口，没有必要为了接管 IDE 去自动化私有登录、读取 token 或逆向内部服务。

## 6. BeeHelper 集成约束与最小验收

以下为工程建议，不是新增实现或上游承诺：

1. 连接器按后端声明能力：创建、枚举、持久恢复、历史回放、取消、模型列表/选择、运行中追加、steering 各自独立；未知能力默认不展示承诺。
2. 本地 stdio/SDK 由浏览器外受控进程管理；WorkBuddy / Antigravity 云接口单列网络连接器及官方授权流程，不把云任务和本机会话混存。
3. BeeHelper 保存自己的展示历史、外部 session ID 与事件游标；DeepSeek 的 list/resume 尤其不能替代 UI 历史。恢复失败、过期连接及重复投递应给出明确状态。
4. 运行中输出至少验证文本、工具状态、权限请求与最终结束信号；不能用“暂时没有 chunk”认定任务结束。取消后的未知副作用不能自动重试。
5. 工具通路独立验收：给外部 agent 挂载 BeeHelper MCP/回调工具，执行合成页面上的只读观察与受控操作；云端网络不能直接假定能访问本机 socket。
6. 将“追加后排队”“立即 steering”“取消后再发”区分为不同交互。DeepSeek ACP 不能发送第二条在途 prompt；Antigravity SDK 的等待 idle 不是 steering；Claude steering 须协商扩展。
7. 固定所验证的二进制/SDK/adapter 组合及官方授权方式；不扫描个人配置、Cookie 或 token，不承诺所有产品均可复用订阅额度。

## 7. 已验证与未验证

**已验证：**官方页面与公开源码只读取证；关键固定 manifest、许可证、协议方法实现、SDK 会话行为及测试源码交叉核对；关键资料通过 `curl` 直取复核；记录抓取时刻、可得 commit 与网络版本差异。部分 GitHub API 后续返回 403，仍可取得固定 raw 文件；不以此推断项目或接口不存在。

**未验证：**未安装或启动任何 agent/模型，未执行上游会话测试、真实授权或模型请求，未验证取消时序、后台工具、实际 ACP capability 握手、跨产品会话互通、云端到 BeeHelper 工具可达性和浏览器端到端闭环。文档与源码支持的结论不能升格为真实部署可用性。

**修改边界：**本任务仅新增本文件；未改 README、主报告、客户端配置或其他工程文件，未读取凭据，未执行提交或推送。没有将来源获取时间、示例日期或可取版本夸大为“最新版本”。
