# 本机验证记录

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
