# 外部 Agent 接入可行性

调研日期：2026-10-18。本文是技术研究，不是已经批准的产品架构。

## 结论

- 能从 BeeHelper 发起任务、由现成外部 harness 执行，再把进度和工具结果呈现在 BeeHelper。ACP、Codex App Server、Claude Agent SDK 都有相关控制接口，但不是相同协议，也不能据此声称可以控制任意桌面客户端。[S1][S2][S3]
- 外部方案不是只转发聊天：还需要连接会话、注入浏览器工具、关联工具执行结果，以及同步微应用源码和运行状态。这是 BeeHelper 的集成工作，不会由换用协议自动完成。此项是根据控制接口与工具接口的分离作出的工程判断。[S1][S2][S4]
- 建议先选择一个现成 harness 和一条控制通路验证，保留可替换连接器，不在首版同时适配所有客户端。此项是建议，尚待用户决定。

## 1. 控制 Agent 与暴露工具是两条通路

ACP 定义客户端与 agent 的会话、消息和生命周期。MCP 用于向 agent 提供工具与数据；ACP 创建会话时可以声明 MCP server，HTTP/SSE 支持需要能力协商，不能默认所有 agent 一致。[S1][S4]

候选调用关系：

```text
BeeHelper 对话界面
  -> 外部连接器 / 本地桥接程序
  -> 已有 harness 的会话与执行循环
  -> BeeHelper 暴露的浏览器与微应用工具
  -> 扩展执行、回传观测结果
  -> 外部 harness 继续执行
```

以上是集成示意，不是已实现的代码。浏览器工具执行通路可以使用 MCP，也可以使用某个 harness 的客户端工具回调，需随连接器实测。

## 2. 候选控制接口

| 候选 | 已确认接口 | 对 BeeHelper 的意义 | 不能据此推导 |
| --- | --- | --- | --- |
| ACP | JSON-RPC；标准 stdio；自定义传输；会话创建与续接能力协商 | 多 agent 的统一控制协议候选 | 标准化 HTTP 已可用、所有 agent 原生兼容 |
| DeepSeek Harness ACP profile | `dsh --profile acp`；标准 ACP v1；会话及 MCP 声明 | 可以在 Node 环境直接复用 dsh，不必先移植到浏览器 | 已脱离 Node、浏览器扩展可启动它 |
| Codex App Server | 双向 JSON-RPC；线程、turn、流式事件；stdio；实验性 WebSocket | 比驱动聊天界面更适合嵌入自己的产品 | 任意 Codex 桌面会话均可接管、WebSocket 已生产就绪 |
| Claude Agent SDK | Python/TypeScript 调用 Claude Code binary；会话、上下文、工具、hooks | 在本地桥接程序或服务端中复用完整循环 | 只是一个可直接打包进浏览器的纯 JS harness |

依据分别为 [S1][S2][S3][S5]。各接口的命令与 schema 应锁定具体版本，不能跟随主分支无条件升级。

### ACP 的现实边界

当前官方传输文档把 Streamable HTTP 标为草案；stdio 路径由客户端启动子进程并读写其标准输入输出。因此浏览器侧采用标准 stdio ACP 时，需要浏览器之外的进程承接，或由已存在的网络服务转换传输；这不是安装 PWA 能自动解决的事。[S1]

### Codex 的现实边界

官方文档提供 `thread/start`、`turn/start`、增量事件和取消等接口；`dynamicTools` 与客户端 `item/tool/call` 是实验性能力，也可通过配置的 MCP server 提供工具。[S2]

WebSocket 传输当前被官方标为实验性、不支持生产负载。其鉴权描述要求握手携带 Bearer header，而浏览器标准 `WebSocket` 构造函数只接受 URL 和子协议，没有任意 header 参数。因此不能直接假定浏览器可按 Node 客户端写法连接鉴权服务，需要实测并设计受支持的桥接方式。[S2][S6]

文档对带 `Origin` 的 HTTP 健康检查请求有拒绝说明；本次没有据此推断所有 WebSocket 握手的行为，也没有完成相关兼容性实测。[S2]

### Claude 的现实边界

官方把 Agent SDK 定义为在应用所管理的进程中运行 Claude Code binary 的库，而不是仅调用 Claude 模型的 Client SDK。它有完整循环与上下文管理，适合在外部进程复用。[S3]

官方另明确：未经预先批准，不允许第三方产品提供 claude.ai 登录或额度复用。不能把“连接用户已有客户端”直接写成所有厂商都支持的额度复用承诺；具体接入模式需要按提供方核实。[S3]

Codex 官方也区分本地/开源应用与商业/托管服务的认证使用边界。本次不提供额度复用或商用授权结论，后续选择认证方案时必须重新核对。[S2]

## 3. 可复用的统一适配层：AI SDK HarnessAgent

Vercel 官方提供独立于模型 provider 的 `HarnessAgent` 抽象，可对接既有 harness；官方适配表列出 Codex、Claude Code、Pi、OpenCode 等，并统一会话、工具和流式输出。官方明确整个 harness 系列处于实验阶段。[S7][S8]

它不是把这些完整 harness 搬进浏览器。官方示例为 Claude/Codex 使用网络 sandbox 与 bridge；Pi 等使用 host process。`@ai-sdk/harness-acp` 的官方 README 也描述了在 sandbox 中启动 ACP 实现、通过 WebSocket bridge 通信的模式。[S8][S9][S10]

因此它可以作为“如何归一化多 harness”的参考或外部服务候选，不能直接认定为 BeeHelper 的零适配浏览器依赖。本次没有安装或运行这些包，也未核验所有 adapter 的实际可用性。

AI SDK 的 `ToolLoopAgent` 是另一层抽象：模型、工具、上下文和停止条件的循环。官方文档明确把它与复用完整 runtime 的 `HarnessAgent` 分开，不能把通用 tool loop 当作完整 coding harness 的现成替代。[S11]

## 4. 对产品定位的影响

以下均为调研后的建议，而非已决定事项：

1. BeeHelper 主入口不变；外部 agent 运行在哪里不必改变用户的对话入口。
2. 首版优先复用已有 harness，重点开发浏览器工具、微应用源码工作区、即时运行与观测。
3. 本地桥接程序只负责传输、进程和工具连接，不重新实现 agent loop。
4. 如果选择仅外部 agent，必须明示：AI 创作与调试需要连接该运行环境；微应用的确定性运行可以另行设计为不依赖 agent。
5. 浏览器中的基础 agent 可保留为候选插件，是否进入首版由浏览器 harness 调研和小型验证决定，不能提前承诺。

## 5. 验证范围

已验证：逐项读取官方文档、官方仓库 README，以及 AI SDK 的 `ToolLoopAgent` 与 harness package 配置。

未验证：真实 ACP/Codex/Claude 会话、跨扩展工具回传、源码热更新、长任务恢复、厂商账户与额度、所有 adapter 的兼容性。没有启动外部 agent，没有读取本机凭据，也没有修改任何客户端配置。

## 来源

- [S1] ACP Transports：https://agentclientprotocol.com/protocol/v1/transports.md
- [S2] OpenAI Codex App Server：https://developers.openai.com/codex/app-server.md
- [S3] Claude Agent SDK Overview：https://code.claude.com/docs/en/agent-sdk/overview.md
- [S4] ACP Session Setup：https://agentclientprotocol.com/protocol/v1/session-setup.md
- [S5] DeepSeek ACP profile：https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/acp-app/README.md
- [S6] MDN WebSocket constructor：https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/WebSocket
- [S7] AI SDK Harness Overview：https://ai-sdk.dev/docs/ai-sdk-harnesses.md
- [S8] AI SDK Harness Adapters：https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters.md
- [S9] AI SDK HarnessAgent：https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent.md
- [S10] AI SDK ACP adapter：https://github.com/vercel/ai/blob/main/packages/harness-acp/README.md
- [S11] AI SDK Agents Overview：https://ai-sdk.dev/docs/agents/overview.md
