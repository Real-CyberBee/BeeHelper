# 会话交互与附件

版本：0.3.0。会话索引、队列与插件基础见[会话管理](agent-sessions.md)。保留原生侧边栏，不需要改用独立聊天网站。

## 当前交互

- 默认以当前会话为主，顶部只保留标题、客户端状态、新建和更多操作；历史会话通过左侧抽屉打开，支持搜索、归档、重命名和选择客户端创建会话。切换后自动收起，Esc 或点击遮罩可关闭。
- 消息搜索、导出、状态详情及连接操作收进更多菜单，当前微应用和目标页面信息在菜单顶部查看。模型、附件、引用和命令集中在输入框底部；配置按需展开，排队/插话仅运行中显示，授权请求仍直接呈现。
- 输入 `/` 或点击命令图标，检索当前可用命令；方向键选择，Enter/Tab 插入，Esc 关闭。
- 输入 `@` 或点击引用图标，选择微应用、当前浏览器页面、Codex 技能或本地文件。重名微应用会显示安装状态和短 ID，页面显示 tab ID。
- 回车发送、Shift+Enter 换行；输入法正在组合文字时不发送。可在配置中改用 Ctrl/Cmd+Enter。
- 文件按钮、拖拽到聊天区域、浏览器剪贴板提供的 File/图片均可添加附件。大于消息长度的纯文本粘贴会作为文本附件暂存，不直接截断。
- 附件有进度、取消/重试、移除、图片预览及下载；纯附件消息也可发送。原文件不作为 base64 写入整份聊天数据库。
- 文本、引用和完成上传的附件元数据按会话保存；切换/刷新可继续编辑。进行中的上传不承诺跨页面关闭续传；失败后可重试。
- 回复支持 GFM 表格、代码块与代码复制。关闭原始 HTML，拒绝危险链接；模型输出的远程 Markdown 图片只显示链接，不自动请求第三方。
- 支持消息搜索、复制文本、重用用户要求为新草稿和 JSON 导出。重用不删除或改写已有原生历史；替换非空草稿需确认。
- 阅读旧消息时不强制跟随每个新 token；可回到最新消息。原有会话切换、队列、停止、授权继续保留。

## `/` 的两类来源

### BeeHelper 本地控制

| 命令 | 行为 |
| --- | --- |
| `/new` | 新建同一客户端的会话，不清空旧记录 |
| `/stop` | 请求停止，暂停后续队列 |
| `/model` | 聚焦模型选择；可用模型 ID/显示名作为参数 |
| `/skills` | 打开可用技能选择 |
| `/status` | 查看实际会话状态、原生 ID、目录数量等 |
| `/help` | 显示当前命令目录 |

除 `/model` 外，本地命令不接受参数，不会悄悄丢弃多余任务文本。原生命令重名时优先归原客户端；BeeHelper 控制使用 `/bee:new` 等命名空间。控制命令不发送给模型，也不伪造模型回答。

### 客户端原生命令

- ACP 使用 `available_commands_update` 的实时目录。按原文把 `/命令 参数` 放在首个 text 块开头，**不**在命令前拼 BeeHelper 通用提示词；附件作为后续独立块。
- 启动时目录可能尚未返回，后续通知会补齐。菜单可同步目录；Codex 会重读模型/技能，ACP 同步已收到的最新状态，不假设存在标准的“强制重扫所有命令”接口。
- Codex 当前提供真实 `thread/compact/start` 的 `/compact`，并通过 `skills/list` 提供技能引用；没有把所有终端 slash command 当作文本提示词假装支持。
- `/compact` 不接受参数、引用或附件，也不会把待下轮应用的模型/推理设置误报为已经生效。
- 未声明/已失效的命令明确拒绝并保留草稿；运行中的原生命令排队，不走 steer。目录通知和连接快照带版本号，旧快照不会覆盖刚更新的目录。

不保证 `/plan`、终端专属命令、登录界面或所有私有扩展可用。需要依赖 Agent 实际公开的控制接口逐步适配，而不是对未知命令虚报成功。

## `@` 实际传递什么

| 来源 | 传递与验证 |
| --- | --- |
| 微应用 | 从当前本地库核验 ID、名称和提交时版本；源码仍由 `microapp_get` 读取，不把全部源码历史默认塞进提示词 |
| 页面 | 核验可访问 tab，传名称、ID、URL；不会因引用自动读取整页正文，观察仍走浏览器工具 |
| Codex 技能 | 浏览器只选不透明 ID，原生适配器映射到真实目录路径并发送结构化 skill 输入；不接受浏览器伪造路径 |
| 本地文件 | 通过用户明确的文件选择、粘贴或拖拽暂存；不扫描整个磁盘建立 `@` 索引 |

ACP 技能通常以客户端广告的 `/` 命令出现；没有统一的技能枚举方法时不猜测。Codex 目录当前最多返回 200 项；命令最多 200 项，菜单查询最多展示 30 个匹配结果，不等于未展示项不存在。

## 附件通路与边界

```text
用户选择 / 拖拽 / 粘贴 File
  -> 分片 Native Messaging（每片 192 KiB）
  -> 本机私有暂存目录（随机 ID、权限控制、完成后 SHA-256 校验）
  -> 消息/队列仅保存受校验元数据与 ID
  -> 发送时按所属会话重新读取、校验
  -> Codex localImage / 文本材料 / 文件路径
     或 ACP image / resource(text) / resource_link
```

默认暂存在本地连接器工作目录的 `attachments/` 中，即用户数据目录 `~/.local/share/beehelper/workspace/attachments/`。文件名使用随机 ID，保留受限后缀以便客户端识别格式；不使用用户提供的路径写入任意位置。每个文件绑定 BeeHelper 会话，不能用其他会话的 ID 读取。

图片当前为 PNG、JPEG、WebP、GIF。校验签名与传输完整性不等于证明图片已被模型正确理解；是否有视觉能力还看 Agent 握手和模型目录。声明仅支持文本的模型会在投递前拒收图片，草稿仍保留。

小型 UTF-8 文本文件可嵌入；ACP 未声明 `embeddedContext` 时使用链接加文本材料。PDF、Office 等二进制文件只提供真实文件引用，不能把字节转成“已解析文本”，也不发送某些 adapter 会忽略的 blob 资源。客户端需使用其实际文件读取/解析能力；BeeHelper 没有内置通用 Office/PDF 解析器。

客户端可以读取当前任务涉及、用户在该会话明确上传的材料；不允许把暂存文件执行起来，也不应将本机临时路径无意固化为可复用微应用。聊天附件不等于已上传到业务网页的 Upload 组件。

### 当前大小限制

| 项 | 上限 |
| --- | --- |
| 单文件 | 20 MiB |
| 单图片 | 4 MiB |
| 每条附件数 | 8 |
| 每条原文件总大小 | 32 MiB |
| 自动嵌入文本 | 每文件 256 KiB |
| 单条文本 | 50000 UTF-16 字符 |

定义集中在 `shared/content-limits.json`，不是各 adapter 分别猜测。模型服务仍可能有更小的请求限制；框架上限不等于所有模型都能接受。

### 隐私与保留

- 添加附件先做本机暂存；**发送**后才由选择的 Agent/模型处理，不自动发布文件，也不读取系统剪贴板历史或桌面登录凭据。
- 草稿与消息保存缩略图和附件元数据；完整文件保存在私有本地目录，不是加密保险箱，同一 OS 用户的其他程序不属于隔离保证。
- 为支持刷新、队列和历史引用，完成的暂存文件不会随“移除附件”自动销毁。清理本机暂存目录后，旧记录的下载/重发会明确失败，需要重新选择文件；目前没有自动保留策略或回收站。
- 会话 JSON 导出包含消息、元数据和已有缩略图，不包含完整原文件，不能当作跨机器附件备份。导出文件默认忽略于 Git；分享前仍须检查业务信息。

## 配置与授权

ACP 下拉/开关从真实 `configOptions` 构造，包括客户端给出的模式、推理等参数。Codex 推理强度来自其模型目录；模型不支持的值不会通过硬编码推测。运行中修改为下一轮设置，后端确认前不冒充已生效。

工具权限仍由所属会话呈现。连接尚未结束时也能回答授权，不因“连接中”状态把授权按钮锁死。未知客户端交互仍会明确失败；本版未实现任意嵌套 elicitation 表单、完整终端或所有客户端登录流程。

## 模块契约

- `src/core/chat-content.ts`：富内容类型、大小校验、补全词法、命令识别。
- `src/core/chat-commands.ts`：本地命令和客户端命名空间冲突处理。
- `src/components/ChatComposer.tsx`：输入、菜单、键盘、拖拽与上传交互。
- `src/components/SessionDrawer.tsx`：按需挂载的会话导航与管理，独立维护检索状态、键盘焦点约束和关闭后的焦点恢复。
- `src/components/ChatMessage.tsx`、`MarkdownMessage.tsx`、`ChatAttachments.tsx`：展示；Markdown 懒加载，不拖慢微应用库首屏。
- `src/agents/attachment-client.ts`、`use-chat-drafts.ts`：传输与草稿持久化，不把 File/原始字节塞进聊天索引。
- `connector/attachments.mjs`：可注入的本地附件存储；`connector/content.mjs`：按原生协议编排内容。
- Agent 插件继续通过 `commands/skills/configOptions/capabilities` 声明能力，不需要为每个客户端写一套 Composer。未知能力不显示为已支持。
- 插件可补充 `setConfig(id,value)` 和 `refresh()`；模型/配置/目录的异步通知与请求返回按版本合并，较旧快照不覆盖新通知。

高级本机部署可在安装器中指定绝对路径 `BEEHELPER_WORKSPACE` 或 `BEEHELPER_AGENTS_CONFIG`；只有路径写进本机启动器，不写认证材料。更换工作目录后，旧目录中的附件不会自动迁移。

## 验证口径

常规 `npm test` / `npm run test:e2e` 使用文件与协议夹具覆盖内容编排、大小/归属/完整性、过期目录、命令位置、粘贴/拖拽、草稿、图片预览、Markdown 与窄侧边栏。粘贴测试通过合成 ClipboardEvent 注入已知 File，不读取真实系统剪贴板。

真实 Codex 的 CSV + 图片用例可单独运行，会消耗模型额度：

```sh
BEEHELPER_LIVE_CODEX=1 npx playwright test -g '真实 Codex 读取显式上传的 CSV 与图片'
```

不会据协议夹具宣称已验证所有提供方、所有图片模型或所有文档格式。实际执行结果见[验证记录](verification.md)。

## 一手协议依据

- [OpenAI App Server](https://developers.openai.com/codex/app-server.md)：本机 0.145.0 schema 另核对 `UserInput`、`SkillsListParams`、`ThreadCompactStartParams`、`TurnStartParams`。
- [ACP Slash Commands](https://agentclientprotocol.com/protocol/v1/slash-commands)、[Content](https://agentclientprotocol.com/protocol/v1/content)、[Initialization](https://agentclientprotocol.com/protocol/v1/initialization)、[Config Options](https://agentclientprotocol.com/protocol/v1/session-config-options)。
- Claude ACP adapter 0.94.0 的 `promptToClaude` 会忽略 blob resource，因此本版只对文本用 resource，二进制走文件引用；不是把“协议允许”当成“实现一定处理”。
