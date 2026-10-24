# 连接器安装方式调研：如何避免普通用户运行 `npm run setup:native`

> 0.5.1 状态更新：macOS 已改用 Swift + 系统 JavaScriptCore，完整 arm64 DMG 约 0.94 MB，不捆绑 Node 或生产依赖目录。实际操作见[首次使用说明](getting-started.md)。下文保留早期安装选型与尚未交付的其它平台建议，不能视作当前打包实现。

日期：2026-10-24。范围：Chrome / Chromium（MV3 扩展），macOS / Linux / Windows。

## 结论（TL;DR）

- **可以去掉“让用户运行命令”这一步，但不能去掉“一次性操作系统级安装”。** Chrome 的原生消息（Native Messaging）设计要求 host 由操作系统安装、并注册到浏览器能找到的位置；扩展本身没有权限写这些文件或启动本地进程。这是浏览器安全模型，不是 BeeHelper 的实现缺陷。
- 推荐把 `npm run setup:native` 降级为**开发者选项**，面向普通用户提供**免管理员的每用户安装包**：内置连接器（单文件二进制），写入宿主清单，按浏览器自动注册；native messaging 是按需启动的，不需要常驻服务或开机自启。
- 如果用户是**公司统一管理的 Chrome**，更彻底：管理员用 `NativeMessagingHosts` 策略预注册 + 强制安装扩展，普通用户**零操作**。
- 长期可选**本地 HTTP/WebSocket 伴随程序**，摆脱“每个浏览器一套清单”的麻烦，但会引入常驻进程、端口、防火墙和鉴权问题，不建议作为第一版。

## 为什么现在需要这条命令

`npm run setup:native` 实际做三件事：

1. 生成 `.local/native-host.sh`，把已发现的 `codex` / `claude` / `dsh` 绝对路径写进去；
2. 计算扩展 ID，生成 `allowed_origins` 精确匹配的 host 清单；
3. 把清单写到浏览器的 `NativeMessagingHosts` 目录（macOS/Linux）或注册表（Windows，尚未实现）。

Chrome 官方文档对此有明确约束：

- “原生消息传递主机清单文件的位置取决于平台”；**Windows 上“应用安装程序必须创建注册表项”**（`HKEY_CURRENT_USER` 或 `HKEY_LOCAL_MACHINE`），并把默认值指向清单路径。macOS/Linux 的用户级清单位于用户配置目录（见下表）。
- `allowed_origins` 必须是精确的 `chrome-extension://<id>/`，**不能使用通配符**。
- 宿主清单里的 `path` 指向一个本地可执行文件；Chrome 用 `connectNative()` 时才启动它，用 stdin/stdout 通信。

MDN 的表述更直接：“原生应用不由浏览器安装或管理，而是使用操作系统自身的安装机制安装。” 扩展侧能做的只有“连接一个已经注册好的 host”，没有“注册 host”的 API。

因此：**命令可以消失，安装动作不能消失**；区别只在于安装由谁、以什么形式完成。

## 清单路径（Chrome 官方当前定义）

| 平台 | 用户级（推荐，免管理员） | 系统级（需管理员） |
| --- | --- | --- |
| macOS · Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | `/Library/Google/Chrome/NativeMessagingHosts/` |
| macOS · Chrome for Testing（146+） | `~/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/` | `/Library/Google/ChromeForTesting/NativeMessagingHosts/` |
| macOS · Chromium | `~/Library/Application Support/Chromium/NativeMessagingHosts/` | `/Library/Application Support/Chromium/NativeMessagingHosts/` |
| Linux · Chrome | `~/.config/google-chrome/NativeMessagingHosts/` | `/etc/opt/chrome/native-messaging-hosts/` |
| Linux · Chrome for Testing | `~/.config/google-chrome-for-testing/NativeMessagingHosts/` | `/etc/opt/chrome_for_testing/native-messaging-hosts/` |
| Linux · Chromium | `~/.config/chromium/NativeMessagingHosts/` | `/etc/chromium/native-messaging-hosts/` |
| Windows | `HKCU\Software\Google\Chrome\NativeMessagingHosts\io.beehelper.codex` | `HKLM\...`（需管理员） |

注：Chrome 146 之前，Chrome for Testing 与 Chrome 共用清单目录；安装器应同时写两个位置以兼容旧版本。

> 本次已修正安装器：此前 macOS 写成 `Google/Chrome for Testing`、Linux 漏了 `google-chrome-for-testing`，与 Chrome 146+ 的实际路径不符。见 `connector/install.mjs` 与 `tests/e2e/harness.ts`。

## 可选方案对比

| 方案 | 普通用户操作 | 管理员权限 | 平台 | 工作量 | 主要风险 |
| --- | --- | --- | --- | --- | --- |
| **A. 每用户安装包 + 单文件连接器**（推荐） | 下载、双击安装；之后无感 | 否（用户级清单/HKCU） | macOS / Linux / Windows | 中 | 需要签名/公证；多浏览器路径；包体较大 |
| B. 企业策略预注册 | **零操作**（管理员统一下发） | 是（一次性） | 受管 Chrome | 低 | 仅限公司/学校等受管环境 |
| C. 本地 HTTP/WebSocket 伴随程序 | 安装后开机自启，或首次点击启动 | 视安装方式 | 全平台 | 中高 | 常驻进程、端口冲突、防火墙、鉴权与 CORS/CSP |
| D. 桌面 App（Tauri/Electron 外壳） | 双击安装，托盘/更新 | 否 | 全平台 | 高 | 工程量大、包体大、需要签名与更新体系 |
| E. 云端连接器 | 登录账号即可 | 否 | 全平台 | 高 | 本地 CLI 的登录态/文件/权限无法直接上云；隐私与成本 |
| F. 保持现状（`setup:native`） | 终端 + Node + 项目路径 | 否 | macOS / Linux | 低 | 普通用户门槛高；路径/浏览器差异导致“连不上” |

### A. 每用户安装包（推荐）

安装包只做三件事：

1. 把连接器放到稳定路径（例如 `~/.local/share/beehelper/connector/`、`~/Library/Application Support/BeeHelper/connector/`、`%LOCALAPPDATA%\BeeHelper\connector\`）；
2. 生成 host 清单，写入**所有检测到的 Chrome 系浏览器**的用户级目录（macOS/Linux），Windows 写 `HKCU` 注册表；
3. 结束。不注册开机自启、不启动后台服务。

原因是 native messaging 天然按需：Chrome 在扩展调用 `connectNative()` 时才启动 host 进程，扩展断开后进程退出。因此**不需要常驻 daemon**，安装包可以非常小，也没有“后台程序一直跑”的顾虑。

连接器本身建议做成**单文件可执行**：

- 用 esbuild 把 `connector/host.mjs` + 依赖打成一个 JS 文件，再用 Node SEA（single executable application）或 `@yao-pkg/pkg` 注入 Node 运行时；
- 或在 CI 里用 Bun compile；
- 产物体积约几十 MB（Node 运行时占大头），换来“用户不需要装 Node/npm”；
- macOS 需要 Developer ID 签名 + notarization；Windows 需要代码签名，否则 SmartScreen 会拦；Linux 提供 `.deb` / AppImage / tar.gz。

安装包形态：

| 平台 | 建议 | 说明 |
| --- | --- | --- |
| macOS | 签名 `.pkg`（用户级）或 `.dmg` 内含安装器 | 写入 `~/Library/Application Support/...`，不需要 sudo |
| Windows | NSIS/MSI，写 `HKCU` | 不需要管理员；同时支持 Edge/Chrome 的注册表位置 |
| Linux | `.deb`（系统级）或 AppImage + 用户级安装脚本 | `.deb` 需要 sudo；AppImage 可在用户目录运行并注册清单 |

版本与更新：

- host 清单指向稳定路径，安装包原地替换二进制；
- 扩展在连接握手时检查连接器版本（`connect` 返回的 `version` 或 `capabilities_get`），版本过旧时提示更新，而不是静默失败；
- 更新包同样需要签名；安装器可只替换二进制并保留清单。

### B. 企业策略（零用户操作）

如果 BeeHelper 面向公司内部统一管理的 Chrome：

- 管理员通过 `NativeMessagingHosts` 策略预注册 host 清单（`HKCU`/`HKLM` 或策略下发）；
- 通过 `ExtensionInstallForcelist` 强制安装固定 ID 的扩展；
- 用户打开浏览器即可用，不需要下载、不需要命令、不需要管理员交互。

这条路线对“公司同事批量使用”最省事，但不适用于个人用户，且需要 IT 管理权限。策略 JSON 的具体字段应以目标 Chrome 版本的企业策略文档为准，落地前需在测试机验证。

### C. 本地 HTTP/WebSocket 伴随程序

思路：扩展不依赖 native messaging，而是连 `http://127.0.0.1:<port>` 或 `ws://127.0.0.1:<port>`；伴随程序负责与 Codex/Claude/DSH 通信。

- 优点：不写浏览器清单、不受扩展 ID/浏览器类型限制；更新只换伴随程序；未来可支持 Edge/Brave/Firefox（需各自扩展 API）。
- 缺点：需要一个常驻进程（登录自启或手动启动）；端口冲突、防火墙弹窗；必须做严格的来源校验（`Origin: chrome-extension://<id>`）+ 一次性 token；扩展页面的 CSP/混合内容策略需要实测；用户多了一个“后台程序”的心理负担。
- 结论：作为**后续可选传输层**，不作为第一版；如果做，优先只监听 loopback，并默认拒绝非本扩展来源。

### D/E. 桌面 App 与云端

- 桌面 App 的体验最好（托盘、自动更新、统一安装），但等于维护第二个产品。
- 云端连接器无法直接复用本地 CLI 的登录态、文件系统和权限；还会引入隐私、成本和合规问题。两者都不建议在验证阶段投入。

## 推荐落地路线

### P0（本次已做）

- 修正 Chrome for Testing 的清单路径（macOS/Linux），更新 E2E 发现逻辑与单测。
- 设置页在“连接器未注册/没有可用客户端”时提供 **重新检测** 与 **安装说明** 入口，避免用户只能看报错。
- 文档补充真实路径、客户端选择、重启语义。

### P1（建议下一步，2–4 天 + CI）

1. `scripts/build-connector.mjs`：esbuild 打包 + Node SEA/pkg，产出 Linux/macOS/Windows 单文件；
2. `packaging/`：macOS pkg、Windows NSIS/MSI、Linux deb/AppImage 的安装脚本，注册所有 Chrome 系浏览器路径 + `HKCU` 注册表；
3. GitHub Actions matrix：三平台构建、上传 Release、生成 SHA256；macOS 签名/公证、Windows 签名在拿到证书后补；
4. 扩展侧增加“下载连接器”按钮（指向 GitHub Releases）与版本不匹配提示；
5. 保留 `npm run setup:native` 给开发者和自定义路径用户。

### P2（发布质量）

- 自动更新（Sparkle/WinSparkle/AppImageUpdate 或自建版本检查）；
- 企业策略包：一份 `NativeMessagingHosts` + `ExtensionInstallForcelist` 的部署说明；
- 安装器失败时的诊断日志与“复制诊断信息”按钮。

### P3（可选）

- WebSocket/HTTP 传输层，作为 native messaging 的替代或补充；需要安全评审后再默认开启。

## 安全与合规要点

- 只注册**用户级**清单，避免每次安装要管理员权限；
- `allowed_origins` 精确到扩展 ID，不使用通配符；
- 安装包不复制任何登录凭据；连接器只保存客户端可执行文件路径；
- 更新走 HTTPS + 签名校验；连接器与扩展互相校验版本；
- 不把“安装连接器”与“授权 AI 访问业务系统”混为一谈：前者只是通信管道，权限仍由各客户端的登录态和工具授权决定；
- 如果未来上架 Chrome Web Store，仍需外置安装器；商店不会替扩展安装本地程序。

## 工作量与判断

| 事项 | 估算 |
| --- | --- |
| 单文件连接器构建脚本 + Linux 产物 | 0.5–1 天 |
| macOS/Windows 构建与安装包 | 1–2 天（不含证书申请） |
| 签名/公证/自动更新 | 2–3 天（依赖证书与 CI 环境） |
| 扩展侧下载/版本提示/诊断 | 0.5 天 |
| 企业策略部署文档 | 0.5 天（需一台受管测试机验证） |

**建议：先做 P1 的“单文件 + 每用户安装包”，再补签名与企业策略。** 这样普通用户只需要“下载 → 双击 → 打开浏览器”，仍然保留一次操作系统级安装，但不再接触 Node、终端或项目路径。

## 参考资料

- Chrome 官方 Native Messaging 文档（清单字段、Windows 注册表、macOS/Linux 路径、`allowed_origins`）：<https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>（本机通过镜像 <https://developer.chrome.google.cn/docs/extensions/develop/concepts/native-messaging> 读取）
- MDN Native messaging（原生应用由操作系统安装、`connectNative()` 按需启动）：<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>
