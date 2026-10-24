import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Definition } from "../../src/core/model";
import { panelSample } from "../../src/core/samples";
import { connectorTest, copyInstalledNativeHost, e2eTempDirectory, enableUserScripts, extensionUrl, launchExtensionContext, liveModelTest, waitForServiceWorker, writeNativeHostFixture } from "./harness";

let context: BrowserContext, ui: Page, demo: Page, tabId: number;
const errors: string[] = [];
async function rpc(page: Page, type: string, data: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(async ({ type, data }) => {
    const response = await chrome.runtime.sendMessage({ channel: "bee:request", type, ...data });
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }, { type, data });
}
test.describe.serial("真实扩展本地闭环", () => {
  test.beforeAll(async () => {
    const directory = await e2eTempDirectory("beehelper-e2e-");
    // 默认用仓库内 fake ACP agent 夹具，不依赖本机连接器；需要真连 Codex 时才复制已安装清单。
    if (connectorTest) await copyInstalledNativeHost(directory);
    else if (process.platform !== "win32") await writeNativeHostFixture(directory, [
      { id: "fixture-acp", name: "Fixture ACP", args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture"] }
    ]);
    const extension = path.resolve("dist");
    context = await launchExtensionContext(directory, { extension });
    const worker = await waitForServiceWorker(context);
    worker.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await enableUserScripts(context);
    demo = await context.newPage(); await demo.goto("http://127.0.0.1:4173/demo.html?view=client");
    ui = await context.newPage(); ui.on("pageerror", error => errors.push(error.message)); await ui.goto(extensionUrl);
    await expect(ui.getByRole("heading", { name: "微应用库" })).toBeVisible();
    await ui.getByRole("dialog", { name: "首次使用与诊断" }).getByRole("button", { name: "开始使用微应用" }).click();
    const tabs = await rpc(ui, "tabs");
    tabId = tabs.find((tab: any) => tab.url.includes("demo.html")).id;
    await mkdir(".local/screenshots", { recursive: true });
  });
  test.afterAll(async () => { await context?.close(); });
  test("上下文回归：点击不携带 value 时仍能改变真实控件", async () => {
    await demo.evaluate(() => {
      const button = document.createElement("button");
      button.id = "individual-registration";
      button.textContent = "Individual Registration";
      button.addEventListener("click", () => { document.documentElement.dataset.registration = "individual"; });
      document.body.append(button);
    });
    const definition: Definition = { ...panelSample, kind: "page", title: "点击参数回归", matches: ["http://127.0.0.1/*"], code: `const page = await bee.tabs.inspect(${tabId}); await bee.tabs.action({tabId:${tabId},documentId:page.documentId,selector:"#individual-registration",action:"click"});` };
    const entry = await rpc(ui, "operation", { operation: { type: "create", definition } });
    const result = await rpc(ui, "run", { id: entry.id, revisionId: entry.revisionId, tabId });
    const run = (await rpc(ui, "state")).db.runs.find((run: any) => run.id === result.runId);
    expect(run.status, JSON.stringify(run.logs)).toBe("succeeded");
    await expect(demo.locator("html")).toHaveAttribute("data-registration", "individual");
    await rpc(ui, "operation", { operation: { type: "delete", id: entry.id } });
    await demo.locator("#individual-registration").evaluate(element => element.remove());
  });
  test("上下文回归：观察并点击微应用的 Shadow DOM 悬浮按钮", async () => {
    const widget = await rpc(ui, "operation", { operation: { type: "create", definition: {
      ...panelSample, kind: "page", title: "Shadow DOM 按钮回归", matches: ["http://127.0.0.1/*"],
      code: 'const root = bee.mount(`<button id="shadow-fill">填写测试表单</button>`); bee.on(root.querySelector("#shadow-fill"), "click", () => { bee.fill("[name=email]", "shadow@example.com"); bee.log("悬浮按钮已执行"); });'
    } } });
    await rpc(ui, "run", { id: widget.id, revisionId: widget.revisionId, tabId });
    const inspector = await rpc(ui, "operation", { operation: { type: "create", definition: {
      ...panelSample, kind: "page", title: "Shadow DOM 工具观察回归", matches: ["http://127.0.0.1/*"],
      code: `const page = await bee.tabs.inspect(${tabId}); const button = page.elements.find(item => item.label === "填写测试表单"); if (!button) throw new Error("页面观察没有返回微应用 Shadow DOM 按钮"); await bee.tabs.action({tabId:${tabId},documentId:page.documentId,selector:button.selector,action:"click"});`
    } } });
    const result = await rpc(ui, "run", { id: inspector.id, revisionId: inspector.revisionId, tabId });
    const run = (await rpc(ui, "state")).db.runs.find((run: any) => run.id === result.runId);
    expect(run.status, JSON.stringify(run.logs)).toBe("succeeded");
    await expect(demo.locator('[name="email"]')).toHaveValue("shadow@example.com");
    await expect.poll(async () => (await rpc(ui, "state")).db.runs.find((run: any) => run.appId === widget.id).logs.some((log: any) => log.text === "悬浮按钮已执行")).toBe(true);
    await rpc(ui, "stop", { runId: result.runId });
    await rpc(ui, "operation", { operation: { type: "delete", id: widget.id } });
    await rpc(ui, "operation", { operation: { type: "delete", id: inspector.id } });
  });
  test("上下文回归：原生下拉可观察，旧引用与禁用控件不会误操作", async () => {
    await demo.evaluate(() => {
      const button = document.createElement("button");
      button.id = "disabled-action"; button.disabled = true; button.textContent = "禁用测试按钮";
      button.addEventListener("click", () => { document.documentElement.dataset.disabledClicked = "yes"; });
      document.body.append(button);
    });
    const entry = await rpc(ui, "operation", { operation: { type: "create", definition: {
      ...panelSample, kind: "page", title: "控件观察契约回归", matches: ["http://127.0.0.1/*"],
      code: `const page = await bee.tabs.inspect(${tabId});
const select = page.elements.find(item => item.name === "region");
if (!select.options.some(option => option.value === "MY")) throw new Error("缺少真实下拉选项");
await bee.tabs.action({tabId:${tabId},documentId:page.documentId,selector:select.selector,action:"select",value:"MY"});
const latest = await bee.tabs.inspect(${tabId});
let stale = false;
try { await bee.tabs.action({tabId:${tabId},documentId:page.documentId,selector:select.selector,action:"click"}); } catch { stale = true; }
if (!stale) throw new Error("旧观察引用未失效");
let disabled = false;
try { await bee.tabs.action({tabId:${tabId},documentId:latest.documentId,selector:"#disabled-action",action:"click"}); } catch { disabled = true; }
if (!disabled) throw new Error("误操作禁用控件");`
    } } });
    const result = await rpc(ui, "run", { id: entry.id, revisionId: entry.revisionId, tabId });
    const run = (await rpc(ui, "state")).db.runs.find((run: any) => run.id === result.runId);
    expect(run.status, JSON.stringify(run.logs)).toBe("succeeded");
    await expect(demo.locator('[name="region"]')).toHaveValue("MY");
    await expect(demo.locator("html")).not.toHaveAttribute("data-disabled-clicked", "yes");
    await demo.locator("#disabled-action").evaluate(element => element.remove());
    await rpc(ui, "operation", { operation: { type: "delete", id: entry.id } });
  });
  test("未安装候选直接填写真实页面，并一键安装", async () => {
    await ui.getByRole("button", { name: /表单快速填写/ }).click();
    await ui.getByLabel("目标页面", { exact: true }).selectOption(String(tabId));
    await ui.getByRole("button", { name: "查看效果", exact: true }).click();
    await expect(demo.locator('[name="client_name"]')).toHaveValue(/^QA_/);
    await expect(demo.locator('[name="email"]')).toHaveValue(/@example.com$/);
    await expect(ui.getByRole("log")).toContainText("未提交表单");
    const before = (await rpc(ui, "state")).db.entries.find((entry: any) => !entry.installed && entry.revisions.some((revision: any) => revision.definition.title === "表单快速填写"));
    expect(before).toBeTruthy();
    await ui.getByRole("button", { name: "安装", exact: true }).click();
    await expect.poll(async () => (await rpc(ui, "state")).db.entries.find((entry: any) => entry.id === before.id).installed).toBe(true);
    await expect(ui.getByLabel("启用")).toBeChecked();
    await ui.getByLabel("收藏", { exact: true }).click();
    await ui.reload();
    await expect(ui.getByLabel("启用")).toBeChecked();
    expect((await rpc(ui, "state")).db.entries.find((entry: any) => entry.id === before.id).favorite).toBe(true);
    await ui.screenshot({ path: ".local/screenshots/desktop.png", fullPage: true });
    expect(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  test("隔离界面可实际交互，未安装也能查看效果", async () => {
    await ui.getByRole("button", { name: /候选/ }).first().click();
    await ui.getByRole("button", { name: /批量文本整理/ }).click();
    await ui.getByRole("button", { name: "查看效果", exact: true }).click();
    const frame = ui.frameLocator('iframe[title="微应用效果"]');
    await frame.locator("#source").fill(" A \nB\nA\n\n B");
    await frame.getByRole("button", { name: "去重并整理" }).click();
    await expect(frame.locator("#result")).toHaveText("A\nB");
    await expect(ui.getByRole("log")).toContainText("已整理 2 条数据");
    await ui.screenshot({ path: ".local/screenshots/panel-preview.png" });
  });
  test("源码可编辑，版本可恢复", async () => {
    await ui.getByRole("tab", { name: "源码", exact: true }).click();
    const editor = ui.getByLabel("微应用源码");
    const original = await editor.inputValue();
    await editor.fill(original + '\nbee.log("revision-test");');
    await ui.getByRole("button", { name: "保存修改" }).click();
    await expect(ui.getByText("未保存", { exact: true })).toHaveCount(0);
    await ui.getByRole("tab", { name: "版本", exact: true }).click();
    await expect(ui.locator(".version-row")).toHaveCount(2);
    await ui.getByLabel("恢复此版本").click();
    await expect(ui.locator(".version-row")).toHaveCount(3);
    await ui.getByRole("tab", { name: "源码", exact: true }).click();
    await expect(editor).toHaveValue(original);
  });
  test("导出后重新导入仍为独立候选", async () => {
    const downloadPromise = ui.waitForEvent("download");
    await ui.getByLabel("导出微应用").click();
    const download = await downloadPromise;
    const contents = await readFile((await download.path())!, "utf8");
    const before = (await rpc(ui, "state")).db.entries.length;
    await ui.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({ name: "import.beehelper.json", mimeType: "application/json", buffer: Buffer.from(contents) });
    await expect.poll(async () => (await rpc(ui, "state")).db.entries.length).toBe(before + 1);
    expect((await rpc(ui, "state")).db.entries[0].installed).toBe(false);
  });
  test("页面监听试用转安装不重复，SPA 和禁用能清理", async () => {
    const definition: Definition = { ...panelSample, kind: "page", trigger: "page", title: "事件生命周期验证", matches: ["http://127.0.0.1/*"], code: 'const root = bee.mount(`<button id="counter">计数</button>`); bee.on(root.querySelector("#counter"), "click", () => { document.documentElement.dataset.beeCount = String(Number(document.documentElement.dataset.beeCount || 0) + 1); });' };
    const entry = await rpc(ui, "operation", { operation: { type: "create", definition } });
    await rpc(ui, "run", { id: entry.id, revisionId: entry.revisionId, tabId });
    await expect(demo.locator("#counter")).toHaveCount(1);
    await rpc(ui, "operation", { operation: { type: "install", id: entry.id, revisionId: entry.revisionId } });
    await expect(demo.locator("#counter")).toHaveCount(1);
    await demo.locator("#counter").click();
    expect(await demo.locator("html").getAttribute("data-bee-count")).toBe("1");
    await demo.evaluate(() => history.pushState({}, "", "?view=client&spa=1"));
    await expect(demo.locator("#counter")).toHaveCount(1);
    await rpc(ui, "operation", { operation: { type: "enable", id: entry.id, value: false } });
    await expect(demo.locator("#counter")).toHaveCount(0);
    await rpc(ui, "operation", { operation: { type: "enable", id: entry.id, value: true } });
    await expect(demo.locator("#counter")).toHaveCount(1);
    await rpc(ui, "operation", { operation: { type: "delete", id: entry.id } });
    await expect(demo.locator("#counter")).toHaveCount(0);
  });
  test("脚本可确定性操作其他标签页，失败时清理页面资源", async () => {
    const other = await context.newPage();
    await other.goto("http://localhost:4173/demo.html?view=client&cross=1");
    const targets = await rpc(ui, "tabs");
    const otherId = targets.find((tab: any) => tab.url.includes("cross=1")).id;
    const definition: Definition = { ...panelSample, title: "跨标签页验证", kind: "page", matches: ["http://127.0.0.1/*"], code: `const page = await bee.tabs.inspect(${otherId}); const input = page.elements.find(item => item.name === "email"); await bee.tabs.action({tabId:${otherId},documentId:page.documentId,selector:input.selector,action:"fill",value:"cross@example.com"}); return "跨标签页完成";` };
    const entry = await rpc(ui, "operation", { operation: { type: "create", definition } });
    const result = await rpc(ui, "run", { id: entry.id, revisionId: entry.revisionId, tabId });
    await expect(other.locator('[name="email"]')).toHaveValue("cross@example.com");
    await expect.poll(async () => (await rpc(ui, "state")).db.runs.find((run: any) => run.id === result.runId).status).toBe("succeeded");
    const failed = await rpc(ui, "operation", { operation: { type: "create", definition: { ...definition, title: "失败清理验证", code: 'bee.mount(`<div id="must-clean">临时节点</div>`); throw new Error("预期的测试错误");' } } });
    const failure = await rpc(ui, "run", { id: failed.id, revisionId: failed.revisionId, tabId });
    await expect.poll(async () => (await rpc(ui, "state")).db.runs.find((run: any) => run.id === failure.runId).status).toBe("failed");
    await expect(demo.locator("#must-clean")).toHaveCount(0);
    await other.close();
  });
  test("隔离界面通过宿主访问微应用私有存储", async () => {
    const entry = await rpc(ui, "operation", { operation: { type: "create", definition: { ...panelSample, title: "界面存储验证", code: 'await bee.storage.set("count", 7); const value = await bee.storage.get("count"); bee.mount("<h2>存储结果 " + value + "</h2>");' } } });
    await ui.getByRole("button", { name: /界面存储验证/ }).click();
    await ui.getByRole("button", { name: "查看效果", exact: true }).click();
    await expect(ui.frameLocator('iframe[title="微应用效果"]').getByRole("heading", { name: "存储结果 7" })).toBeVisible();
    expect((await rpc(ui, "state")).db.runs.find((run: any) => run.appId === entry.id).tabId).toBeUndefined();
  });
  test("窄侧边栏与移动尺寸无横向溢出", async () => {
    await ui.setViewportSize({ width: 420, height: 900 });
    await ui.getByRole("button", { name: "微应用", exact: true }).click();
    await ui.getByRole("button", { name: "全部", exact: true }).click();
    await ui.getByRole("button", { name: /表单快速填写/ }).click();
    await expect(ui.getByLabel("微应用源码")).toBeVisible();
    expect(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ui.screenshot({ path: ".local/screenshots/sidepanel.png" });
    await ui.setViewportSize({ width: 360, height: 740 });
    expect(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await ui.screenshot({ path: ".local/screenshots/mobile.png" });
    await ui.setViewportSize({ width: 1440, height: 960 });
  });
  test("真实 Native Messaging 连接本机 AI 客户端并读取模型", async () => {
    test.skip(!connectorTest, "设置 BEEHELPER_E2E_CONNECTOR=1 并使用本机已安装的 Codex / Claude Code / DSH");
    const providers = await rpc(ui, "providers");
    const known = new Set(["codex", "claude", "dsh", "codebuddy"]);
    const available = providers.filter((provider: any) => provider.available && known.has(provider.id));
    expect(available.length, "至少需要一个已安装且可连接的本地客户端").toBeGreaterThan(0);
    for (const provider of available) {
      const session = await rpc(ui, "sessionNew", { providerId: provider.id });
      const result = await rpc(ui, "connect", { sessionId: session.id });
      expect(result.ready, provider.id).toBe(true);
      if (provider.id === "codex") {
        expect(result.authenticated, provider.id).toBe(true);
        expect(result.version, provider.id).toContain("codex-cli");
      }
      const models = await rpc(ui, "models", { sessionId: session.id });
      expect(models.data.length, provider.id).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
  test("真实 Codex 经 MCP 创建候选，不操作业务页面", async () => {
    test.skip(!liveModelTest, "需要 BEEHELPER_E2E_CONNECTOR=1 与 BEEHELPER_LIVE_CODEX=1");
    test.setTimeout(240_000);
    const title = "Codex 连通验证";
    await rpc(ui, "chat", { text: `请使用 beehelper 的 microapp_create 工具创建一个候选，title 为「${title}」，description 为「真实 MCP 链路验证」，kind=panel，trigger=manual，matches=["<all_urls>"]，schemaVersion=1，code 为 bee.mount("<h2>Codex 已连通</h2>");。创建后使用 microapp_run 展示这个界面，再通过 run_get 核实结果。不要安装，不要读取网页或本机文件。只创建一次，完成后简短回复。` });
    await expect.poll(async () => {
      const state = await rpc(ui, "state");
      return state.db.entries.some((entry: any) => entry.revisions.some((revision: any) => revision.definition.title === title)) ? "created" : state.connector.busy ? "running" : "finished";
    }, { timeout: 210_000, intervals: [1000, 2000] }).not.toBe("running");
    const state = await rpc(ui, "state");
    const entry = state.db.entries.find((entry: any) => entry.revisions.some((revision: any) => revision.definition.title === title));
    expect(entry, JSON.stringify(state.db.chat.slice(-8))).toBeTruthy();
    expect(entry.installed).toBe(false);
    expect(entry.revisions[0].source).toBe("Codex");
    await expect(ui.frameLocator('iframe[title="微应用效果"]').getByRole("heading", { name: "Codex 已连通" })).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await rpc(ui, "state")).connector.busy, { timeout: 60_000 }).toBe(false);
    await ui.getByRole("button", { name: "安装", exact: true }).click();
    await expect.poll(async () => (await rpc(ui, "state")).db.entries.find((item: any) => item.id === entry.id).installed).toBe(true);
  });
  test("真实 Codex 使用微应用和网页上下文读取源码、点击悬浮按钮并读取日志", async () => {
    test.skip(!liveModelTest, "需要 BEEHELPER_E2E_CONNECTOR=1 与 BEEHELPER_LIVE_CODEX=1");
    test.setTimeout(240_000);
    await rpc(ui, "newChat");
    const widget = await rpc(ui, "operation", { operation: { type: "create", definition: {
      ...panelSample, title: "上下文自动验证", kind: "page", matches: ["http://127.0.0.1/*"],
      code: 'const root = bee.mount(`<button id="ai-shadow-fill">执行本地填写</button>`); bee.on(root.querySelector("#ai-shadow-fill"), "click", () => { bee.fill("[name=email]", "context-ai@example.com"); bee.log("上下文按钮填写已完成"); });'
    } } });
    const run = await rpc(ui, "run", { id: widget.id, revisionId: widget.revisionId, tabId });
    await ui.getByRole("button", { name: "全部微应用", exact: false }).click();
    await ui.getByRole("button", { name: /上下文自动验证/ }).click();
    await ui.getByLabel("目标页面", { exact: true }).selectOption(String(tabId));
    await ui.getByLabel("发送给 Codex").fill("请读取我当前选择的微应用源码和最近运行日志，观察目标网页，点击微应用里“执行本地填写”悬浮按钮。然后核实页面邮箱字段和新的按钮日志，报告实际结果。不要修改源码、不要创建或安装应用，不要提交表单。");
    await ui.getByRole("button", { name: "发送", exact: true }).click();
    await expect(demo.locator('[name="email"]')).toHaveValue("context-ai@example.com", { timeout: 180_000 });
    await expect.poll(async () => (await rpc(ui, "state")).connector.busy, { timeout: 60_000 }).toBe(false);
    const state = await rpc(ui, "state");
    const toolMessages = state.db.chat.filter((message: any) => message.role === "tool").map((message: any) => message.text).join("\n");
    for (const name of ["microapp_get", "browser_inspect", "browser_action", "run_get"]) expect(toolMessages).toContain(name);
    expect(state.db.runs.find((item: any) => item.id === run.runId).logs.some((log: any) => log.text === "上下文按钮填写已完成")).toBe(true);
    expect(state.db.entries.find((entry: any) => entry.id === widget.id).revisions).toHaveLength(1);
    await rpc(ui, "operation", { operation: { type: "delete", id: widget.id } });
  });
  test("页面快捷入口打开真正的 Chrome 侧边栏", async () => {
    await demo.bringToFront();
    await expect(demo.locator("#beehelper-launcher")).toBeVisible();
    await demo.locator("#beehelper-launcher").click();
    await expect.poll(async () => ui.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.SIDE_PANEL] })).length)).toBeGreaterThan(0);
  });
  test("真实 Codex 读取显式上传的 CSV 与图片", async () => {
    test.skip(!liveModelTest, "需要 BEEHELPER_E2E_CONNECTOR=1 与 BEEHELPER_LIVE_CODEX=1");
    test.setTimeout(240_000);
    await rpc(ui, "sessionNew", { providerId: "codex" }); await rpc(ui, "connect");
    const state = await rpc(ui, "state"), session = state.db.sessions.find((item: any) => item.id === state.db.activeSessionId);
    const vision = session.models.find((item: any) => item.id === session.appliedModel && item.inputModalities?.includes("image")) ?? session.models.find((item: any) => item.inputModalities?.includes("image"));
    expect(vision, "当前客户端没有声明可用的图片模型").toBeTruthy();
    if (vision.id !== session.appliedModel) await rpc(ui, "sessionModel", { model: vision.id });
    const image = await ui.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 120; canvas.height = 40;
      const context = canvas.getContext("2d")!;
      for (const [index, color] of ["#ed3030", "#27ad43", "#286ee8"].entries()) { context.fillStyle = color; context.fillRect(index * 40, 0, 40, 40); }
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await ui.getByLabel("附件文件", { exact: true }).setInputFiles([
      { name: "probe.csv", mimeType: "text/csv", buffer: Buffer.from("item,value\nprobe,8472\n") },
      { name: "picture.png", mimeType: "image/png", buffer: Buffer.from(image, "base64") }
    ]);
    await expect(ui.locator(".composer .attachment-item")).toHaveCount(2);
    await expect(ui.getByLabel("附件上传进度")).toHaveCount(0);
    await ui.getByLabel("发送给 Codex", { exact: true }).fill("请只根据本轮附带的 CSV 和图片，读出 CSV 中 probe 的 value，并数出图片中并排的垂直色块数量。仅按「数值;数量」回复。不要读取网页、微应用或其他文件，不修改任何东西。");
    await ui.getByRole("button", { name: "发送", exact: true }).click();
    await expect(ui.locator(".messages .message.user")).toContainText("请只根据本轮");
    await expect.poll(async () => (await rpc(ui, "state")).connector.busy, { timeout: 210_000 }).toBe(false);
    const result = await rpc(ui, "state");
    const text = result.db.chat.filter((message: any) => message.role === "assistant").map((message: any) => message.text).join("\n");
    expect(text).toMatch(/8472\s*[;；]\s*(?:3|三)/);
  });
});
