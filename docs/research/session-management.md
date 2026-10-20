# 多 Agent 会话管理调研与建议

调研日期：2026-10-20。性质：基于一手文档、源码及本机协议 schema 的选型建议，不是功能上线声明。调研当时 BeeHelper 只连接 Codex；后续 0.2.0 的实现与边界见[会话管理与插件开发](../agent-sessions.md)。本次调研本身未调用真实模型，未读取登录凭据，也未修改客户端配置。

## 结论

**建议保留现有 Codex App Server 接入，并在本地连接器中新增 ACP 适配插件；BeeHelper 自己持有统一会话索引和事件状态。** 不应为了多客户端而把 Codex 已有的能力降到某个公共协议的最小交集，也不需要自己重写 agent loop。[O1][A1][A2]

可复用代码分为三层：

1. **协议层直接复用**：官方 `@agentclientprotocol/sdk`，用于支持 ACP 的外部进程。固定版本、协商能力，不假定每个 agent 都实现会话列举、恢复和模型选择。[A1][A2][A3]
2. **会话工作台选择性复用**：对比 AionUi、Happy 等项目的会话状态、适配器和事件处理；具体证据及许可见[候选调研](session-reuse-candidates.md)。它们不是装进 MV3 就能工作的统一浏览器库。
3. **UI 层可选复用**：`assistant-ui` 的 `ExternalStoreRuntime` 可以接已有消息状态和回调，不强制替换外部 agent 为模型 API；但不会替 BeeHelper 实现本地进程控制、持久化和 ACP。[U1][U2]

各客户端的接入依据见[兼容性调研](agent-client-compatibility.md)。支持某个厂商的模型，不等于连接该厂商的客户端；客户端能调用 MCP，也不等于允许 BeeHelper 驱动它的会话。

### 指定客户端的结论速览

| 客户端 | 建议接入 | 关键边界 |
| --- | --- | --- |
| Codex | 保留原生 App Server | 原生 steer、线程和模型能力不必先绕 ACP |
| Claude Code | 优先验证开源 `claude-agent-acp`；也可直连官方 Agent SDK | adapter 由 Zed 出品，不是 Anthropic 原生 ACP；steering 属协商扩展，认证另核实 |
| DeepSeek Harness | 官方 `dsh acp` / ACP profile | 支持列表/恢复/配置，但同一会话在途 prompt 不接受第二条，需队列降级 |
| Antigravity | 优先核验 Google 官方 ACP 发布物，CLI/SDK 为备选 | 发布物已确认，具体 capability 握手尚未做；不承诺接管 IDE 原会话 |
| WorkBuddy | 本地助理 API 与云端任务 REST + ACP 分别适配 | 不是 CodeBuddy Code；本地完整 session manager、外部模型切换和工具闭环尚未确认 |

Codex 依据 [O1]；其余逐项一手文档、固定源码、许可和限制见[兼容性调研](agent-client-compatibility.md)。这些是可进入验证的接入路线，不是 BeeHelper 已实现的支持列表。

## 1. 先解释当前限制

以下为当前仓库代码事实，不是对外部产品的推测：

| 用户感知 | 本地实现 | 判断 |
| --- | --- | --- |
| 运行时不能插话 | `src/main.tsx` 的 `sendPrompt` 遇到 `busy` 直接返回；`connector/host.mjs` 的 `chat` 也拒绝运行中请求 | BeeHelper 尚未接上 steer 或消息队列 |
| 模型切换能力弱 | 界面有模型选择器，`connectAgent` 会请求列表，`chat` 会把 `model` 传给 `turn/start`；但选择只存在组件状态中 | 不是完全没有切换入口；仍缺会话级保存、有效模型回显、失败处理和生效时机 |
| 不能切换会话 | `Database` 只有一份 `chat` 和一个 `threadId`；`newChat` 清空两者；连接器持有单个 `currentThread` | 没有历史会话索引，不能只补一个切换按钮 |
| 断线与恢复较弱 | 消息增量按 `messageId` 汇总，工具和错误写入全局 `chat`，运行状态是全局 `busy` | 加入多会话前必须先按连接、会话及 turn 归属路由事件 |

`newChat` 没有调用远端删除，因此清空界面不等于删除 Codex 保存的线程；本轮没有枚举用户已有线程来验证历史记录。

## 2. Codex 已有能力值得保留

官方 App Server 文档明确描述以下控制能力；本机也使用 Codex CLI **0.145.0** 导出了非 experimental 的 JSON Schema，确认对应参数存在。**schema 存在不等于真实交互已经通过测试。**[O1]

| 能力 | 原生方法 | BeeHelper 的处理建议 |
| --- | --- | --- |
| 新建 | `thread/start` | 创建本地会话并保存原生 ID |
| 查询、切换、恢复 | `thread/list`、`thread/read`、`thread/resume` | 先管理 BeeHelper 创建的会话；其他客户端历史需要单独、显式导入 |
| 运行中追加要求 | `turn/steer` | 传 `threadId`、`expectedTurnId`、`input`；处理当前 turn 恰好结束的竞态 |
| 停止 | `turn/interrupt` | 请求后等待结束事件，不能将“请求停止”显示为“已停止” |
| 模型列表与切换 | `model/list`、`turn/start.model` | 默认从下一轮生效，并分别保存用户选择与服务器确认结果 |
| 分支 | `thread/fork` | 可后置，不能与切换历史会话混为一谈 |

`turn/steer` **不接受模型等 turn-level override**。正在生成时选择新模型，应明确标注下一轮生效；用户明确要求立刻重启时，才采用停止后发起新一轮，而不是声称同一轮无缝更换模型。[O1]

本机核验只运行：

```sh
codex --version
codex app-server generate-json-schema --out <临时目录>
```

实际核验为显式选择的 0.145.0 可执行程序，未启动 App Server、未发送模型请求。PATH 中另一个 `codex` 报告 0.140.0；实际接入时需核对连接器选中的二进制，不能把在线文档当作所有已安装版本的契约。临时 schema 已清理，未提交机器路径。

## 3. ACP 能统一什么，不能统一什么

官方 TypeScript SDK 固定源码快照：

- 仓库：`agentclientprotocol/typescript-sdk`。
- 本轮读取的 commit：`c2b1a8633745dd859a2732b4e17d5ed61e869bb6`。
- 该快照 `package.json` 版本为 `2.0.0`，许可 Apache-2.0。此处是源码版本，不代表已验证 npm 发布或安装。
- 默认入口仍为 ACP v1；`experimental/v2` 是实验入口，不能因为 SDK 大版本为 2 就默认使用 v2 协议。[A1][A2]

| 能力 | 本轮核对到的协议语义 | 集成边界 |
| --- | --- | --- |
| 基础交互 | `session/new`、`session/prompt`、`session/update`、`session/cancel` | SDK 负责通信，不负责 BeeHelper 的数据库 |
| 历史列表 | `session/list` | 必须检查 `sessionCapabilities.list`；没有时依然可展示 BeeHelper 本地索引，但不能保证远端可恢复 |
| 历史恢复 | `session/load` 回放历史；`session/resume` 不回放 | 分别检查 `loadSession` / `sessionCapabilities.resume`；不要混用和重复追加历史 |
| 模型选择 | `configOptions`、`session/set_config_option` | 根据 agent 实际返回的 `model` 类别配置生成选择器；不硬编码所有客户端的模型名 |
| 中途追加 | 本轮核对的 v1 prompt 流程没有通用、等价于 Codex `turn/steer` 的承诺 | 运行中 prompt 的特定 adapter 行为需单独核验；默认使用 BeeHelper 队列或显式停止后重发 |
| MCP 工具 | session 初始化传入 MCP servers | 沿用 BeeHelper 浏览器与微应用工具；仍需关联调用与会话 |

表格依据：[A3][A4][A5][A6]。某些 adapter 使用旧 SDK、unstable 方法或私有扩展；应以实际握手结果和锁定版本为准，不照抄当前文档假定都支持。

**存在可借用的 steering 扩展，但不是 ACP 通用保证。** 本轮核对的 Claude/Codex ACP adapters 与 agent-shell 使用 `_session/steering`，agent-shell 根据 `_meta.steering.supported` 门控。可为 ACP 插件加入版本化扩展支持；DeepSeek Harness 的 ACP profile 则明确拒绝同一会话的第二个在途 prompt，因此仍需排队降级。具体源码见[候选调研](session-reuse-candidates.md)与[客户端调研](agent-client-compatibility.md)。

官方传输说明以 stdio 为主要路径，Streamable HTTP 仍标注为草案。浏览器扩展不能直接启动这些进程；现有 Native Messaging 本地桥仍有价值，不应为了 ACP 另加一个无鉴权的 localhost 服务。[A7]

## 4. 推荐的插件边界

以下是工程建议，不是已经实现的 API。无需更改“微应用可以是任意脚本/界面”的产品边界。

```text
Chrome 侧边栏
  -> BeeHelper 会话索引、消息投递状态
  -> Native Messaging 本地桥
       -> Codex App Server 插件（保留原生 steer / model / thread）
       -> ACP 插件（Claude adapter / dsh / 其他兼容 agent）
       -> 厂商原生插件（仅对已确认公开控制接口的客户端）
  <- 统一消息、工具、配置、连接及执行状态事件

外部 agent -> BeeHelper MCP -> 浏览器与微应用工具
```

不要只把 `chat(text)` 改成 `chat(provider, text)`。最低需要：

- **会话身份**：`sessionId` 是 BeeHelper 的 ID；`providerId`、`connectionId`、`nativeSessionId` 分开保存。两个进程中的相同原生 ID 不能误合并。
- **会话索引**：标题、更新时间、状态、客户端、模型、目标微应用/版本/页面、是否可恢复；索引先覆盖 BeeHelper 创建的会话。
- **能力声明**：分别声明 list/load/resume/model/cancel/steer；不支持的能力明确呈现，不伪造成功。
- **事件归属**：每条事件带会话、连接代次、turn、消息或工具调用标识。切换 UI 不改后台任务归属，旧连接迟到事件不能写入新会话。
- **MCP 归属**：当前工具请求没有会话字段；未来应在每会话 MCP 配置/连接映射中绑定上下文，而不依赖“此刻前台选中的应用”。微应用及页面上下文按投递时捕获。
- **持久化与迁移**：将现有 `chat/threadId` 迁移为默认 Codex 会话；版本化迁移、保留旧数据。浏览器会话索引与 agent 原生历史各司其职。
- **生命周期**：区分 `connecting`、`idle`、`running`、`stopping`、`disconnected`、`unknown`；断线不等于任务失败，停止不回滚已执行的网页操作。
- **权限与认证**：保持用户本机客户端既有认证路径；不复制登录文件，不绕过客户端审批。新的交互审批应显示和回传，不继续用“所有未知请求直接拒绝”代替完整交互。

首步可以规定每个连接只运行一个任务，同时允许自由浏览/切换其他会话。**会话切换不等于并发执行，也不应隐式停止原会话。** 跨会话并发需要 adapter 和工具归属都通过验证后再开放；停止命令必须绑定任务所属会话，不能停止一个全局“当前任务”。

### WorkBuddy 不是简单的 stdio 后端

官方开放平台确有两类控制入口：本地 PC 助理的消息 API，以及云端任务 REST + ACP 通道。后者使用厂商定义的 SSE 接收/POST 发送组合，不能直接当成 stdio 进程；其本机浏览器工具可达性也未证实。[W1]

开放平台文档要求注册第三方应用并走 OAuth 授权，示例涉及 `clientSecret`。**不能将应用密钥写入公共仓库、扩展或随包分发的本地连接器**；需确认厂商是否提供适用于公共客户端的授权方式，或引入受信任的服务端授权组件。当前纯本地路线不能提前承诺无需额外基础设施。[W1]

### 三种消息投递不可混淆

| 投递 | 用户预期 | 实现建议 |
| --- | --- | --- |
| 追加到当前任务 | 当前执行继续，并吸收新要求 | adapter 确认支持时走 steer；显示实际接收状态 |
| 排队发送 | 当前任务结束后继续 | BeeHelper 持久队列，支持编辑、删除；绑定明确会话和上下文 |
| 停止并发送 | 终止当前任务，再处理新消息 | 等待确认停止，再起新轮；旧轮的网页副作用保留 |

发生“投递时 turn 刚结束”时，不自动丢消息，也不悄悄变成重复新任务；返回可理解状态，再按明确的排队策略处理。重连后的发送确认未知同样不能盲目重放。

### 模型和客户端不是同一层

同一客户端更换模型通常可以继续原生会话，但是否支持由它的接口决定。**切换客户端不承诺保留同一个原生会话的内部状态**：Codex 的会话不能直接作为 Claude 的原生会话恢复。需要跨客户端交接时，可另建会话并显式携带用户选择的上下文/摘要，不能伪装成无损续聊。

## 5. 建议实施顺序

1. **先补 Codex 会话管理**：会话列表/切换/保存、新建不清空其他会话、模型下一轮切换、运行中 steer/队列、停止状态与断线恢复。它无需等待 ACP 集成就能改善当前体验。
2. **再加入官方 ACP SDK 与两个 adapter 验证**：Claude Code ACP adapter 和 DeepSeek Harness ACP profile。先做创建、流式、停止、工具回传，再按能力启用列表/恢复/配置。
3. **最后扩展客户端**：优先已有公开 ACP/SDK 的客户端；WorkBuddy、Antigravity 按兼容性调研中实际能确认的接口单独验证，不把两者写进“已支持”名单。
4. **按需引入 UI 组件**：当前 React 界面可先保留。只有富消息、工具卡片、历史分支等确实增加复杂度时，再验证 `assistant-ui` 的 external-store 集成，不先全量替换侧边栏。

### 下一轮实现的验收门槛

- A 会话运行时切到 B，A 的增量、工具回调和完成状态不会出现在 B。
- 运行中插话、排队、停止后重发有独立测试；turn 刚结束和连接刚断开的竞态不丢消息、不重复发起。
- 模型选择按会话保存，服务端拒绝时回显原模型；steer 不夹带 model override。
- 刷新、扩展后台重启、本地进程退出后能区分“已恢复历史”和“已重连运行”，不伪造继续执行。
- 旧数据完整迁移；newChat 不删除其他会话或第三方客户端历史。
- 每个接入客户端都验证 BeeHelper MCP 贯通与微应用运行效果，不能只验证“聊天能回复”。

## 6. 验证范围

**已验证**：本地源码路径、官方文档内容、ACP SDK 固定 schema、Codex 0.145.0 的本机 schema。开源候选和各客户端的证据见两份配套调研。

**未验证**：新会话功能、ACP 端到端连接、Claude/dsh 真实模型调用、WorkBuddy/Antigravity 实际控制、跨客户端原生会话接管、任何提供方的订阅额度复用。在线文档可变，后续实现仍须固定版本和运行契约测试。

## 来源

- [O1] [OpenAI Codex App Server](https://developers.openai.com/codex/app-server.md)，本轮请求重定向至官方 `learn.chatgpt.com/docs/app-server.md`；核对 thread lifecycle、turn steering、model overrides。
- [A1] [ACP SDK README，固定快照](https://github.com/agentclientprotocol/typescript-sdk/blob/c2b1a8633745dd859a2732b4e17d5ed61e869bb6/README.md)。
- [A2] [ACP SDK package.json](https://github.com/agentclientprotocol/typescript-sdk/blob/c2b1a8633745dd859a2732b4e17d5ed61e869bb6/package.json)、[LICENSE](https://github.com/agentclientprotocol/typescript-sdk/blob/c2b1a8633745dd859a2732b4e17d5ed61e869bb6/LICENSE)。
- [A3] [ACP v1 schema，固定快照](https://github.com/agentclientprotocol/typescript-sdk/blob/c2b1a8633745dd859a2732b4e17d5ed61e869bb6/schema/v1/schema.json)。
- [A4] [ACP Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)、[Session List](https://agentclientprotocol.com/protocol/v1/session-list)。
- [A5] [ACP Session Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options)。
- [A6] [ACP Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)。
- [A7] [ACP Transports](https://agentclientprotocol.com/protocol/v1/transports)。
- [U1] [assistant-ui README](https://github.com/assistant-ui/assistant-ui/blob/42a7c084724488e917e26abd9ba7b27145815af1/README.md)、[MIT LICENSE](https://github.com/assistant-ui/assistant-ui/blob/42a7c084724488e917e26abd9ba7b27145815af1/LICENSE)。
- [U2] [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)。
- [W1] [WorkBuddy 官方 Open API](https://open.workbuddy.cn/docs/openapi)，核对准备工作、授权、本地助理、云端任务及 ACP 通道；本轮仅阅读文档，未申请授权或调用接口。
