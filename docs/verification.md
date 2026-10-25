# 本机验证记录

## 0.6.0 跨平台下载与官网文档

- 本地类型检查、80 项单元测试通过；浏览器回归 28 项通过，4 项真实客户端 / 模型用例按默认配置跳过。
- macOS arm64 本地 DMG 构建与临时用户目录安装、ACP 握手、修复、卸载通过。
- 跨平台 Release 工作流在 Linux x64、Windows x64、macOS arm64、macOS x64 环境构建真实下载文件。Linux / Windows 从归档解包开始，验证安装、Native Messaging 二进制帧、ACP 握手、MCP 工具往返、修复、缺文件时保留已安装版本及卸载；macOS 验证安装与 ACP 握手。
- 官网与文档以 `npm run build:site` 生成，文档源位于 `docs/`，内部文档链接转换为站内页面。静态文件与锚点检查覆盖首页及全部文档。

平台下载以 [Release](https://github.com/Real-CyberBee/BeeHelper/releases/tag/v0.6.0) 中实际上传的文件为准；CI 完成记录见 [Build release downloads](https://github.com/Real-CyberBee/BeeHelper/actions/workflows/release.yml)。Windows 首轮烟测暴露启动器标准流缓冲未及时刷新的问题，修复后重新运行，失败记录作为历史保留。

未覆盖：Windows 10 / 11 和所有 Linux 发行版的干净机器 GUI 安装验收、真实浏览器策略与 Windows SmartScreen / macOS Gatekeeper 下载链路、商业签名与公证、真实模型生成、Linux / Windows ARM、musl 和沙箱浏览器。协议夹具成功不能证明任意第三方 Agent 已登录或有模型额度。


## 0.5.1 原生轻量分发：2026-10-24

- 当前 macOS arm64 完整 DMG 约 0.94 MB（含扩展、GUI 安装器、原生连接器和连接脚本），低于 5,000,000 字节构建门槛。包内无 Node、node_modules 或 Claude 引擎；没有首次启动下载运行时的步骤。`otool -L` 检查到的动态库均为 macOS 系统库，构建对非系统动态库依赖直接报错。
- `npm run build:native`、`npm test`：78 项通过。新增原生 JavaScriptCore 下的 Codex 握手/技能/配置/取消，ACP 并行/恢复/模型/插话/取消、连接期授权、附件分片/重试/UTF-8/归属校验，以及原生 MCP 工具代理的有效/无效 token 链路。官方 MCP SDK 客户端验证了工具发现、参数校验和调用互操作。
- `npm run test:e2e`：Node 开发连接器下 28 项通过、4 项真实客户端/模型测试跳过。`BEEHELPER_NATIVE_CONNECTOR=1 npm run test:e2e`：真实扩展改走原生连接器后同样 28 项通过、4 项跳过。没有真实模型调用或个人业务操作。
- `npm run test:installer`：执行包内签名后的原生安装器，在临时用户目录安装；PATH 不提供 Node/npm，连接器使用系统 JavaScriptCore。合成外部 Agent 夹具显式使用开发机 Node，不是连接器依赖。Native Messaging/ACP 握手、修复与卸载通过，个人安装未修改。
- Claude 适配器为可选外部客户端，缺失时显示具体原因；不以删除静默下载步骤来掩盖运行依赖。源码开发模式仍可使用仓库中的 Claude ACP 包。

编译目标 macOS 13+；本轮没有完成 macOS 13、x64 实机、Windows/Linux 原生分发、Developer ID 公证或真实客户端/模型的全量验收。系统 JavaScriptCore 仅运行随包的可信连接脚本，用户微应用仍运行在浏览器隔离环境。

## 0.5.0 安装与首次使用切片：2026-10-24

环境：macOS arm64，独立 Chromium 测试配置。既有聊天布局与远端更新已合并，本轮未连接个人业务页面。

- `npm run check`、`npm test`：71 项单元/协议测试通过。新增覆盖分发安装的版本切换、失败保留、卸载边界、文档身份与状态推导、内置微应用能力白名单及诊断脱敏。
- `npm run build`、`npm run test:e2e`：28 项浏览器 E2E 通过，4 项真实客户端/模型用例按默认设置跳过，不消耗真实模型额度。
- 新向导 E2E：首次自动显示、用户脚本关闭提示、可选客户端连接、完成后不重复弹出、设置重新打开、360px 展示、脱敏导出，以及连接器缺失时仍可运行本地界面微应用。页面生效用例覆盖匹配/运行区别、停止、同 URL 刷新、SPA、禁用、工具栏角标和系统诊断服务拒绝网页调用。
- `npm run build:installer`：生成 macOS arm64 DMG 与 SHA256。产物包含 Node、对应许可证、锁定生产依赖、扩展构建和 GUI 安装器；当前仅为临时签名，无 Developer ID 和公证。
- `npm run test:installer`：在临时用户目录完成真实分发安装；以不包含系统 Node/npm 的 PATH 启动安装后 native host，使用复制到临时目录的合成 ACP Agent 完成 Native Messaging 与模型元数据握手，之后修复并卸载。没有修改当前用户的浏览器注册或个人 Agent 配置。
- 已目视检查首次向导窄屏截图；文档链接、任务状态与空白检查另见本轮提交。

未验证：无开发环境的新 macOS 用户与 Gatekeeper 下载隔离链路、Developer ID 签名/公证、x64 实机、Windows/Linux 图形安装包、扩展商店审核、自动更新、第三方 Agent 的首次安装/登录、真实模型生成与业务流程。本机隔离安装烟测不等于干净机器 GUI 验收。

安装操作、系统微应用契约和边界见[首次使用说明](getting-started.md)；安装包为本地产物，不提交到 Git，CI 可手动构建预览 artifact。

## 0.3.0 富交互：2026-10-20

- 构建包含 TypeScript 检查；Markdown 按需拆包，保留原生侧边栏入口。
- 最终复测：`npm test` 53 项通过；`npm run test:e2e` 24 项通过、3 项真实模型用例默认跳过。另单独运行下述真实附件模型用例，1 项通过。
- 协议与存储回归覆盖附件分片、重试一致性、会话归属、文件校验、未完成上传释放、未知命令/图片能力校验、目录快照版本、结构化图片/技能输入及原生推理配置保留。
- 常规 E2E 在独立浏览器与本地协议夹具中，验证 `/` 键盘选择、真实 native compact 方法路由、ACP 命令首块位置、`@` 引用、文件选择、纯图片、拖拽、合成 ClipboardEvent、长文本转附件、草稿恢复、图片预览、附件下载、配置、搜索/导出/重用、Markdown 安全和连接期间授权。常规测试不发送模型请求，不读取真实系统剪贴板。
- `BEEHELPER_LIVE_CODEX=1 npx playwright test -g '真实 Codex 读取显式上传的 CSV 与图片'`：1 项通过，约 46 秒。使用合成 CSV 和现场生成的色块 PNG，真实模型正确返回 CSV 数值及图片色块数；只对合成材料做模型验证，未操作网页或业务系统。
- 本机 Codex 的真实握手返回命令、技能、推理配置及图片能力；Claude 真实握手支持图片/配置，后续通知确实推送原生命令目录；dsh 当前 ACP 未声明图片能力和原生命令目录，没有伪装成可用。
- 360px/420px 富输入与 360px Markdown 对话截图已检查；构建产物版本与源码版本一致为 0.3.0。文档链接、空白及静态凭据/内部地址模式扫描通过。截图、完整原文件和本机 Native Messaging 注册不提交公共仓库。

未覆盖：Claude/dsh 的真实多模态推理、任意 PDF/Office 内容解析、全部私有命令/终端/嵌套表单、其他 OS 实机、商店审核与完整安全审计。WorkBuddy 仍未完成官方 Open API 接入。

能力、大小、保留与插件契约见[会话交互与附件](chat-interactions.md)。测试数量以本节最终复测记录为准，不把夹具结果当作所有真实客户端的功能保证。

## 0.2.0 会话管理：2026-10-20

- `npm run build`：类型检查与扩展构建通过，package/manifest/能力清单/构建 manifest 版本一致为 0.2.0。
- `npm test`：32 项通过。包含旧库迁移、并发投递、上下文快照、队列暂停/恢复、模型目录变化、授权队列、旧连接隔离，以及实际子进程的 Codex/ACP 协议夹具。
- `npm run test:e2e`：18 项通过，2 项真实模型用例按默认策略跳过。新会话测试使用独立 Native Messaging 注册和可控协议夹具，不调用模型。
- `BEEHELPER_LIVE_CODEX=1 npx playwright test -g '真实 Codex 使用微应用和网页上下文'`：单独运行 1 项通过，约 1.2 分钟。经新会话/MCP 通路读取合成源码、观察本地页面、点击开放 Shadow DOM 按钮并读取日志。
- `npm run doctor -- --check-model`：真实 Codex 握手、模型目录与下一轮模型配置接受验证通过；未将下一轮配置接受冒充当前生成模型热切换。
- `npm run doctor -- --agent claude --check-model`：本机 Claude Code 经 ACP adapter 握手及模型配置确认通过。
- `npm run doctor -- --agent dsh --check-model`：本机 dsh 经其兼容 Node 握手及模型配置确认通过；未声明 steer。切换后模型目录发生变化，诊断仅恢复仍在新目录中的旧选项。
- `npm run setup:native`：已重新生成本机启动器并注册原 host 名称；发现 Codex、Claude Code 和 dsh。不提交生成文件、机器路径或凭据。
- 360px/420px 会话工作台与桌面截图已检查；文档本地链接、代码围栏、空白与公开文件的凭据/内部地址模式扫描通过。模式扫描不等于完整安全审计。

**尚未验证/实现：**Claude/dsh 的完整真实模型生成与浏览器操作回归；CodeBuddy 独立 CLI；WorkBuddy 官方 OAuth/Open API；任意第三方客户端历史导入或 IDE 活动会话接管。本机 WorkBuddy 安装可检测，但附带 CLI 入口不能据此当成独立可用 CLI，桌面凭据未读取。其他平台仍未实机验收。

升级与插件契约见[会话管理与 Agent 插件](agent-sessions.md)。上述测试未操作真实业务系统；只有明确 opt-in 的 Codex 用例使用了真实模型额度。

## 0.1.1 回归：2026-10-19

- `npm run build`：通过，包含类型检查与最新 `dist/` 构建。
- `npm test`：16 项通过。
- `npm run test:e2e`：13 项通过，2 项真实模型用例按默认策略跳过。
- `BEEHELPER_LIVE_CODEX=1 npx playwright test -g '真实 Codex 使用微应用和网页上下文'`：1 项通过，约 1.8 分钟。
- `npm run doctor`：实际 Codex CLI 0.145.0，已登录、连接可用。

本次先用两项回归分别复现 Chrome 的 `args index 2: Value is unserializable` 和 Shadow DOM 按钮缺失，再修复并验证。另覆盖原生 select 选项、旧观察引用失效、禁用控件不被误操作。

真实模型用例没有在用户提示里指定工具名或运行 ID。它实际调用 `microapp_get`、`browser_inspect`、`browser_action`、`run_get`，点击本地微应用的开放 Shadow DOM 按钮，随后核实页面邮箱与按钮日志。源码未被修改，也没有提交表单。

修复范围与升级步骤见[0.1.1 修复记录](fixes/2026-10-19-context.md)。没有操作用户个人 Chrome 中的业务页面，不能据此声称真实业务脚本中的银行字段、地址映射或附件逻辑已经修复。

## 0.1.0 基线

日期：2026-10-18。范围：本地验证版 0.1.0，不是生产环境验收。

## 环境

- macOS / arm64，Node.js v22.17.0。
- Google Chrome for Testing 153.0.8010.12，独立测试配置。
- 本机 Codex CLI 0.145.0，已有 ChatGPT 登录状态。
- 本地测试站点：`http://127.0.0.1:4173/demo.html`。

## 执行结果

| 命令或验证项 | 结果 |
| --- | --- |
| `npm run build` | 通过，包含 TypeScript 检查与扩展产物生成 |
| `npm test` | 10 项通过 |
| `BEEHELPER_LIVE_CODEX=1 npm run test:e2e` | 11 项通过，包含真实模型请求 |
| 加强后的安装持久化与跨源标签页回归 | 2 项通过，目标分别为 127.0.0.1 和 localhost |
| `npm run doctor` | App Server 握手、版本、登录状态通过 |
| 生产依赖审计，使用 npm 公共 registry | 报告 0 个已知漏洞；不等于代码安全审计 |
| 本地测试页 HTTP | 200 |
| 项目 Markdown 内部链接与代码块 | 通过 |

依赖审计使用 npm 公共 registry：`--registry=https://registry.npmjs.org --omit=dev`。

## 实际覆盖

1. 未安装候选直接填写真实浏览器中的本地表单，不提交。
2. 安装、收藏后重新加载工作台，状态和源码仍然存在。
3. 隔离 iframe 中的微应用确实交互、去重并输出结果。
4. 手动编辑源码、保存新版本、恢复历史。
5. 导出再导入，生成独立且未安装的候选。
6. 页面事件实例从试用转安装不重复；SPA、禁用、再启用和卸载能够清理。
7. SDK 跨标签页、跨源观察与填写；脚本失败会清理已登记页面节点。
8. 隔离界面经宿主访问微应用私有存储，不误用网页 tabId。
9. 420px、360px 工作台截图与横向溢出检查。
10. 真实 Native Messaging 连接、登录状态及模型列表。
11. 真实 Codex 经 MCP 创建候选、调用运行并显示实际界面，随后通过界面安装。
12. 页面快捷入口打开原生 Chrome 侧边栏，通过 `runtime.getContexts(SIDE_PANEL)` 确认，而非只打开普通扩展标签页。

测试使用真实浏览器、真实扩展和真实 Codex；未用伪造模型回复替代生成验证。常规 E2E 默认跳过模型调用，避免每次回归消耗额度。

## 未验证与限制

- 未访问真实客户后台、测试工具或商家中心；本地样例不是这些系统的接口适配。
- 未在个人 Chrome 配置中替用户自动安装浏览器扩展。需要按[本机测试说明](local-testing.md)加载 `dist/` 并允许用户脚本。
- 未验证 Windows、Linux 实机、其他 Chromium 发行版、商店审核或生产大规模使用。
- 未证明任意 npm 工程、任意跨源 iframe、所有业务站点都可自动操作。
- 真实页面试用会产生实际业务效果；停止只清理已登记资源，不回滚外部提交。

截图保存在项目 `.local/screenshots/`；详细复测命令与运行条件见[本机测试与排障](local-testing.md)。

## 0.4.0 增补验证（本次环境：Linux）

| 命令或验证项 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test` | 64 项通过（新增用户脚本解析/转换/示例校验 6 项，E2E 跨平台启动器 5 项） |
| `npm run build` | 通过，`dist/` 含图标、Logo、favicon、demo 页 |
| 真实扩展加载与 `userscriptSearch` | 通过：后台直连 ScriptCat 返回热门脚本，不受网页 CORS 限制 |
| 真实扩展 `userscriptImport` | 通过：脚本转换为未安装候选，源码可编译 |
| 脚本市场 UI | 通过：真实来源数据 20 条，来源/排序/搜索/本地导入入口可用 |
| 示例画廊 | 通过：13 个示例全部可添加；面板示例在侧边栏沙箱运行 |
| 页面示例（元素探针、批注笔） | 通过：在本地测试页真实挂载 Shadow DOM UI 与 canvas |
| `bee.apps.list/update` | 通过：网页预览与扩展中均可列出并切换收藏 |
| `bee.askAI` 失败路径 | 通过：未连接客户端时返回可读错误，不伪装成功 |
| 移动端 390×844 | 通过：库、会话与底部导航无横向溢出 |
| `npm run test:e2e`（Linux，无头，默认夹具） | **23 项通过，4 项跳过**（真实连接器 1 项 + 真实模型 3 项）；扩展本地闭环与会话夹具套件完整运行 |
| `BEEHELPER_E2E_CONNECTOR=1`（Linux，真实连接器） | **24 项通过，3 项跳过**：真实 Native Messaging 连接 Claude Code 与 DSH，均返回模型列表 |
| Linux 本机连接（Chrome 152） | Claude Code 2.1.289：doctor 与扩展内连接通过，5 个模型；DSH 0.2.0-rc.2：doctor 与扩展内连接通过，3 个模型；Codex 未安装 |
| 默认客户端缺失时的 UI | 新对话自动选中已安装客户端；未就绪会话提供“改用 … 开始”；连接器未注册时设置页提供“重新检测”和安装说明 |
| Native Messaging 清单热更新 | Chromium 中先启动扩展、再写入清单，`providers` 立即成功，无需重启浏览器；文档改为“先重新检测，仍失败再完全重启” |
| Chrome for Testing 清单路径 | 按 Chrome 146+ 官方路径修正：macOS `Google/ChromeForTesting`，Linux `google-chrome-for-testing`；安装器、E2E 发现逻辑与单测同步 |
| E2E 启动器跨平台路径 | 单测覆盖 Linux/macOS/Windows 的 Chromium 缓存、Native Messaging 清单与 `CHROME_PATH` 优先级 |

GreasyFork 在本环境网络下不可达（超时），已验证错误提示与离线 `.user.js` 导入路径；ScriptCat 可正常搜索与导入。

默认 E2E 使用仓库内 fake ACP agent 与临时 native host 夹具，不需要本机连接器，也不会调用模型。真实连接器模式（`BEEHELPER_E2E_CONNECTOR=1`）在本机 Linux + Chrome 152 上通过：安装器注册的 host 被扩展发现，Claude Code 与 DSH 均完成 ACP 握手并返回模型列表。真实模型请求仍未开启（对应 3 项显式 skipped），不会伪装成通过；`bee.askAI` 的排队与投递逻辑复用既有会话服务单元测试。

跨平台说明：默认无头，`E2E_HEADED=1` 有头；`CHROME_PATH` 可覆盖浏览器；Linux/macOS 可跑全部本地用例；Windows 上扩展/UI 用例可跑，依赖 Native Messaging 夹具的会话套件因缺少 `.exe` 启动器自动跳过。
