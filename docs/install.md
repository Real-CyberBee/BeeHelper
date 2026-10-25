# 下载与分平台安装

适用版本：**0.6.0 公开预览版**。统一要求 Chrome 138+；扩展尚未上架商店，需要开启开发者模式加载。已有微应用无需 AI；AI 创作需要另外安装并登录本地 Agent。

## 选择下载

| 系统 | 处理器 | 下载文件 | 包内运行方式 |
| --- | --- | --- | --- |
| macOS | Apple Silicon / arm64 | [macOS arm64 DMG](https://github.com/Real-CyberBee/BeeHelper/releases/download/v0.6.0/BeeHelper-0.6.0-macOS-arm64.dmg) | 系统 JavaScriptCore，不携带 Node |
| macOS | Intel / x64 | [macOS Intel DMG](https://github.com/Real-CyberBee/BeeHelper/releases/download/v0.6.0/BeeHelper-0.6.0-macOS-x64.dmg) | 系统 JavaScriptCore，不携带 Node |
| Windows | Intel / AMD x64 | [Windows x64 ZIP](https://github.com/Real-CyberBee/BeeHelper/releases/download/v0.6.0/BeeHelper-0.6.0-Windows-x64.zip) | 内置 Node，.NET Framework 4.x 启动器 |
| Linux | Intel / AMD x64 | [Linux x64 tar.gz](https://github.com/Real-CyberBee/BeeHelper/releases/download/v0.6.0/BeeHelper-0.6.0-Linux-x64.tar.gz) | 内置 Node，glibc 2.28+ |

[全部 Release 文件与校验值](https://github.com/Real-CyberBee/BeeHelper/releases/tag/v0.6.0)。Linux / Windows ARM 与 Linux musl 发行版暂未提供安装包。macOS 编译目标为 13+；CI 构建与协议烟测不能替代所有系统版本的实机验收。

预览包未完成商业代码签名。macOS 暂无 Developer ID 签名与 Apple 公证，Windows 暂无 Authenticode 签名；系统可能阻止启动。不要关闭系统保护，遇到拦截可反馈给维护者或使用源码开发方式。

## macOS 安装

1. 选择与你的处理器匹配的 DMG。“关于本机”显示 Apple 芯片时选 arm64，显示 Intel 时选 x64。
2. 打开 DMG，运行 **BeeHelper Installer.app**，选择“安装 / 修复”。安装过程不需要管理员权限。
3. Finder 会打开扩展目录，按照下面的“加载 Chrome 扩展”步骤操作。

连接器和扩展复制到 `~/Library/Application Support/BeeHelper/`。连接器由浏览器按需启动，不注册登录自启，不在首次运行时下载运行时。

详细流程和 macOS 修复、卸载见[首次使用说明](getting-started.md)。

## Windows 安装

系统要求：Windows 10 / 11 x64，已启用 .NET Framework 4.x（启动器所需）。包内已带 Node 运行时，无需另装 Node/npm。

1. 下载 Windows ZIP，**完整解压**；不要在压缩包预览窗口内运行文件。
2. 双击 `install.cmd`。使用当前用户安装，不需要“以管理员身份运行”。完成后窗口会输出扩展目录。
3. 安装器把文件复制到 `%LOCALAPPDATA%\BeeHelper\releases\`，并在当前用户的 Chrome / Chromium `NativeMessagingHosts` 注册表项登记宿主。
4. 复制窗口中的 `extensionDirectory` 路径，在 Chrome 加载该目录。

安装完成后，下载文件夹可以移走；浏览器使用的是复制后的版本目录。源码 ZIP 与 Windows 安装 ZIP 不同，源码 ZIP 不包含运行时或已构建扩展。

### Windows 修复与卸载

- 修复或更新：结束在途 AI 任务，再运行新包的 `install.cmd`，随后在 Chrome 重新加载扩展。若版本目录发生变化，使用安装器输出的新扩展目录重新载入；旧目录会保留。
- 卸载连接器登记：运行下载包中的 `uninstall.cmd`。它只移除仍指向本安装根目录的宿主清单和注册表默认值。
- 在 Chrome 单独移除扩展。安装器保留历史版本目录与浏览器数据；确认所有扩展已移除后，可手动删除 `%LOCALAPPDATA%\BeeHelper\releases\` 回收磁盘空间。不要在仍加载扩展时删除其目录。

## Linux 安装

系统要求：x64、glibc 2.28+，例如 Ubuntu 22.04 / 24.04。当前不支持 Alpine 等使用 musl 的发行版；Snap / Flatpak 浏览器的宿主发现路径与隔离规则可能不同，尚未验收。

下载 tar.gz 后，在普通用户终端中执行：

```sh
tar -xzf BeeHelper-0.6.0-Linux-x64.tar.gz
cd BeeHelper-0.6.0-Linux-x64
./install.sh
```

不要使用 `sudo`。安装器将文件复制到 `~/.local/share/BeeHelper/releases/`，并在当前用户的 Chrome、Chrome for Testing 和 Chromium 配置目录写入 Native Messaging 清单。包内已携带 Node，无需另装 Node/npm。

记录终端输出的 `extensionDirectory`，再按照下面步骤加载扩展。

### Linux 修复与卸载

- 修复或更新：结束在途任务，再运行新包 `./install.sh`，然后加载新输出的扩展目录。
- 卸载连接器登记：从下载解压目录运行 `./uninstall.sh`。在 Chrome 中单独移除扩展。
- 历史安装版本目录会保留，确认没有扩展继续使用后，可手动删除 `~/.local/share/BeeHelper/releases/`。工作区 `~/.local/share/beehelper/workspace/` 与 Agent 登录不受卸载影响。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions/`，开启右上角的“开发者模式”。
2. 点击“加载已解压的扩展”，选择安装器输出的 **extension 目录**，不要选择 ZIP、DMG 或整个安装根目录。
3. 打开 BeeHelper 的“详细信息”，启用“允许用户脚本”。
4. 点击浏览器工具栏的 BeeHelper 图标，打开原生侧边栏。
5. 根据首次使用向导完成检测。从示例画廊添加“批量文本整理”，输入几行重复内容，点击去重，验证本地功能。

在受组织策略限制的浏览器中，开发者模式、用户脚本或 Native Messaging 可能由管理员控制。

## 连接本地 AI Agent

安装连接器不等于已经安装或登录 AI Agent。先独立准备 Codex CLI、Claude Code 或 DeepSeek Harness；再在 BeeHelper 向导中点击“重新检测”，选择客户端并连接。

- **Codex**：使用本机 Codex CLI 的 App Server 会话。
- **Claude Code**：除 Claude CLI 外，还需要独立安装的 `claude-agent-acp` 适配器。Windows 支持识别标准 npm JavaScript shim；自定义批处理脚本请改用实际 exe 或 JavaScript 入口。
- **DeepSeek Harness**：使用 ACP 模式，能力取决于客户端实际声明。
- Windows 下通过 WSL 安装的 Agent 不等于 Windows 宿主能直接启动的本地 Agent；本版不自动桥接 WSL，请在目标 Windows 环境准备可执行入口。

模型账号、权限和额度由对应 Agent 提供。详细说明见[Agent 会话与插件](agent-sessions.md)。

<a id="troubleshooting"></a>

## 常见问题

### 提示连接器未安装

1. 确认运行过对应系统的安装脚本，且安装成功。
2. 在侧边栏点击“重新检测”；仍失败时完全退出并重启浏览器。
3. 确认浏览器使用安装时的同一操作系统用户，扩展来自 BeeHelper 发布包。
4. 企业策略、Linux 沙箱浏览器、其他浏览器发行版可能阻止宿主发现。当前主要支持普通 Chrome / Chromium。

### 连接器可用，但没有 AI 客户端

先确认客户端在本机可执行、已登录且有可用额度。Windows npm shim 会转换为 JavaScript 入口，不执行任意批处理；通过 `BEEHELPER_CODEX`、`BEEHELPER_CLAUDE`、`BEEHELPER_CLAUDE_ACP`、`BEEHELPER_DSH` 可指定绝对路径。环境变量修改后须重启浏览器才能继承。

也可通过绝对路径 `BEEHELPER_AGENTS_CONFIG` 指定自定义 ACP 配置，详见[Agent 文档](agent-sessions.md)。

### 扩展加载失败或提示目录不存在

选择安装器最后输出的 `extensionDirectory`，确认该目录含 `manifest.json`。升级安装会创建新版本目录；保留浏览器正在使用的目录，重新载入新目录后再清理旧版本。

### 如何校验下载

从 Release 下载 `SHA256SUMS.txt`，对照对应文件名的 SHA256。

Linux：

```sh
sha256sum BeeHelper-0.6.0-Linux-x64.tar.gz
```

macOS：

```sh
shasum -a 256 BeeHelper-0.6.0-macOS-arm64.dmg
```

Windows PowerShell：

```powershell
Get-FileHash .\BeeHelper-0.6.0-Windows-x64.zip -Algorithm SHA256
```

### 想从源码构建

开发者需要 Node.js 22.12+、npm 和对应系统工具链。克隆仓库后运行 `npm ci`、`npm run build`。macOS 使用 `npm run build:installer`；Linux / Windows 使用 `npm run build:portable`，并通过 `BEEHELPER_NODE_LICENSE` 指定所用 Node 版本的官方 LICENSE 文件。构建细节见仓库的 `scripts/build-portable.mjs` 与 Release 工作流。

源码模式的 `npm run setup:native` 支持 macOS / Linux。Windows 用户优先使用带 exe 宿主的发行包；本版没有把 `.cmd` 文件直接冒充 Chrome 原生宿主。

## 数据与升级约定

微应用库和会话保存在浏览器扩展存储中；连接器只负责本地通信。升级前结束在途任务，避免执行结果不明时重复提交。停止或卸载微应用不会撤销已发生的网页操作。卸载连接器不会清除 Agent 的登录凭据。
