# beehelper 浏览器运行时边界

日期：2026-10-18。范围：Chrome Manifest V3（MV3）扩展、普通 Web / PWA；只读官方资料，不涉及 agent SDK 或客户端桥接实现。
验证状态：**已核实官方文档；未做浏览器运行实测、线程工具链验证、跨平台兼容性测试或商店送审。** 下文“支持”是文档结论，不是本项目运行结果。

## 核心结论

1. **扩展本身支持 WASM，不需要先做网页/PWA。** MV3 的 `extension_pages` CSP 覆盖扩展页面与 worker；默认禁用 WASM，可显式加入 `wasm-unsafe-eval`。该项不开放 JavaScript `eval()` / `new Function()`。[1]
2. **PWA 安装不是通用权限升级，也不是常驻进程。** 部分应用集成能力确实依赖安装，但敏感能力仍有授权和平台限制，后台 Service Worker 仍可能被终止。[10][11]
3. **扩展 + PWA 仍有价值。** 普通 Web 上下文不受 MV3 扩展页的固定 CSP 下限约束，可在自己的 CSP 和源安全规则允许下采用更灵活的动态代码加载/执行策略；PWA 可提供独立工作台。价值来自执行环境和发布边界，而非安装后的提权。[1][7][10]
4. **service worker 的限制不等于整个扩展的限制；浏览器能执行也不等于商店允许发布。** 必须按上下文与政策分别判断。[1][2][3][8]

## 简洁能力矩阵

| 上下文 | WASM / 动态代码 | 生命周期与职责 |
| --- | --- | --- |
| 扩展页面（tab、side panel、popup） | CSP 加 `wasm-unsafe-eval` 可运行 WASM；普通特权扩展页不能用 `unsafe-eval` 开放 JS 字符串求值。[1] | 可用 Dedicated Worker 分担计算；不要把 popup 当作常驻任务宿主。[4] |
| 扩展 offscreen 文档 | 仍受扩展 CSP 约束，不是 eval 豁免区；`WORKERS` 是官方创建理由。[1][2] | 有 DOM；扩展 API 仅直接支持 `chrome.runtime`。按配置文件同时一个文档，分离无痕另计；适合无可见窗口的 DOM/Worker 容器。[2] |
| 扩展 Dedicated Worker | 扩展 CSP 允许下可用 WASM；共享内存线程需另外判断隔离条件。[1][5] | 承接计算，不代表可脱离浏览器生命周期永久运行；OPFS 同步句柄限定 Dedicated Worker。[4][6] |
| 扩展 service worker | CSP 允许下可用 WASM；无 DOM，不能据此否定其他扩展上下文的 DOM/Worker 能力。[1][3] | 事件驱动、可能终止；**Chrome 124 已支持其使用 WebGPU**，不能笼统说 service worker 不支持 GPU。[3][9] |
| Web / PWA 页面 + Worker | 普通 Web 即可运行 WASM；动态 JS 执行取决于网站自己的 CSP 等约束，安装 PWA 不是前提。[5][7] | 可作为独立计算/微应用工作台，但不是扩展权限容器，也没有无限后台执行保证。[10][11] |
| Native Messaging 本地程序 | 单独部署的本地可执行程序，不是 WASM 在浏览器内提权。[14] | 可提供浏览器外能力；实际 OS 能力由程序运行身份和系统权限决定，不等于拥有整台机器权限。 |

## CSP、线程与长任务

- **WASM 配置：** 官方允许的扩展声明为 `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"}`。`wasm-unsafe-eval` 与 JS `unsafe-eval` 必须区分。[1]
- **WASM 多线程：** 单线程 WASM 不要求 SharedArrayBuffer；共享内存线程通常需要 Worker、共享 `WebAssembly.Memory`、原子操作及跨源隔离。普通 Web 的典型响应头为 `COOP: same-origin`、`COEP: require-corp`，也可考虑 `credentialless`；应检查 `crossOriginIsolated` 和资源加载条件。PWA 安装不能替代隔离要求。[5][12]
- **扩展线程未验证：** 本次未运行扩展 COOP/COEP 配置、offscreen/Worker 隔离组合或实际 WASM 线程工具链，不能从“支持 WASM”推导“所有上下文都支持多线程”。建议把扩展文档 + Dedicated Worker 作为待验证候选，而非已实测结论。
- **扩展 service worker：** 通常会在空闲约 30 秒、单个事件/API 请求超过 5 分钟或 `fetch()` 响应等待超过 30 秒时终止；存在明确 API/连接例外。这些不是整个扩展的统一时限，也不是长任务必定获得的运行预算。[3]
- **offscreen：** `AUDIO_PLAYBACK` 停止播放 30 秒后会关闭；其他理由没有该 API 规定的时限，但不能据此承诺永久存活。Chrome 明确不把它定位为 MV2 常驻 background page 的完整替代品。[2][13]
- **PWA：** Service Worker 的 `waitUntil()` 不能保证不被终止；安装 PWA 本身不解决不可中断长计算问题。[11]

## 动态微应用：技术与政策

| 路径 | 已证实边界 |
| --- | --- |
| 普通扩展页 / offscreen | 特权上下文不能通过 `unsafe-eval` 放开 JS eval；WASM 有专用 CSP 开关。CWS 另有限制远程托管可执行代码的政策，包括 JS/WASM，不能混同为单纯 API 限制。[1][8][15] |
| 扩展 sandbox 页面 | 可以有允许 `unsafe-eval` 的独立 CSP；隔离为独特源，不能直接访问扩展 API/其他扩展页。CWS 对隔离上下文有特定条款，但完整功能仍须可审查，不是自动合规豁免。[8][16] |
| `chrome.userScripts` | 面向用户脚本在匹配网页执行，有独立执行 world/CSP；需要权限和用户启用。Chrome 138+ 使用 Allow User Scripts 开关，旧版本依赖开发者模式。不是任意远程更新特权扩展主逻辑的通用接口。[8][17] |
| 独立 Web / PWA | 可以采用自身 CSP 允许的动态加载/执行策略；不自动获得扩展 API。与扩展协作仍应保留授权和特权边界；把逻辑移到远端不代表相关扩展自动满足 CWS 政策。[7][8][10] |

## OPFS、WebGPU 与本地能力

- **OPFS：** 源私有存储，不是任意本地目录权限；受配额及清除站点数据影响，通常不需文件权限弹窗。同步访问句柄只在 Dedicated Worker 可用，不能泛化为所有 worker。扩展可以使用 Web 存储 API；PWA 安装不是 OPFS 前提。[6][18]
- **WebGPU：** 普通 Web 与 worker 有对应入口，需要安全上下文和可用设备；Chrome 124 明确新增 SharedWorker/Service Worker 支持并链接扩展示例。实际 GPU/adapter 可用性未验证，不能凭“扩展/PWA”标签保证。[9][19]
- **Native Messaging：** 需要扩展 `nativeMessaging` 权限、单独安装/登记的 native host 及 `allowed_origins`。Chrome 不负责安装本地程序；这是浏览器外能力的部署选项，而非 PWA 自带权限。本文不展开通信或桥接设计。[14]

## 推荐部署边界

以下为基于文档的工程建议，非已验证实现：
1. **扩展负责可信控制面。** service worker 做事件调度与任务恢复，扩展页面/offscreen + Dedicated Worker 承接计算；不要仅为 WASM 引入 PWA。
2. **PWA 作为可选工作台和动态微应用宿主。** 需要更灵活的 Web 代码执行/分发、独立窗口时有价值；与扩展协作不应让动态代码无条件驱动特权动作。
3. **本地程序只承接确需浏览器外权限的能力。** 单独承担安装、授权和系统权限成本；不把 PWA 安装等同本地提权。

## 官方来源

[1] Chrome 扩展 CSP：https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy
[2] Chrome offscreen：https://developer.chrome.com/docs/extensions/reference/api/offscreen
[3] Chrome 扩展 service worker 生命周期：https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
[4] MDN Web Workers：https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
[5] Google WASM 线程：https://web.dev/articles/webassembly-threads
[6] MDN OPFS：https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
[7] MDN CSP script-src：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src
[8] CWS MV3 政策：https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements
[9] Chrome WebGPU 124：https://developer.chrome.com/blog/new-in-webgpu-124
[10] Google PWA 能力与授权：https://web.dev/learn/pwa/capabilities
[11] MDN PWA 后台执行：https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
[12] MDN SharedArrayBuffer：https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer
[13] Chrome offscreen 设计：https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3
[14] Chrome Native Messaging：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
[15] Chrome 远程托管代码：https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
[16] Chrome sandbox：https://developer.chrome.com/docs/extensions/reference/manifest/sandbox
[17] Chrome userScripts：https://developer.chrome.com/docs/extensions/reference/api/userScripts
[18] Chrome 扩展存储：https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
[19] MDN WorkerNavigator.gpu：https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu
