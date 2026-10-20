# BeeHelper

浏览器侧边栏 AI 微应用工作台。借鉴 Tampermonkey 的脚本自由度，以浏览器环境下的 everything-is-a-plugin 为设计理念，首版连接外部 Codex。

## 0.1.1 修复

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

需要 Chrome 138+、Node.js 22.12+、已安装并登录的 Codex CLI。本版本在 macOS 验证；Native Messaging 安装器也包含 Linux 路径，但未做 Linux 实机验证，不支持 Windows 安装。

## 已实现的首版

- 未安装候选可直接运行或显示隔离界面，也可一键安装到本地库。
- 搜索、收藏、源码编辑、版本记录与恢复、导入导出。
- 页面脚本、交互界面、跨标签页观察与操作、微应用私有存储。
- 匹配页面自动激活、SPA 变化、事件登记与资源清理。
- Codex App Server + MCP + Native Messaging 的真实连接，不自研 agent loop。
- Codex 修改的是 BeeHelper 中的源码，不要求用户维护本地工程。

实现是本地验证版本，不是完整产品发布。未接入真实业务系统接口，也不承诺任意 npm 包、所有浏览器或商店审核通过。

## 验证

```sh
npm run check
npm test
npm run test:e2e
npm run doctor
```

E2E 使用独立 Chromium 测试配置，不操作个人 Chrome 的页面和 Cookie。测试浏览器可用 `CHROME_PATH` 指定；缺失时先执行 `npx playwright install chromium`。真实模型验证需显式设置：

```sh
BEEHELPER_LIVE_CODEX=1 npm run test:e2e
```

该项会使用已登录 Codex 的实际模型额度；默认 E2E 只验证真实连接与本地执行，不发送模型请求。

## 文档

- [产品需求与首版范围](docs/product.md)
- [技术方案初稿](docs/architecture.md)
- [运行时与 Agent 选型调研](docs/research/README.md)
- [本机测试与排障](docs/local-testing.md)
- [微应用格式与 SDK](docs/microapp-sdk.md)
- [本机验证记录](docs/verification.md)

## 首个验证场景

在本地模拟测试工具创建店铺，完成商家入驻，再填写三步客户表单。

具体业务规则由微应用作者通过 AI 对话持续调整，不写成 BeeHelper 平台的固定逻辑。

## 公开仓库与本地数据

仓库仅包含源码、合成测试页面和项目文档，不包含浏览器登录态、微应用库、对话、业务数据或 Codex 凭据。`.local/`、依赖、构建产物和测试报告不提交；新环境需自行构建并注册本地连接器。扩展 manifest 中的 `key` 是用于固定开发扩展 ID 的公开密钥，不是私钥。

不要提交 `.env`、`.npmrc`、密钥、个人浏览器配置或真实业务微应用导出包；分享微应用前应检查源码中是否包含凭据、内部地址和业务数据。
