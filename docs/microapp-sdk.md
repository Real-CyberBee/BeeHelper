# 微应用格式与 SDK

## 定义

当前支持单文件 JavaScript 异步函数体，不需要工程目录，也不要求用户执行构建。

```json
{
  "schemaVersion": 1,
  "title": "我的微应用",
  "description": "用途说明",
  "kind": "page",
  "matches": ["https://example.com/*"],
  "trigger": "manual",
  "code": "bee.log(document.title);"
}
```

- `kind=page` 在匹配网页的用户脚本环境执行，可访问该页 DOM。
- `kind=panel` 在侧边栏的隔离 iframe 中提供交互界面。
- `trigger=manual` 主动执行；`trigger=page` 用于已安装、已启用的页面脚本自动激活。
- `matches` 支持 HTTP/HTTPS Chrome match patterns 或 `<all_urls>`，不写端口。`http://localhost/*` 可匹配本地开发端口。
- 候选不自动安装。安装记录精确 revision；更新和恢复保留历史。

## 公共能力

| 调用 | 作用 |
| --- | --- |
| `bee.log(...values)` | 追加运行日志 |
| `bee.output(value)` | 输出结果 |
| `bee.mount(html)` | 挂载界面；page 返回 ShadowRoot，panel 返回容器 |
| `bee.fill(elementOrSelector, value)` | 填写字段并派发 input/change |
| `bee.on(target, event, callback, options?)` | 注册监听并纳入清理 |
| `bee.observe(target, callback, options?)` | 注册 MutationObserver 并纳入清理 |
| `bee.cleanup(callback)` | 登记自定义清理 |
| `await bee.storage.get(key)` | 读取此微应用的私有持久值 |
| `await bee.storage.set(key, value)` | 保存此微应用私有值，不纳入微应用包导出 |
| `await bee.tabs.list()` | 列出可操作标签页 |
| `await bee.tabs.open(url)` | 打开 HTTP/HTTPS 页面，返回 `{id, url}` |
| `await bee.tabs.inspect(tabId)` | 返回主文档文本、元素 selector、documentId |
| `await bee.tabs.action(args)` | 在确切文档执行 click/fill/select |
| `await bee.apps.list()` | 列出本地库中的微应用（标题、类型、安装/启用/收藏、当前版本，不含源码） |
| `await bee.apps.run(id, tabId?)` | 运行另一个微应用；页面脚本必须给 tabId，界面型省略 |
| `await bee.apps.update(id, {favorite?, enabled?})` | 修改收藏或启用状态，启用只对已安装微应用生效 |
| `await bee.askAI(prompt)` | 把需求投递给当前已连接的 AI 会话，并自动附上当前微应用引用 |

浏览器会话沿用实际页面的登录态，不提供虚构的独立账号容器。普通页面 `fetch` 遵循浏览器同源与凭据规则；SDK 不承诺任意 API 可跨域直接访问。

## 组合与自我改造

微应用不只是终点，也可以是其他微应用的调用方：

```js
// 列出并运行另一个微应用
const apps = await bee.apps.list();
const other = apps.find(app => app.title === "页面元素探针");
if (other) await bee.apps.run(other.id, (await bee.tabs.list()).find(tab => tab.active)?.id);
```

```js
// 让侧边栏里的 AI 改自己
await bee.askAI("把界面改成两栏，左边输入右边结果，保留现有按钮");
```

`bee.askAI` 的实际行为：向当前活动会话投递一条消息，消息附带**当前微应用**作为引用，并进入正常消息队列；AI 用 `microapp_get` 读取源码、用 `microapp_update` 产生新版本。它不会绕过用户：AI 的改动仍是新版本，用户可以查看、试用或丢弃。

前提与限制：

- 需要用户已在侧边栏连接 AI 客户端；未连接时抛出可读错误，不会悄悄失败。
- 会话正在执行时消息进入队列，不会打断当前任务。
- 不要用 `bee.askAI` 偷偷收集页面内容发出去；它应该由用户的点击触发，并在界面里说明要做什么。
- `bee.apps.run` 运行页面脚本需要明确的 tabId；运行界面型微应用会占用当前预览位。

这两个能力是“一切皆插件”和“AI 改造自身”的基础，示例见[示例画廊](demos.md)。

## 用户脚本导入

从 Tampermonkey 生态导入的脚本会被转成普通微应用，并自动带上 GM 兼容层。转换规则、支持的 GM API、限制与 AI 工具见 [Tampermonkey 生态对接](userscripts.md)。

## 页面增强

```js
const root = bee.mount(`
  <button id="read-title">读取标题</button>
  <output id="result"></output>
`);
bee.on(root.querySelector("#read-title"), "click", () => {
  root.querySelector("#result").textContent = document.title;
  bee.log("已读取页面标题");
});
```

同一微应用再次运行会先清理旧实例。安装可接管同版本试用，不应重复注册监听；页面导航、禁用、卸载会清理登记的页面资源。原生定时器、任意自建监听不受自动清理保证，应使用 `bee.cleanup` 登记。

## 跨标签页

```js
const tabs = await bee.tabs.list();
const target = tabs.find(tab => tab.url.startsWith("https://example.com/"));
if (!target) throw new Error("请先打开目标页面");
const page = await bee.tabs.inspect(target.id);
const field = page.elements.find(item => item.name === "email");
if (!field) throw new Error("联系邮箱字段不存在");
await bee.tabs.action({
  tabId: target.id,
  documentId: page.documentId,
  selector: field.selector,
  action: "fill",
  value: "qa@example.com"
});
```

页面导航后必须重新观察，不能重用旧 documentId 或猜测 selector。打开页面后也需要确认其已加载到预期状态，不要把标签页创建成功当作业务页面准备完毕。

## Agent 工具与上下文（0.1.1）

- `capabilities_get`：读取实际工具清单、用户脚本可用状态和能力范围，不能靠旧对话猜测权限。
- `microapp_get({id})`：读取所选微应用及其已保存源码；每轮上下文中的摘要不等于完整源码。
- `browser_inspect({tabId, selector?, limit?})`：观察主文档与开放 Shadow DOM。默认 200、最多 500 个控件；`truncated=true` 时可缩小范围继续观察。
- `browser_action`：用最近观察的 documentId 和 selector 操作；click 不需要 value，fill/select 必须提供字符串。select 适用于原生下拉，自定义下拉使用点击与重新观察。
- `run_list({appId?, tabId?, limit?})`：查找最近的完整运行 ID。
- `run_get({runId})`：读取实际状态与日志；不是微应用 ID 或界面显示的缩略 UUID。兼容旧参数 id。

观察结果中的生成引用可能在下一次观察时更新，应使用最新 selector。开放 Shadow DOM 内的悬浮按钮可以观察并点击，关闭的 Shadow DOM 没有通用支持。

`status=active` 表示脚本挂载了界面或监听，不代表点击后的逻辑已经执行。验证按钮型微应用时，需要点击按钮，再检查页面状态与运行日志。通用文件上传暂不属于内置工具，不能把点开 Upload 或发现 file input 当作成功上传。

## 安装包

导出 JSON 包包含 `format=beehelper.microapp`、格式版本与微应用源码历史。导入会分配新的微应用身份，并作为未安装候选出现，绝不在解析时执行源码。

导出不包含微应用私有存储、对话和连接器凭据；作者仍不应在源码中硬编码业务密码或 token。当前单包上限 5 MB，版本最多 500 条；不支持的格式与非法匹配规则会被拒绝。
