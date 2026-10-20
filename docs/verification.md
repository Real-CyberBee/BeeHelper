# 本机验证记录

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
