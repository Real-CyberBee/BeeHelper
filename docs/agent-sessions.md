# 会话管理与 Agent 插件

版本：0.2.0 会话基础，沿用至 0.3.0。日期：2026-10-20。富输入、命令、引用和附件见[会话交互](chat-interactions.md)。此前[调研](research/session-management.md)是选型依据，不等于每个客户端都已完成真实模型验收。

## 本机升级

先停止旧版本任务，再执行：

```sh
npm ci
npm run build
npm run setup:native
```

在 `chrome://extensions/` 重新加载 BeeHelper，重新打开原生侧边栏。**不要卸载扩展**，不要清空扩展数据。版本 1 的 `chat/threadId` 自动迁移为一个 Codex 会话；微应用、版本及运行记录保留。`chat/threadId` 继续作为兼容投影，但版本 2 的会话数组是数据源，不承诺旧 UI 可以完整管理新格式。

“AI 会话”右上选择 Agent，再点新建图标。每个会话固定一个 Agent；切换列表只切换视图，不会停止旧任务。归档不删除 Agent 原生历史，恢复归档后仍可连接。

## 接入范围

| 插件 | 当前实现 | 本机验证边界 |
| --- | --- | --- |
| Codex | 原生 App Server；恢复、模型列表、逐轮模型选择、steer、停止、MCP | 真实握手；其他执行验证以验证记录为准 |
| Claude Code | 官方 ACP TypeScript SDK + `claude-agent-acp`；模型配置、恢复、协商 steering、授权、MCP | 真实握手与配置目录；不等于完整模型生成验收 |
| DeepSeek Harness | `dsh --profile acp`；模型配置、恢复、停止、MCP | 真实握手；本机未声明 steering，使用队列 |
| CodeBuddy Code | 独立 CLI `--acp` 接入入口 | 未找到可单独启动的独立 CLI，未完成握手；不将 WorkBuddy 附带文件直接当作可用安装 |
| WorkBuddy | 安装检测、未就绪原因 | 未实现官方 Open API 适配；不读取桌面私有凭据，不伪报已连接 |
| 自定义 ACP | 忽略目录中的本机插件配置 | 随具体实现协商能力，未做全部客户端验收 |

连接器兼容保留原 Native Messaging 名称 `io.beehelper.codex`，因此现有扩展 ID 和注册路径不变；名称不再意味着只能连接 Codex。

安装器发现 PATH、用户 `.local/bin`、常见系统目录及 nvm Node 版本目录下的可执行文件。可在执行安装器时用 `BEEHELPER_CODEX`、`BEEHELPER_CLAUDE`、`BEEHELPER_DSH`、`BEEHELPER_CODEBUDDY` 指定绝对路径。安装器只保存可执行文件路径，不复制认证材料。JS 启动器优先使用同一 bin 目录中的 Node，避免 dsh 被不兼容的宿主 Node 静默跳过。

## 消息、模型与恢复语义

- **排队发送**：运行期间继续输入，消息和当时的微应用/页面上下文保存在本地；当前任务成功结束后按顺序发出。队列的模型取实际投递时该会话所选的模型。
- **追加当前任务**：只有后端明确声明支持时可选。Codex 走 `turn/steer`；兼容 ACP 走协商扩展 `_session/steering`，请求闲时不要自动另开一轮。失败不悄悄变成另一项业务操作。
- **停止**：先请求停止，最终结束通知到达后才显示就绪。队列暂停，必须手动继续。停止不回滚网页、副作用或外部后台任务。
- **模型切换**：空闲 ACP 会话等待 `set_config_option` 确认；Codex 原生模型覆盖随下一次 `turn/start` 应用。运行期间的选择保存为下一轮设置，不夹入 steer 请求。
- **结果未知**：进程退出、后台重启或连接丢失不代表任务已失败。保留记录、暂停队列，不自动重放；用户先恢复连接并核实外部状态。
- **恢复**：优先使用 ACP resume，避免重复回放已有本地历史；只支持 load 的实现，其回放不重复追加为新回复。只管理 BeeHelper 已保存的会话，不扫描或批量导入个人客户端历史。
- **授权**：来自 Agent 的工具审批在所属会话展示，不自动允许未知本机操作；多个请求按序显示。未实现的协议交互明确失败，不伪造授权成功。

若空会话尚未被 Agent 持久化，退出后的原生恢复可能失败；错误会保留并显示，不会用新上下文冒充原会话。外部 Agent 保留其自身进程能力与认证规则，BeeHelper 不宣称为它建立了通用 OS 沙箱。

## 模块与插件 Interface

```text
src/components/AgentChat.tsx        会话视图与用户意图
src/core/sessions.ts               类型、迁移、归属校验、状态归约
src/agents/session-service.ts      会话插件：投递、队列、选择与生命周期
src/background.ts                 存储/浏览器工具/Native Messaging 装配
connector/host.mjs                 本地宿主协议装配
connector/session-host.mjs         每会话进程与连接代次
connector/providers/registry.mjs   Cordis 插件注册、发现与释放
connector/providers/codex.mjs      Codex 原生 Adapter
connector/providers/acp.mjs        官方 SDK 驱动的 ACP Adapter
connector/tool-broker.mjs          按会话鉴权的 MCP 工具通路
connector/process.mjs             子进程 JSON-RPC 与退出清理
```

扩展通过 Cordis 注册会话模块；本地端通过 Cordis 注册 Agent 插件。已有原生能力不用强行经过公共协议转换。每个插件提供 `id/name/protocol/available/create`；`create` 返回以下 Interface：

| 方法 | 契约 |
| --- | --- |
| `connect(nativeSessionId?)` | 初始化或恢复，返回原生 ID、实际模型目录、确认模型、能力声明；失败不创建假恢复结果 |
| `prompt(task)` | 接收一轮任务，Promise 到原生最终结束才完成；生成期间用 `emit` 发增量、工具、配置与投递事件 |
| `steer(task)` | 只在有在途任务及协商能力时调用；必须反馈结果，不能忽略消息或静默开启新任务 |
| `setModel(model)` | 验证目录，返回确认配置；Codex 可以明确返回 `nextTurn: true` |
| `setConfig(id,value)` | 可选，按真实配置目录验证并等待确认；不能虚报当前轮热切换 |
| `refresh()` | 可选，同步最新模型/技能/命令目录；不创建新的会话或发起推理 |
| `cancel()` | 请求停止；不能把请求发出等同任务已结束 |
| `close()` | 释放连接及子进程，不删除原生历史 |

插件只处理后端协议，不自己排另一层用户队列。队列由扩展会话模块统一持有；Native Messaging 与 ACP stdio 各自编码，不能直接转发原始字节。

## 增加 ACP 客户端

大部分标准 stdio ACP 实现不必新增 UI 或 Adapter。创建忽略目录中的 `.local/agents.json`，然后在扩展管理页重新加载 BeeHelper，让本地宿主重新启动并发现插件：

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "My Agent",
      "command": "/absolute/path/to/agent",
      "args": ["--acp"]
    }
  ]
}
```

`command` 必须是绝对路径；这是进程调用，不是 shell 命令字符串。JS 程序可把 Node 作为 command、脚本路径作为 args。可选 `env` 是本机环境变量表，不会随 provider 目录发送到浏览器；不要将包含凭据的配置加入公共仓库。ID 不得重复；客户端模型 ID、model config ID 和 steering 以实际握手结果为准。

原生协议差异较大时，在 `connector/providers/` 新增工厂并注册，不修改会话视图。无可用控制接口的客户端应声明不可用及原因，不能用“可以调它的模型”冒充“已连接其 Agent”。

## 工具归属

每个会话有独立原生进程及随机连接代次。每个 MCP 进程仅持有本会话工具凭据；宿主同时校验会话、代次、凭据和工具白名单。浏览器再校验实际会话状态。切换到另一个会话不会改变原任务的工具归属，旧连接事件会被丢弃。

微应用 preview 绑定发起任务的工作台窗口，而不是后来前台的窗口；插话不会改原任务的 preview 所有者。工作台关闭会结束该窗口的临时界面资源，不保证 Agent 任务也同时终止；其后请求界面 preview 会明确失败。服务不监听对外 TCP 端口，不修改 Agent 的全局 MCP 配置。

## 验证

```sh
npm run check
npm test
npm run test:e2e
npm run doctor
npm run doctor -- --agent claude
npm run doctor -- --agent dsh
npm run doctor -- --agent claude --check-model
npm run doctor -- --agent dsh --check-model
```

`doctor` 进行真实握手、创建会话和读取配置，但不发模型请求；输出数量与能力，不打印实际模型目录或账户资料。正常 Agent 启动仍可能执行它自己的初始化与配置加载。

`--check-model` 在诊断会话内验证选择；ACP 等后端确认，Codex 明确报告下一轮生效，不发起推理。若切换后原选项仍在新目录中则恢复；否则直接结束临时连接，不强行恢复后端已移除的选项。模型目录可随配置更新，以最新返回值为准。

常规测试包含独立 Chromium、真实扩展、Native Messaging 与可控协议夹具。夹具用于稳定重现状态与时序，不代表真实模型。真实 Codex 模型测试仍需显式设置 `BEEHELPER_LIVE_CODEX=1`。不要对自己的个人浏览器配置运行测试。
