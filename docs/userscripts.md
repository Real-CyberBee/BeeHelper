# Tampermonkey 生态对接

BeeHelper 不实现 Tampermonkey 兼容层去争夺脚本管理器市场，而是把用户脚本**变成可读、可改、可试、可安装的微应用**。脚本跑起来只是起点，能继续对话微调才是 BeeHelper 的价值。

## 1. 脚本来源

| 来源 | 接口 | 可达性 | 说明 |
| --- | --- | --- | --- |
| ScriptCat 脚本站（默认） | `https://scriptcat.org/api/v2/scripts` | 国内通常可直连 | 支持关键词、最热门、近日热门、最近更新、评分 |
| GreasyFork | `https://greasyfork.org/scripts.json` | 部分网络环境被阻断 | 全球最大用户脚本站，作为可选来源 |
| 本地文件 | `.user.js` 文本 | 始终可用 | 在脚本市场里选择本地文件 |

- 搜索在扩展后台执行：扩展拥有站点访问权限，不受网页 CORS 限制。网页预览（`npm run dev` 的普通页面）没有该权限，会提示改用扩展。
- 单次搜索最多 40 条，默认 20 条；相同查询 5 分钟内复用缓存，避免频繁请求来源站。
- 网络超时为 12 秒，失败时给出可操作的提示（换来源、稍后重试、离线导入），不会静默失败。
- 来源站不可用时，已导入的微应用不受影响。

## 2. 从脚本到微应用

导入时按以下规则转换，转换结果都写在微应用的描述里，用户能看到实际发生了什么。

| 用户脚本 | BeeHelper | 说明 |
| --- | --- | --- |
| `@name` | 微应用名称 | 去除多余空白，最长 100 字 |
| `@description` | 微应用描述 | 追加来源、作者、版本、安装量、原始页面 |
| `@match` / `@include` | 页面匹配规则 | 转成 Chrome match pattern；正则形式的 `@include` 无法等价转换时明确跳过 |
| host 带端口 | 去掉端口 | Chrome match pattern 不支持端口，匹配时按主机比较 |
| `@exclude` | 运行时检查 | 生成页面内判断，命中时记录日志并跳过 |
| `@grant` | GM 兼容层 | 见下一节；不支持的 API 会写进描述 |
| `@require` | 不自动加载 | 依赖不会被静默下载执行，描述里列出缺失的库 |
| `@run-at` | 页面空闲后执行 | `document-start` 类逻辑可能需要调整 |
| 源码正文 | 微应用源码 | 前接 GM 兼容层，单文件，最长 900 KB |

导入结果一律是**未安装候选**、`kind=page`、`trigger=manual`：不会自动运行，也不会自动安装。要改成页面自动激活，需要用户在“编辑属性”里显式修改并安装。

### 安全边界

- 导入只解析文本，不执行任何代码。
- 导入的脚本不会被自动运行；页面自动激活只对已安装且已启用的微应用生效。
- 不把脚本内容上传到任何服务器。
- 来源站只看到搜索关键词和脚本下载请求，用户页面数据不经过来源站。
- 第三方脚本的行为由原作者决定；导入后应先用“查看效果”在目标页面试用，确认后再安装。

## 3. GM 兼容层

导入时会在源码前注入一层纯 JavaScript 桥接，映射到 BeeHelper 的 `bee` SDK。已实现：

`GM_info`、`GM_getValue`、`GM_setValue`、`GM_deleteValue`、`GM_listValues`、`GM_addValueChangeListener`、`GM_removeValueChangeListener`、`GM_addStyle`、`GM_addElement`、`GM_xmlhttpRequest`、`GM_notification`、`GM_setClipboard`、`GM_openInTab`、`GM_registerMenuCommand`、`GM_unregisterMenuCommand`、`GM_getTab`、`GM_saveTab`、`unsafeWindow`。

只有占位实现（调用时记录日志，不假装成功）：`GM_getResourceText`、`GM_getResourceURL`、`GM_download`、`GM_cookie`，以及 `@grant` 中列出的其他 API。

已知限制：

1. **隔离世界**：微应用运行在浏览器隔离世界，能看到 DOM，但访问不到页面自身脚本挂在 `window` 上的对象。依赖 `unsafeWindow.someLib` 的脚本需要改写。
2. **网络**：`GM_xmlhttpRequest` 使用页面 `fetch`，遵循网页同源/CORS 规则，不提供跨域特权。
3. **资源**：`@resource` 与 `@require` 不会自动下载；脚本若依赖它们会缺少函数。
4. **菜单**：`GM_registerMenuCommand` 只登记命令，BeeHelper 没有 Tampermonkey 的脚本菜单 UI。
5. **执行时机**：在页面空闲后执行，不支持 `document-start`。

这些限制都会写进导入后的微应用描述，AI 会话和用户都能看到。

## 4. 让 AI 帮你找脚本

连接 Agent 后，模型可以直接调用两个工具：

- `userscript_search({ query?, source?, sort?, limit? })`：搜索脚本生态，返回名称、简介、安装量、作者、来源链接，不导入。
- `userscript_import({ id, source? })`：把选中的脚本导入为未安装候选，返回匹配范围、导入限制与缺失依赖。

推荐对话：

> 帮我找一个能自动展开知乎回答的脚本，找 3 个热门的让我选。

模型会先搜索并列候选，你确认后它再导入，然后用 `microapp_get` 读源码、说明匹配范围和限制，最后按你的要求试运行或安装。

`capabilities_get` 会返回 `userscripts` 字段，说明当前来源、工具名与行为，避免模型臆测。

## 5. 离线与自建来源

- 本地 `.user.js`：脚本市场 → “本地 .user.js”，选择文件即可转换（上限 2 MB）。
- 新增来源：在 `src/core/script-sources.ts` 中实现搜索与取源码函数，并加入 `ScriptSource` 与 `sortParams`。来源必须返回可解析的元数据块文本；不支持直接执行远程代码。
- 来源差异只影响“搜索/下载”，转换与 GM 兼容层完全共用，避免两套逻辑。

## 6. 已知未做

- 不兼容 Tampermonkey 的脚本菜单、`@require` 自动加载、`GM_cookie`、`GM_download`、跨域请求特权。
- 不做脚本自动更新检查；导入的是一份确切源码，后续更新由用户或 AI 修改。
- 不批量导入整个脚本库，也不自动安装来源站的“推荐脚本”。
