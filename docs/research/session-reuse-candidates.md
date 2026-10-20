# 多 Agent 会话工作台与管理库复用候选

核验日期：2026-10-20。范围仅限现成工作台、会话管理库和适配器候选；不研究具体 WorkBuddy、Antigravity，也不展开 Codex 原生协议。本文是选型证据，不改变 BeeHelper 当前产品范围或实现方案。

## 结论

建议优先验证 **ACP adapters 的宿主侧整进程复用**，以 **AionUi/AionCore 的会话状态、队列和模型配置管理**作为设计参考。`agent-shell` 最值得借鉴的是明确区分 queue 与 steer；`HarnessAgent` 是可选统一 SDK，但其包装层可能损失底层能力；Happy 原版 CLI 的消息队列和事件归一化可局部复用，不建议为本地扩展引入完整远程同步产品。[A1][A2][I2][I3][V2][V4][H1][H3]

没有发现可以不经适配直接放入浏览器扩展、同时满足全部要求的现成候选。以下排序是依据源码依赖和边界作出的工程判断，**不是运行验收结果**：

| 顺位 | 候选 | 建议复用粒度 | 不建议搬入扩展的部分 |
| --- | --- | --- | --- |
| 1 | 现称 Agent Client Protocol 官方维护仓库中的 Claude/Codex ACP adapters | Native Host 外部子进程；保留会话、权限、模型、MCP 和子 agent 事件 | Node/SDK 运行时、文件系统和进程控制 |
| 2 | AionUi，连同其 AionCore 后端 | 抽取队列纯函数、状态分层、配置协调和相关测试思路；必要时另评估后端模块 | 整个 Electron/WebUI、HTTP/WS 服务、SQLite 和团队平台 |
| 3 | Vercel AI SDK HarnessAgent | 宿主侧会话/事件统一 SDK，按 adapter 验证能力 | sandbox/WebSocket bridge 及完整服务端 UI |
| 4 | agent-shell | queue/steer UX、能力门控、恢复与切换状态机参考 | Emacs Lisp/comint UI；不作为 TypeScript 运行时依赖 |
| 5 | Happy / Happy Coder 原版 CLI | 按模式分组队列、会话与 turn 事件映射、远程控制边界参考 | Expo 应用、relay、配对、账户和加密同步整栈 |

上述判断的源码依据分别见后文各候选。多后端独立会话、同一模型提供方的多个实例、模型内部子 agent、跨后端团队协作是四种不同能力，本文不将它们统称为“已支持多 agent”。

## 核验口径与版本

“已核实”表示在下列固定提交读到 README、LICENSE 或实际实现，不代表安装、构建或真实运行成功。版本号来自文件；只有明确比对过的 tag 才记为 tag。固定提交不是“未来最新版”承诺。

| 对象 | 实际审阅 commit | 版本与许可 |
| --- | --- | --- |
| `xenodium/agent-shell` | `6554be7471337943b135aa5f9f6fee013ffe624f` | 源码版本 `0.87.10`；文件头声明 GPL-3.0-or-later，根 LICENSE 为 GPLv3；未核对 release tag。[A0] |
| `iOfficeAI/AionUi` | `886dcbdeabeee77867daf47ed99548140f05b378` | Apache-2.0；未绑定 release tag。[I0] |
| `iOfficeAI/AionCore`，归入 AionUi 候选 | `503a87199eb978790ca77675b39c84b241535bf3` | Apache-2.0；独立后端快照，**未证明与上述前端为发布配对版本**。[I0][I1] |
| `slopus/happy` | `b99e7f83a4162b2ab6ed999fafa2398f9cc1d237` | MIT；未绑定 release tag；主要核实该仓库中的原版 CLI、移动/Web 客户端。[H0][H1] |
| `vercel/ai` | `a1db2092f9cbdf20b35c7d374c79a0aeceefef2a` | Apache-2.0；`@ai-sdk/harness` 文件版本 `1.0.157`，但同名 tag `@ai-sdk/harness@1.0.157` 指向 `0a5c786ef65bcd835328fb543685f6d8ef233dae`，**不是本文审阅提交**。[V0] |
| `agentclientprotocol/claude-agent-acp` | `7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1` | Apache-2.0；`v0.94.0` tag 与此提交一致。[P0] |
| `agentclientprotocol/codex-acp` | `a62b56847f473a2be6c67ea779c1ef9c7f227c38` | Apache-2.0；文件版本 `2.2.2`，但 `v2.2.2` tag 指向 `202e66e63343ec4f5a5e35ab590251d813d129ca`，能力以本文 commit 为准。[P0] |

许可记录仅用于识别复用边界，不替代依赖、第三方资源及最终分发方式的合规审查。尤其不能把 GPL 的 agent-shell 源码当作 MIT/Apache 模板直接复制；本轮建议只借鉴交互与状态语义。根仓库许可也不能自动覆盖被调用的模型运行时和服务条款。[A0][I0][H0][V0][P0]

## 1. agent-shell：交互语义参考

身份：Emacs 的 ACP 客户端，依赖 `acp.el`、`shell-maker`、Emacs 29.1；不是可直接导入扩展的 JS 会话库。README 列出真实 ACP agent 接入路径，区别于只提供模型 API 的聊天壳。[A0][A1]

| 维度 | 已核实能力与边界 |
| --- | --- |
| 切换/恢复 | `agent-shell-switch-buffer` 切换独立 shell；`agent-shell-resume-session` 用指定 agent 配置和 session ID 新建恢复 shell。按能力使用 `session/load`（带历史回放）或 `session/resume`（不回放）；不同 restore style 有降级逻辑。不能据此保证所有 agent 支持恢复。[A1][A3] |
| 运行中 queue | 默认忙时输入排队，turn 结束后处理；同一 turn 累积的提示默认合并，可配置逐条发；可查看、移除、继续。队列位于 shell state，**不应据此宣称跨 Emacs/Host 重启持久化**。[A2] |
| 运行中 steer | 显式命令与 queue 分离；检查初始化响应顶层 `_meta.steering.supported`，调用扩展 `_session/steering`。不支持时显式 steer 报错，忙时快捷策略可回退 queue。它不是所有 ACP agent 必备的标准能力，也不保证“追加而不替换”当前指令。[A2][A4] |
| 模型 | 从 agent 返回的 config options/legacy models 生成选择项，经会话配置方法设置；不是通过模型名称猜客户端。[A5] |
| MCP | 全局或每 agent 配置；传入会话创建/恢复路径；HTTP/SSE 依赖 agent 能力。只是配置入口，不表示所有 agent 接受所有传输。[A6] |
| 多 agent | 可以同时持有多个独立 agent shell。README 的跨 agent 协作管理器属于相关扩展，**不能归为核心内置团队调度**。[A1] |

**复用建议：**参考“忙时输入仍可编辑”“排队与纠偏分别呈现”“能力未声明就不显示可用”“恢复历史与恢复执行分离”。不移植 Emacs UI，也不为复用该产品引入 Emacs 常驻进程。需要自行实现 BeeHelper 的浏览器状态与 Native Host 映射；这是工程判断。

## 2. AionUi/AionCore：最完整的工作台管理参考

当前 README 明确开发需要 AionUi Electron 前端与 AionCore 本地后端两个仓库；前端 `ipcBridge.ts` 已把主要业务操作转换为 HTTP REST/WS，部分 Electron 原生功能仍保留 IPC。因此不能沿用“一个 Electron 文件即可抽出全部管理逻辑”的假设。[I1][I4]

| 维度 | 已核实能力与边界 |
| --- | --- |
| 切换/恢复 | 前端按 `conversation_id` 隔离，提供 runtime ensure/restart；后端 `open_session_resume` 按后端能力选择恢复方式，并恢复模型/配置状态。若 session 失效，可清掉旧 ID 重新 `session/new`；没有恢复能力的 legacy 分支仅保留 ID 尝试继续。**显示旧聊天记录不等于原执行上下文恢复成功**。[I4][I5] |
| 运行中 queue | `useConversationCommandQueue` 有 busy gate、manual/auto、暂停、重排、优先、失败回填及后台完成事件处理；按 conversation 分桶，并写 `window.sessionStorage`。默认 manual；上限 20 项、单提示 20,000 字符、状态 256 KiB。此存储不构成跨浏览器重启的持久队列保证。[I2] |
| 运行中 steer | queue 的 `sendNow` 只是立即尝试 `onExecute`，busy 时回填等待，**不是 steer 的证据**。Team 有独立 `/interrupt` 接口和 `queued_policy`；本轮未核完其后端执行链，不能将“interrupt + message”标成所有后端的原生 steering。[I2][I4] |
| 模型 | `useAcpModelInfo` 使用 config option，单独跟踪模型目录、运行时 ready、设置中及失败；`canSwitch` 受真实目录与配置阻塞状态约束。AionCore 将 desired、observed、advertised 分层并通过 reconcile 协调，不把 UI 乐观选值当已生效值。[I3][I6] |
| MCP | 后端 assembler 实际合并 team MCP 与用户 MCP，放入新建会话请求；恢复 load 路径也带 MCP。Team stdio 服务使用 `mcp-team-stdio` 子命令。未核实所有后端传输过滤和运行中热更新行为。[I5][I7] |
| 多 agent | README 声明独立并行会话及 Leader/Teammate Team。代码中 `team_spawn_agent` 实际调用 service 的 `spawn_agent_in_session`；消息走 `send_agent_message_from_agent`，任务通知注明忙时排队到 turn boundary。不是只有 UI 画了“团队”，但整条调度/隔离/恢复链仍未运行验证。[I1][I8] |

**重要文档漂移：**AionCore `docs/mcp.md` 保留“spawn 空壳、stdio bridge 未实现”的旧描述，同时又注明部分章节过时；当前 assembler 和 MCP server 已包含对应调用，不能照抄旧 GAP 表作为当前事实。本文以读到的实现为准，未进一步宣称 Team 全部能力成熟。[I7][I8][I9]

**复用建议：**优先参考队列归一化/验证/失败回填等纯函数及对应测试，替换其 IPC、SWR、Arco、i18n、runtime store 和存储耦合；`useConversationCommandQueue.ts` 本身仍是产品 hook，不是独立通用包。桥侧可借鉴 desired/observed/advertised 与失效 session 的处理，但 BeeHelper 应显式显示“上下文重建”，避免静默冒充恢复。全量引入 AionCore 会增加 Rust 服务、数据库、团队/文件工作区等产品边界，首版收益未证实。[I2][I6][I4]

## 3. Happy / Happy Coder：先分清代际与仓库

原版 `happy-coder` 已迁至 npm `happy`；当前 `slopus/happy` README 区分移动/Web 客户端、原版 CLI、relay，以及独立的 `happy-desktop`、`happy-agent` 运行时仓库。**同仓 `packages/happy-agent` 是旧 CLI 的远程控制，不是新 Happy Agent runtime。**官网原版 CLI 文档标为维护模式；当前首页的多模型/团队宣传不能直接归到旧 CLI。[H1][H2]

| 维度 | 已核实能力与边界 |
| --- | --- |
| 切换/恢复 | App 按 session ID 路由并以 ID 为 key 重建会话本地状态。CLI 有 `happy resume <id>`；解析 Happy session 元数据需要 relay 记录及解密链，Claude 路径检查 session 后通过 SDK resume；不是无服务依赖的纯本地会话索引。[H2][H4][H5] |
| 运行中 queue | `MessageQueue2` 将消息与 mode hash、附件绑定，相同模式可批量合并，特殊消息可隔离；Claude remote 在 result 后请求下一条。`pushImmediate` 只是入队并唤醒 waiter，**不代表立即注入运行中 turn**。[H3][H5] |
| 运行中 steer | 已核实独立 abort 控制；本轮审阅的旧 Claude 主路径以 result 边界消费新输入，未证实统一原生 steer。不能用首页的 “either can steer” 宣传或新 runtime 行为为旧 CLI 背书。[H1][H5][H6] |
| 模型 | App 有模型/effort 会话设置，CLI 把 model 等纳入模式 hash；切换后可能通过重建 query 应用，不是证明模型生成途中热切换成功。[H5][H6][H7] |
| MCP | Claude remote 把 `mcpServers` 传入 SDK query；局部可复用配置和事件映射。未核实所有后端统一传输、动态变更与 BeeHelper 工具回传。[H5] |
| 多 agent | 原版 CLI 可启动不同后端与多个会话；`AcpSessionManager` 归一化 turn、stream 与工具事件，不是跨后端协作调度器。新产品宣称的多模型子 agent/团队属于其他运行时，本轮未作代码背书。[H1][H2][H8] |

**复用建议：**MIT 的队列与 `AcpSessionManager` 事件归一化是小粒度候选，仍须去掉 logger/path alias、核实 `happy-wire` 包及相关依赖。对于扩展 + 本地 Native Host，不建议为本地消息交换额外引入 relay、账户配对与端到端加密同步整栈；远程手机接管不在本轮 BeeHelper 需求内。也不把 Happy 的“订阅复用”宣传当作任意客户端授权或额度共享结论。[H0][H1][H3][H8]

## 4. Vercel AI SDK HarnessAgent：统一库，不是工作台

官方确有 `HarnessAgent`；README 明确 experimental。它归一化已有 harness，不应与只调用模型并执行工具循环的抽象混同。[V0][V1]

| 维度 | 已核实能力与边界 |
| --- | --- |
| 切换/恢复 | 调用方持有多个 session，每次调用传目标 session；`createSession({sessionId,resumeFrom})` 恢复，`continueFrom` 续接未结束 turn。契约区分 live attach/replay 与 runtime 丢失后的有损 rerun，**不是全部情形无损恢复**；没有现成会话列表 UI。[V2] |
| 运行中 queue | 同一会话执行中再提交新 turn 报错，未提供自动用户提示队列，需上层管理。[V3] |
| 运行中 steer | `experimental_steerTurn` 依赖 adapter 的 `submitUserMessage`，不具备则拒绝。Claude bridge 使用 `priority: 'next'`，不保证马上打断；**该快照 ACP 包装层未返回 `submitUserMessage`，底层 ACP adapter 支持 steer 也不能穿透为此路径已有能力**。[V3][V4] |
| 模型 | `model` 是具体 runtime 的标识，可经 `prepareCall` 在 turn 间选择，不是任意桌面客户端选择器。[V5] |
| MCP | Claude 配置接受 `mcpServers`；ACP bridge 合并外部 MCP 与宿主工具 MCP。没有证据保证所有 adapter 都能运行中热更新。[V6] |
| 多 agent | 可持有多个实例/会话；Claude adapter 有原生 Agent 工具与子 agent 事件配置，不等于内置跨后端团队编排平台。[V7] |

**复用建议：**当 BeeHelper 真正需要多种 harness、且接受 SDK 的统一事件/会话契约时，在 Node Native Host 侧评估它。现成 bridge 是 WebSocket server，不是 Native Messaging Host；不为了采用 SDK 而把整个 sandbox/远程部署体系引入扩展。优先验证“包装前有、包装后没有”的能力损失，再决定是否直接走 ACP。[V4][V8]

## 5. Zed ACP adapters：现成控制接入的首选候选

应使用迁移后的 `agentclientprotocol/claude-agent-acp` 与 `agentclientprotocol/codex-acp`。旧 Zed Codex adapter 仓库已归档且 README 指向新实现；旧 Claude 地址重定向到新仓库。“官方”在此指项目维护方，不表示都由模型厂商维护，也不表示连接 Zed 桌面客户端。[P0][P1]

| 维度 | Claude adapter | Codex adapter |
| --- | --- | --- |
| 切换/恢复 | 按 session ID 管理；`resumeSession` 与带历史回放的 `loadSession`。[P2] | 有 load 历史回放与 resume；切换由客户端/Host 路由，不自带工作台 UI。[P3] |
| 运行中 queue | 普通 prompt 建独立 Turn 并入 `turnQueue`。[P4] | 同一会话普通 prompt 使用 turn-start FIFO 等待。[P5] |
| 运行中 steer | `_session/steering`，运行中不新建 Turn；通常 `now`，等待权限/询问时可 `later`，空闲可返回 `promptRequired`。README 说明 steering 当前仅 v1。[P6] | 运行中注入并返回 `injected`；空闲可降级新 turn。`SteeringQueue` 串行化的是 steer 请求，**不是等当前 turn 完成的 follow-up queue**。[P7] |
| 模型 | session config option，最终通过 SDK `setModel`。[P8] | 根据可用模型生成 config options，接受会话配置更新。[P9] |
| MCP | session 请求转换 stdio、HTTP、SSE 配置。[P10] | 支持 stdio、HTTP；该快照明确拒绝 SSE 和 ACP transport。[P11] |
| 多 agent | 多 root 会话；协商后可呈现独立 child session、定向 cancel，但不能任意 prompt/修改 child。[P12] | 双向能力协商后呈现 child 历史；当前不支持定向 child cancel/close，权限走 root。不能因此在 UI 显示全部 child 均可独立控制。[P13] |

**复用建议：**保留 adapter 为 Host 管理的外部进程，复用其公开 ACP 会话与能力契约。扩展负责会话列表和可见状态；Host 负责进程、传输转换、请求映射和持久绑定。它们的 stdio 入口已实现，但不是浏览器 Native Messaging Host，仍需 BeeHelper 桥接。[P14]

这证明可启动/控制适配器自己的会话，**没有证明接管用户已在其他 GUI 中打开的任意会话**。同样，“支持 Claude 模型”不是“接入 Claude 客户端”，“支持 Gemini API”不是“连接 Gemini CLI”；必须分别核实进程入口、会话 ID、恢复方法和实际运行时。[I1][H1][P1]

## BeeHelper 的建议边界与最小验证

以下是基于上述实现推导的集成建议，不是新增既定架构：

1. **扩展只管理视图与意图。**会话绑定至少区分 BeeHelper conversation ID、后端类型、外部 session ID、进程代次、当前 turn 和事件位置。切换视图不取消旧任务，不把旧任务事件投到当前聊天。
2. **Host 复用运行时，不重写 agent loop。**先直接复用一种 ACP adapter，或对照验证 HarnessAgent；不同时组合两套控制层。Native Messaging 与 adapter NDJSON 需要不同的编码处理，不能直接透传其 stdio 字节。[P14][C1]
3. **queue/steer/cancel 是三个动作。**queue 在明确 turn boundary 发下一条；steer 需能力声明、确认结果及竞态处理；cancel 不等于回滚工具副作用。拒绝/断连不能在 UI 中显示“已纠偏”。agent-shell 与 adapters 的不同降级行为正说明不能统一猜测。[A2][A4][P6][P7]
4. **队列只选一个权威所有者。**不要同时在扩展、Host、SDK 各排一次而失去可见顺序；需要定义待投递、后端已接收、运行中、失败、投递结果未知。AionUi 的失败回填值得参考，但其 sessionStorage 不能原样承担 BeeHelper 的重启恢复。[I2][V3]
5. **恢复分级呈现。**本地历史可读、外部上下文恢复、仍在运行的 turn 重连、有损重新运行分别标注。恢复失败不静默重放有副作用的提示或工具；AionCore 的 stale-session 新建路径、HarnessAgent 的 rerun 契约尤其需要显式处理。[I5][V2]
6. **MCP 按会话注入。**由 Host 提供 BeeHelper 浏览器/微应用工具入口；依据后端能力选择传输，不修改用户全局配置、不把浏览器工具与任意本机文件系统权限混成一套。注入后有工具声明不等于真正完成扩展往返；仍需验证。[I7][V6][P10][P11]
7. **模型以 observed 为准。**记录请求值、后端已确认值、可选目录；能力不支持时禁用切换并说明，不以 UI 下拉框变化作为执行成功。不要靠模型名字推导客户端身份。[I3][I6]

后续无需先用真实模型也可做的契约测试：

| 场景 | 通过条件 |
| --- | --- |
| 两个假 agent 同时 streaming，反复切换 | 按 conversation/session/turn 正确归属；后台事件不丢、不串话 |
| busy 时 queue 三条，steer 一条 | 能区分等待下一轮与注入本轮；拒绝/不支持/空闲竞态有明确结果 |
| 切换模型后再发消息 | 后端确认的模型才算成功；busy/失败不错误更新 observed |
| Host 断连与重启 | 区分可恢复、需新会话、运行结果未知；不盲目重放 |
| MCP 假工具往返与权限请求 | 工具结果回原 session/turn；取消后迟到结果不误投其他会话 |
| 子 agent 事件 | 按 adapter 能力决定展示/取消权限，不假设 child 可任意发消息 |

## 验证范围

已完成：阅读官方公开 README、LICENSE 和上述实际实现；记录固定提交及部分 tag 差异；对源码与旧文档冲突明确标注。网络搜索工具未返回内容，改用 GitHub 官方仓库的 git、API、raw 与源码归档。大型仓库全量 checkout 未完成即停止，涉及结论的文件通过固定 commit 的官方 raw 源读取。

文档静态校验：51 组来源编号无缺失；77 个固定提交源码链接均可读取，行号锚点未越界；新增文件空白检查无报错。此检查只验证引用结构与可访问性，不替代功能验证。

未完成：项目依赖安装、构建、测试运行、真实模型调用、真实会话恢复或 steering 效果、Native Messaging 端到端接入、全传递依赖许可审计。未启动模型或候选产品。来源与结论不依赖本机凭据或公司内部资料。本文是静态源码调研，不能作为上线兼容性证明。

本轮只新增本文件；不修改 README、现有协议文档或源码，不提交或推送。

## 固定来源

以下 GitHub 链接均锁定本轮实际审阅 commit；官网页面与 Chrome 文档为核验当日页面，可能变化。每项代码引用列出文件/关键行或函数，便于复查；未使用社区文章为能力背书。

- [A0] agent-shell [源码版本、依赖、GPL 声明](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L1-L29)、[LICENSE](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/LICENSE)。
- [A1] [README：身份、相关扩展、多个 shell](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/README.org)。
- [A2] [prompt queue：process-next、enqueue、steer、busy 策略](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell-prompt-queue.el#L78-L443)。
- [A3] [resume-session](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L1728-L1741)、[load/resume 选择与恢复](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L8135-L8478)；`agent-shell-switch-buffer` 位于同文件 2068 行起。
- [A4] [steering-supported-p](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L2482-L2490)、[steering 扩展与结果处理](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell-experimental.el#L174-L331)。
- [A5] [config option 与模型目录](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell-config.el#L269-L340)、[模型设置入口](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L11314-L11364)。
- [A6] [MCP 配置](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L1190-L1260)、[会话请求携带 MCP](https://github.com/xenodium/agent-shell/blob/6554be7471337943b135aa5f9f6fee013ffe624f/agent-shell.el#L8429-L8439)。
- [I0] [AionUi LICENSE](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/LICENSE)、[AionCore LICENSE](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/LICENSE)。
- [I1] [AionUi README：Multi-Agent、Team、Development Setup](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/readme.md)。
- [I2] [会话队列实现](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/packages/desktop/src/renderer/pages/conversation/platforms/useConversationCommandQueue.ts)、[drain 测试源码，未执行](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/tests/unit/conversation/runtime/conversationCommandQueueDrain.dom.test.tsx)。
- [I3] [useAcpModelInfo](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/packages/desktop/src/renderer/hooks/agent/useAcpModelInfo.ts)。
- [I4] [前端 HTTP/WS adapter：runtime、conversation、team、MCP 接口](https://github.com/iOfficeAI/AionUi/blob/886dcbdeabeee77867daf47ed99548140f05b378/packages/desktop/src/common/adapter/ipcBridge.ts)。
- [I5] [open_session_new/resume/fork](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-ai-agent/src/manager/acp/agent_session_flow.rs#L34-L302)。
- [I6] [AcpSession：Desired/Observed/Advertised、配置 lease、plan_reconcile](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-ai-agent/src/manager/acp/session.rs)。
- [I7] [ACP assembler 与 MCP 合并](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-ai-agent/src/factory/acp_assembler.rs#L43-L123)。
- [I8] [Team 消息路由](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-team/src/mcp/server.rs#L835-L875)、[spawn 的实际 service 调用及任务通知语义](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-team/src/mcp/server.rs#L1020-L1120)。
- [I9] [Team MCP 文档：含旧 GAP 与过时章节警告](https://github.com/iOfficeAI/AionCore/blob/503a87199eb978790ca77675b39c84b241535bf3/crates/aionui-team/docs/mcp.md)。
- [H0] [Happy LICENSE](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/LICENSE)。
- [H1] [Happy 根 README：当前产品与各仓库/目录分工](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/README.md)。
- [H2] [原版 CLI README](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/README.md)、[官网原版 CLI 文档，维护模式](https://happy.engineering/docs/)。
- [H3] [MessageQueue2：pushImmediate、隔离、模式批处理](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/utils/MessageQueue2.ts)。
- [H4] [App 会话路由](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-app/sources/app/%28app%29/session/%5Bid%5D.tsx)、[恢复记录解析流程](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/resume/resolveHappySession.ts)；这里只读公开实现，未调用其凭据访问函数。
- [H5] [claudeRemote：resume、MCP、model、result 后 nextMessage](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/claude/claudeRemote.ts)。
- [H6] [remote launcher：abort、模式变化与 query 生命周期](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/claude/claudeRemoteLauncher.ts)、[CLI 模式 hash 与消息入队](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/claude/runClaude.ts#L524-L568)。
- [H7] [SessionView：模型设置、发送与 abort](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-app/sources/-session/SessionView.tsx#L920-L1016)。
- [H8] [AcpSessionManager：turn 与工具事件归一化](https://github.com/slopus/happy/blob/b99e7f83a4162b2ab6ed999fafa2398f9cc1d237/packages/happy-cli/src/agent/acp/AcpSessionManager.ts)。
- [V0] AI SDK [LICENSE](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/LICENSE)、[harness/package.json](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/package.json)、[1.0.157 tag](https://github.com/vercel/ai/tree/%40ai-sdk%2Fharness%401.0.157)。
- [V1] [HarnessAgent experimental README](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/README.md#L1-L5)。
- [V2] [createSession](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/agent/harness-agent.ts#L154-L166)、[恢复参数](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/agent/harness-agent.ts#L310-L337)、[恢复保证契约](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/v1/harness-v1-session.ts#L234-L266)。
- [V3] [steer 能力门控](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/agent/harness-agent-session.ts#L430-L470)、[busy 时禁止新 turn](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/agent/harness-agent-session.ts#L705-L710)。
- [V4] [Claude steer priority](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-claude-code/src/bridge/index.ts#L998-L1004)、[ACP 返回控制对象，未暴露 submitUserMessage](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-acp/src/v1/acp-v1-harness.ts#L1553-L1612)。
- [V5] [HarnessAgent 文档：runtime model 与 prepareCall](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/content/docs/03-ai-sdk-harnesses/02-harness-agent.mdx)。
- [V6] [Claude MCP 配置](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-claude-code/src/claude-code-harness.ts#L96-L99)、[ACP MCP 合并](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-acp/src/v1/bridge/index.ts#L609-L635)。
- [V7] [Agent 工具配置](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-claude-code/src/claude-code-harness.ts#L105-L114)、[子 agent 事件](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness-claude-code/src/claude-code-harness.ts#L315-L324)。
- [V8] [现成 WebSocket bridge](https://github.com/vercel/ai/blob/a1db2092f9cbdf20b35c7d374c79a0aeceefef2a/packages/harness/src/bridge/index.ts#L945-L948)。
- [P0] Claude adapter [LICENSE](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/LICENSE)、[v0.94.0 tag](https://github.com/agentclientprotocol/claude-agent-acp/tree/v0.94.0)；Codex adapter [LICENSE](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/LICENSE)、[package.json](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/package.json)、[v2.2.2 tag](https://github.com/agentclientprotocol/codex-acp/tree/v2.2.2)。
- [P1] [Claude adapter README](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/README.md)、[新 Codex adapter README](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/README.md#L1-L7)、[归档旧仓库迁移声明](https://github.com/zed-industries/codex-acp/blob/296069e841634cd4bb9bc4515602d836e49231ec/README.md#L3-L7)。
- [P2] [Claude resume/load](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3144-L3169)。
- [P3] [Codex load](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L1569-L1598)、[resume](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L1649-L1673)。
- [P4] [Claude turnQueue](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L3919-L3950)。
- [P5] [Codex 普通 prompt FIFO](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L4215-L4235)。
- [P6] [Claude steering 实现](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L4285-L4341)、[README v1 限定](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/README.md#L96-L107)。
- [P7] [Codex steering](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L2643-L2672)、[SteeringQueue 语义](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/SteeringQueue.ts#L9-L12)。
- [P8] [Claude 模型选项](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L8940-L8957)、[setModel](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/session-model.ts#L543-L549)。
- [P9] [Codex 模型目录](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L2864-L2893)、[配置更新](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/CodexAcpServer.ts#L2411-L2423)。
- [P10] [Claude MCP 转换](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/acp-agent.ts#L11029-L11051)。
- [P11] [Codex MCP 支持与拒绝的 transport](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/McpServerConfig.ts#L39-L65)。
- [P12] [Claude 子 agent 会话边界](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/README.md#L38-L94)。
- [P13] [Codex 子 agent 协商与控制限制](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/docs/subagent-sessions.md#L5-L28)。
- [P14] [Claude NDJSON stdio 入口](https://github.com/agentclientprotocol/claude-agent-acp/blob/7bcbfc7a5ca7ab9c7eece4f0749ccaf49c7ba7e1/src/serve.ts#L18-L28)、[Codex stdio 入口](https://github.com/agentclientprotocol/codex-acp/blob/a62b56847f473a2be6c67ea779c1ef9c7f227c38/src/index.ts#L75-L95)。
- [C1] [Chrome Native Messaging host protocol](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-protocol)。
