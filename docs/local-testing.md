# 本机测试与排障

> 普通用户请优先使用[分平台下载与安装指南](install.md)。本页保留源码开发、隔离浏览器测试与历史排障流程；Windows 的预览安装包已包含 exe 宿主，源码 `setup:native` 仍仅面向 macOS / Linux。

0.2.0 增加多会话与 Agent 插件，升级、能力边界及自定义 ACP 配置见[会话管理与插件开发](agent-sessions.md)。升级后执行一次 `npm run setup:native`，再重新加载扩展；不要卸载或清空扩展存储。

已安装版本升级到 0.1.1 时，先停止在途任务，再在扩展管理页点击 BeeHelper 的“重新加载”，重新打开侧边栏连接 Codex即可。不要先移除扩展；加载相同目录并使用原来的固定 key 会保留本地库和已保存对话。

## 1. 侧边栏安装

1. 进入 Chrome 的 `chrome://extensions/`，开启“开发者模式”。
2. “加载已解压的扩展程序”，选择项目的 `dist/` 目录。
3. 打开 BeeHelper 详情，开启“允许运行用户脚本”。
4. 从扩展菜单点击 BeeHelper，打开原生侧边栏；可以将图标固定到工具栏。
5. 侧边栏设置中点击“连接 Codex”。微应用脚本本身不要求 Codex 在线。

本项目使用固定公开扩展 key，开发 ID 为 `llkomjgjbldjelaemjcgphogaceejbpi`。请不要自行删除 manifest 中的 key，否则 Native Messaging 来源配置需要一起更新。

完整标签页用于调试，不能把直接访问本地网页等同于已加载扩展。网页预览支持本地库和隔离界面，不具有 Chrome 标签页操作或 Native Messaging 能力。

## 2. 本地连接器

运行 `npm run setup:native` 将创建项目内 `.local/native-host.sh`，并注册仅供该扩展使用的 `io.beehelper.codex`。macOS 的注册文件位于用户级目录：

- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/io.beehelper.codex.json`
- `~/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts/io.beehelper.codex.json`
- `~/Library/Application Support/Chromium/NativeMessagingHosts/io.beehelper.codex.json`

Linux 对应位置：

- `~/.config/google-chrome/NativeMessagingHosts/io.beehelper.codex.json`
- `~/.config/google-chrome-for-testing/NativeMessagingHosts/io.beehelper.codex.json`
- `~/.config/chromium/NativeMessagingHosts/io.beehelper.codex.json`

注册或移动项目后，回到侧边栏点“重新检测”；当前 Chrome 通常会立即读取新的清单。若仍显示连接器未就绪，再完全退出并重启浏览器（只刷新 `chrome://extensions/` 不够）。安装器会读取 PATH、`~/.local/bin` 等目录来发现 `codex`、`claude`、`dsh`；只有实际发现的客户端才会显示为“可连接”。也可以在执行安装器时用 `BEEHELPER_CODEX`、`BEEHELPER_CLAUDE`、`BEEHELPER_DSH` 指定绝对路径。面向普通用户的安装包方案见[连接器安装方式调研](connector-installation.md)。

连接器调用当前安装的 Node 与本地 Agent（Codex App Server 或 ACP）。它不修改 Codex 全局配置，不复制登录凭据；仅为自身 App Server 进程注入 BeeHelper MCP 配置。工作目录自动放在 `~/.local/share/beehelper/workspace`，不是微应用源码存储。

该进程预先批准 BeeHelper 自有 MCP 工具，以支持已确认的直接创作与运行体验；不会改变其他客户端的工具授权。额外的本机命令、文件修改或未知交互审批不会被连接器自动接受。

移动项目目录、切换 Node 或客户端路径后重新执行 `npm run setup:native`。

`npm run doctor` 验证进程握手、版本和登录状态，但不验证浏览器是否加载扩展，也不发送模型请求。按客户端运行：

```sh
npm run doctor -- --agent codex
npm run doctor -- --agent claude
npm run doctor -- --agent dsh
```

Linux 上已实际验证 Claude Code 与 DeepSeek Harness 的 ACP 握手和模型列表；Codex 未安装时不影响这两者，但需要在新对话里选中它们，而不是继续使用默认的 Codex 会话。

## 3. 第一次验证

启动 `npm run dev`，打开 `http://127.0.0.1:4173/demo.html`，再打开 BeeHelper 侧边栏：

1. 选择候选“表单快速填写”，确认目标是本地测试页面，点击“查看效果”。
2. 观察页面字段变化及实际运行日志；此样例不提交表单。
3. 点击“安装”，确认进入已安装库，可收藏、导出和再次运行。
4. 选择“批量文本整理”，不安装也可直接查看效果并交互。
5. 修改源码并保存，在版本页检查新版本或恢复历史。

测试页还提供创建店铺、商家入驻、三步客户表单。所有数据仅写到该测试站点的本地存储，页面标题明确标注本地验证；它不是任何真实业务系统的接口。

可向 Codex 发送：

> 创建一个交互界面微应用，输入多行 ID 后去重并计数。先展示效果，不要安装。

或者针对本地测试页：

> 观察当前目标页面，创建一个填写可见字段但不提交的微应用候选，运行并核实结果。

用户要求保存时才安装；已有源码可继续对话修改。页面触发由微应用属性决定，不要为了“安装”手动导出再导入。

## 4. 自动验证

- `npm test`：版本快照、并发修改冲突、恢复、包校验、URL 匹配、插件释放、Native Messaging 帧解析，以及用户脚本导入与示例校验。
- `npm run test:e2e`：在独立 Chromium 配置中加载真实扩展，打开用户脚本开关，操作本地网页与原生侧边栏。默认使用仓库内的 fake ACP agent 与夹具 native host，**不依赖本机连接器，也不调用模型**。
- `.local/screenshots/`：桌面与窄侧边栏截图。

E2E 启动器在 `tests/e2e/harness.ts`，支持 Linux / macOS / Windows：

| 环境变量 | 作用 |
| --- | --- |
| `CHROME_PATH` | 指定 Chrome/Chromium 可执行文件，优先级最高 |
| `E2E_HEADED=1` | 有头运行；默认无头，CI 无显示器也能跑 |
| `BEEHELPER_E2E_CONNECTOR=1` | 使用本机已安装的连接器，而不是夹具（需先 `npm run setup:native` 并登录 Codex） |
| `BEEHELPER_LIVE_CODEX=1` | 在连接器基础上允许真实模型请求，消耗 Codex 额度 |

- 未设置 `CHROME_PATH` 时，会依次尝试 Playwright 管理的 Chromium 和各平台缓存目录（Linux `~/.cache/ms-playwright`、macOS `~/Library/Caches/ms-playwright`、Windows `%LOCALAPPDATA%\ms-playwright`）。
- Windows 上 Chrome 只接受编译好的 `.exe` 作为 native host，不能使用 shell 包装器；扩展/UI 用例照常运行，会话夹具套件自动跳过。
- 真连 Codex 的用例由 `BEEHELPER_E2E_CONNECTOR=1` 控制；真实模型用例还需 `BEEHELPER_LIVE_CODEX=1`。默认套件不会误报连接成功。
- E2E 不复用个人浏览器配置。测试临时配置中单独放置 host 注册文件，是因为自定义 user-data-dir 的查找位置与正常安装不同。

## 5. 常见问题

| 现象 | 检查 |
| --- | --- |
| 找不到本地消息传递 host | 运行 `npm run setup:native`，检查项目是否移动、扩展 ID 是否一致，然后完全重启 Chrome |
| 刚运行 setup:native 仍连不上 | 先在设置页点“重新检测”；仍失败则完全退出并重启浏览器（部分版本只在启动时读取清单） |
| 下拉里显示 Codex 未就绪 | 本机没有 Codex；在新对话下拉选择 Claude Code 或 DSH，或使用“改用 … 开始”按钮 |
| Linux 上装的是 Chromium 而不是 Chrome | 安装器同时写入 `~/.config/chromium`；若用 Chrome for Testing 等其他浏览器，需把清单放到对应配置目录 |
| 页面脚本不可用 | 在扩展详情打开“允许运行用户脚本”，再刷新工作台的目标页面 |
| 目标页面列表为空 | 打开 HTTP/HTTPS 业务页；浏览器设置页、扩展页不能作为业务脚本目标 |
| Codex 未登录 | 先在终端执行 `codex login`，再检查连接；不要把凭据写入源码 |
| 候选界面一直运行中 | 保持发起任务的 BeeHelper 界面打开；关闭界面会销毁其隔离预览 |
| 源码保存冲突 | 不覆盖新版本；先查看新版本，再合并当前修改 |
| Codex 不知道当前应用或能力 | 更新到 0.1.1 并重新加载扩展/连接 Codex；可要求先调用 capabilities_get 和 microapp_get |
| 日志 ID 报错 | 用 run_list 查完整 runId；不要传微应用 ID 或缩略 UUID |
| 刷新后运行结果未知 | 后台重启可能丢失在途状态，不要据此盲目重放提交操作 |
| 端口被占用 | 使用开发服务器实际打印的地址；E2E 默认要求 4173 |

## 6. 脚本市场与示例画廊

- 脚本市场需要在 Chrome 扩展中打开：搜索由后台执行，网页预览（普通 Vite 页面）没有站点访问权限。
- ScriptCat 国内通常可直连；GreasyFork 可能超时。失败时可以换来源、稍后重试，或下载 `.user.js` 后从“本地 .user.js”导入。
- 导入的脚本默认是未安装、手动运行的候选。确认行为后，在“编辑属性”改成自动激活并安装。
- 示例画廊的页面脚本需要先选择目标网页；界面型示例直接在侧边栏预览。
- “让 AI 改造我自己”需要先在侧边栏连接 AI 客户端；未连接时会显示可读错误。

## 7. 当前限制

- 微应用包当前是单个 JavaScript 函数体及其元数据、版本记录；尚无通用多文件/npm 构建链。
- 页面脚本支持普通 DOM，工具观察主文档；跨源 iframe 与浏览器内部页面没有通用支持。
- Native Messaging 有单消息大小约束，超大源码与响应不适合此验证版。
- 本地库与对话保存在扩展存储；导出微应用不包含私有 storage 值、对话或 Codex 凭据。
- 停止能清理 SDK 登记的监听、观察器与挂载节点，不会回滚已提交的外部业务操作。自行创建且未登记的资源无法统一清理。
- 程序没有自动安装到个人 Chrome；加载解压扩展及用户脚本开关是正常浏览器安装步骤。
