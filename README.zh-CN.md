# BeeHelper

[English](README.md) | 简体中文

浏览器侧边栏 AI 微应用工作台。借鉴 Tampermonkey 的脚本自由度，以浏览器环境下的 everything-is-a-plugin 为设计理念，通过本地插件连接 Codex、Claude Code 和 DeepSeek Harness。

## 0.5.1 更新

- 当前 arm64 完整安装包约 0.94 MB，包含扩展；构建时强制 DMG 不超过 5,000,000 字节。
- 使用 macOS 自带 JavaScriptCore/Foundation/CryptoKit，不捆绑 Node、node_modules，也不在启动后下载运行时。编译目标为 macOS 13+，旧系统及 x64 实机验收仍待完成。
- 保留会话、附件与 Agent 通路；Claude Code 使用独立 ACP 适配器，向导明确展示缺失条件。

## 0.5.0 更新

- macOS 图形预览安装器：内置 Node、稳定目录注册、修复与卸载。见[首次使用与安装说明](docs/getting-started.md)。Developer ID 签名、公证及干净机器分发验收仍待完成。
- 首次使用向导与脱敏诊断迁移为第一项不可卸载的内置系统微应用；运行已有微应用可跳过 AI 连接。
- 当前页面生效面板与工具栏角标依据真实文档实例，区分匹配、禁用、权限不足、已完成和未知状态。

## 0.4.0 蜜蜂黄与脚本生态

- **蜜蜂黄浅色主题**：侧边栏、页面快捷入口、界面沙箱和本地测试站统一换成暖色浅色系。Logo 与扩展图标取自公司网站 [cyberbee.top](https://cyberbee.top)（`/logo/bee-96.png`、`/logo/bee-512.png`），派生图标在 `public/icons/`。
- **脚本市场**：搜索 ScriptCat 脚本站（默认，国内通常可直连）与 GreasyFork 的热门脚本，查看安装量，并可**导入为候选微应用**——源码可见、可改、可先试用。规则与限制见[用户脚本导入](docs/userscripts.md)。
- **真正的转换层**：解析 `// ==UserScript==` 元数据，`@match`/`@include` 转成匹配规则，`@exclude` 转成页面内检查，常用 `GM_*` API 通过兼容层映射到 `bee` SDK。导入默认手动运行，绝不自动安装。
- **AI 也能找脚本**：新增 `userscript_search`、`userscript_import` 两个 Agent 工具，已加入 MCP 工具清单与能力清单；模型可以先找现成方案、说明取舍，用户确认后再导入。
- **示例画廊：13 个可直接运行的示例**，包括让 AI 改造自己、插件中枢、网页批注笔、表格变图表、专注阅读、跨标签页情报官、私人短语库等。说明见[示例画廊](docs/demos.md)。
- **新的宿主能力**：微应用可以调用 `bee.apps.list()/run()/update()` 调度其他微应用，或用 `bee.askAI(prompt)` 把需求交给已连接的 AI 会话（自动附带当前微应用引用，让 AI 改它自己）。宿主能力调用会写入运行日志。
- **验证**：单元测试覆盖元数据解析、匹配规则转换、GM 兼容层生成、导入限制，以及每个示例的定义与源码编译。

### 此前的 0.3.0 富会话交互

- `/` 命令搜索与键盘选择，接入 ACP 实际命令、Codex 压缩，以及 BeeHelper 会话控制。
- `@` 引用微应用、页面和 Codex 技能；本地文件通过显式选择添加。
- 文件选择、拖拽、浏览器提供的图片/文件粘贴、预览、下载、上传进度与富草稿恢复。
- 图片使用结构化输入；文本文件按能力嵌入，其他文件保留本地引用。
- Markdown 表格和代码块、复制与重用消息、搜索、会话导出、发送键设置。
- 基于客户端真实配置的模式/推理强度等选项，不硬编码各 Agent 都有同样功能。

这不是终端/桌面客户端的一比一复刻；命令和图片输入按实际能力启用，二进制文件引用不代表已经解析。大小、隐私与适配语义见[会话交互与附件](docs/chat-interactions.md)。

### 此前的 0.2.0 会话管理

- 会话持久化、搜索、切换、重命名、归档与恢复。
- 持久消息队列、停止任务，以及按实际能力启用的运行中插话。
- 按会话选择模型，区分用户选择和后端已确认模型。
- Codex 原生协议与 ACP 接入插件，共用按会话绑定的 MCP 工具和授权交互。
- 自动迁移原有对话；新建会话不再清空其他对话。

WorkBuddy 可检测安装，但桌面登录态**不等于**已接入开放 API；官方授权和独立 API 适配尚未实现。独立安装的 CodeBuddy CLI 是另一个 ACP 候选，不冒充 WorkBuddy 桌面会话。详见[会话管理与插件开发](docs/agent-sessions.md)。

### 此前的 0.1.1 修复

修复页面点击的序列化错误，支持观察/操作开放 Shadow DOM，增加实际能力清单、所选微应用与目标页面上下文，以及运行日志列表和明确的 ID 错误。

已有安装请先停止在途任务，在 `chrome://extensions/` 对 BeeHelper 点击“重新加载”，再打开侧边栏连接 Codex；不要移除扩展。现有微应用和已保存对话仍保存在本地，不需要重新注册本地连接器。详见[修复记录](docs/fixes/2026-10-19-context.md)。

## 本机运行

日常入口是 **Chrome 原生侧边栏**：点击工具栏中的 BeeHelper，或已安装微应用在页面中的快捷入口。完整标签页和网页预览仅用于辅助调试。

执行 `npm run build` 后，扩展目录为 `dist/`。在 Chrome 的 `chrome://extensions/` 开启开发者模式，加载此目录；在 BeeHelper 扩展详情中开启“允许运行用户脚本”，再点击扩展图标打开侧边栏。侧边栏设置中点击“连接 Codex”。

本地测试页面：`http://127.0.0.1:4173/demo.html`。开发服务器通过 `npm run dev` 启动；这不是扩展侧边栏的替代入口。

从新环境准备：

```sh
npm ci
npm run build
npm run setup:native
npm run dev
```

需要 Chrome 138+、Node.js 22.12+，以及至少一个已安装并配置的本地 Agent（Codex CLI、Claude Code 或 dsh）。dsh 使用其所在目录的兼容 Node 运行时。在“AI 会话”选择客户端后新建并连接；既有会话会保留。本版本已在 macOS 与 Linux 验证（Linux：Chrome 152，Claude Code 2.1 与 DeepSeek Harness 0.2 通过 ACP 实际连接）；Windows 的 Native Messaging 安装尚未实现。

运行 `npm run setup:native` 后，回到侧边栏点 **重新检测**；当前 Chrome 通常会立即读取新的 host 清单。若仍显示连接器未就绪，再完全退出并重启浏览器。如果默认客户端 Codex 未安装，在新对话下拉里选择 Claude Code 或 DSH；侧边栏现在会自动选中可用的客户端。安装包方案与各浏览器路径见[连接器安装方式调研](docs/connector-installation.md)。

## 已实现的首版

- 未安装候选可直接运行或显示隔离界面，也可一键安装到本地库。
- 搜索、收藏、源码编辑、版本记录与恢复、导入导出。
- 页面脚本、交互界面、跨标签页观察与操作、微应用私有存储。
- 匹配页面自动激活、SPA 变化、事件登记与资源清理。
- Tampermonkey 生态脚本市场（ScriptCat / GreasyFork / 本地 `.user.js`），带元数据转换与 GM 兼容层。
- 13 个示例的画廊；微应用可以调度其他微应用（`bee.apps`），也可以让 AI 改造自己（`bee.askAI`）。
- Codex App Server / ACP + MCP + Native Messaging 的连接，不自研 agent loop。
- Codex 修改的是 BeeHelper 中的源码，不要求用户维护本地工程。

实现是本地验证版本，不是完整产品发布。未接入真实业务系统接口，也不承诺任意 npm 包、所有浏览器或商店审核通过。不同客户端使用独立原生会话，不承诺跨产品迁移内部执行状态。

## 验证

```sh
npm run check
npm test
npm run test:e2e
npm run doctor
```

E2E 使用独立 Chromium 测试配置，不操作个人 Chrome 的页面和 Cookie，并且**支持 Linux / macOS / Windows**：先看 `CHROME_PATH`，再找 Playwright 管理的 Chromium，最后扫描各平台缓存目录（`~/.cache/ms-playwright`、`~/Library/Caches/ms-playwright`、`%LOCALAPPDATA%\ms-playwright`）。默认无头运行；设置 `E2E_HEADED=1` 可以看实际过程。

默认套件会在临时配置里放一个指向仓库 fake ACP agent 的 Native Messaging 夹具，所以不需要本机连接器，也不消耗模型额度。真实连接器与真实模型需显式开启：

```sh
# 真实连接器：先 npm run setup:native 并登录 Codex
BEEHELPER_E2E_CONNECTOR=1 npm run test:e2e

# 再加真实模型请求，会消耗 Codex 额度
BEEHELPER_E2E_CONNECTOR=1 BEEHELPER_LIVE_CODEX=1 npm run test:e2e
```

Windows 上扩展/UI 用例可以运行；依赖夹具 Native Messaging 的会话套件会跳过——Windows 的 Chrome 要求编译好的 `.exe` 启动器，不能直接用 shell 包装脚本。

## 文档

- [首次使用与 macOS 预览安装包](docs/getting-started.md)
- [竞争定位与短中长期 TODO 路线图](docs/roadmap.md)
- [竞品、生态、技术趋势与资本兴趣调研](docs/research/2026-10-24-competitive-ecosystem-research.md)
- [产品需求与首版范围](docs/product.md)
- [技术方案初稿](docs/architecture.md)
- [运行时与 Agent 选型调研](docs/research/README.md)
- [多 Agent 会话管理调研与建议](docs/research/session-management.md)
- [会话管理与插件开发](docs/agent-sessions.md)
- [会话交互与附件](docs/chat-interactions.md)
- [本机测试与排障](docs/local-testing.md)
- [微应用格式与 SDK](docs/microapp-sdk.md)
- [连接器安装方式与一键安装调研](docs/connector-installation.md)
- [Tampermonkey 生态对接](docs/userscripts.md)
- [示例画廊](docs/demos.md)
- [本机验证记录](docs/verification.md)

## 首个验证场景

在本地模拟测试工具创建店铺，完成商家入驻，再填写三步客户表单。

具体业务规则由微应用作者通过 AI 对话持续调整，不写成 BeeHelper 平台的固定逻辑。

## 公开仓库与本地数据

仓库仅包含源码、合成测试页面和项目文档，不包含浏览器登录态、微应用库、对话、业务数据或 Codex 凭据。`.local/`、依赖、构建产物和测试报告不提交；新环境需自行构建并注册本地连接器。扩展 manifest 中的 `key` 是用于固定开发扩展 ID 的公开密钥，不是私钥。

不要提交 `.env`、`.npmrc`、密钥、个人浏览器配置或真实业务微应用导出包；分享微应用前应检查源码中是否包含凭据、内部地址和业务数据。
