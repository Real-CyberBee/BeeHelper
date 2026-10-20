import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const extensionId = "llkomjgjbldjelaemjcgphogaceejbpi";
let context: BrowserContext, page: Page, directory: string;
async function rpc(type: string, data: Record<string, unknown> = {}): Promise<any> {
  return page.evaluate(async ({ type, data }) => {
    const result = await chrome.runtime.sendMessage({ channel: "bee:request", type, ...data });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }, { type, data });
}
async function executable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = path.join(homedir(), "Library/Caches/ms-playwright");
  for (const folder of (await readdir(cache)).filter(folder => /^chromium-\d+$/.test(folder)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const file = path.join(cache, folder, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(file)) return file;
  }
  throw new Error("请先安装测试 Chromium");
}
test.describe.serial("会话工作台：真实扩展与协议夹具，不调用模型", () => {
  test.beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "bee-sessions-"));
    const hosts = path.join(directory, "NativeMessagingHosts"); await mkdir(hosts);
    const wrapper = path.join(directory, "native-host.sh");
    const agentsFile = path.join(directory, "agents.json");
    await writeFile(agentsFile, JSON.stringify({ agents: [
      { id: "fixture-acp", name: "Fixture ACP", command: process.execPath, args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture"] },
      { id: "fixture-acp-permission", name: "Permission ACP", command: process.execPath, args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture", "--permission-on-connect"] }
    ] }));
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await writeFile(wrapper, `#!/bin/sh\nexport BEEHELPER_CODEX=${quote(path.resolve("tests/fixtures/fake-agent.mjs"))}\nexport BEEHELPER_WORKSPACE=${quote(path.join(directory, "workspace"))}\nexport BEEHELPER_AGENTS_CONFIG=${quote(agentsFile)}\nexec ${quote(process.execPath)} ${quote(path.resolve("connector/host.mjs"))} "$@"\n`, { mode: 0o700 });
    await writeFile(path.join(hosts, "io.beehelper.codex.json"), JSON.stringify({ name: "io.beehelper.codex", description: "BeeHelper isolated fixture", path: wrapper, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] }));
    const extension = path.resolve("dist");
    context = await chromium.launchPersistentContext(directory, { executablePath: await executable(), headless: false, viewport: { width: 1440, height: 960 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-first-run"] });
    page = await context.newPage(); await page.goto(`chrome-extension://${extensionId}/index.html`);
    await expect(page.getByRole("heading", { name: "AI 会话" })).toBeVisible();
  });
  test.afterAll(async () => { await context?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  test("运行中切换会话不停止原任务，也不串入其他会话", async () => {
    await page.getByLabel("发送给 Codex").fill("hold-test");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:hold-test");
    const before = await rpc("state"); const first = before.db.activeSessionId;
    await page.getByLabel("新对话", { exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).not.toContainText("fixture:hold-test");
    await page.getByLabel("发送给 Codex").fill("other-session");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:answer");
    await expect.poll(async () => (await rpc("state")).db.sessions.find((item: any) => item.id === first).state).toBe("running");
    await page.getByRole("button", { name: "切换会话：hold-test", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:hold-test");
    await expect(page.getByRole("region", { name: "会话消息" })).not.toContainText("other-session");
  });
  test("排队、插话及模型下一轮切换贯通真实 Native Messaging", async () => {
    await page.getByLabel("发送给 Codex").fill("queued-test");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByLabel("待发送队列")).toContainText("queued-test");
    await page.getByLabel("模型", { exact: true }).selectOption("beta");
    await expect(page.getByText("下一轮", { exact: true })).toBeVisible();
    await page.getByLabel("消息投递方式").selectOption("steer");
    await page.getByLabel("发送给 Codex").fill("finish-test");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText(":steered");
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:queued-test:beta");
    await expect(page.getByLabel("待发送队列")).toHaveCount(0);
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    const saved = (await rpc("state")).db.activeSessionId;
    await page.reload();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:queued-test:beta");
    expect((await rpc("state")).db.activeSessionId).toBe(saved);
    await expect(page.getByLabel("模型", { exact: true })).toHaveValue("beta");
  });
  test("停止后保留并暂停队列，显式继续才再次投递", async () => {
    await page.getByLabel("发送给 Codex").fill("hold-test");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(true);
    await page.getByLabel("消息投递方式").selectOption("queue");
    await page.getByLabel("发送给 Codex").fill("queued-test-after-stop");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByLabel("停止 Codex", { exact: true }).click();
    await expect(page.getByLabel("待发送队列")).toContainText("已暂停");
    await expect(page.getByRole("region", { name: "会话消息" })).not.toContainText("fixture:queued-test-after-stop");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await page.getByLabel("继续队列").click();
    await expect(page.getByLabel("待发送队列")).toHaveCount(0);
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
  });
  test("新会话不会继承上一会话的插话模式，未连接客户端不能误标支持", async () => {
    const previous = (await rpc("state")).db.activeSessionId;
    await rpc("chat", { text: "hold-test" });
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(true);
    await page.getByLabel("消息投递方式").selectOption("steer");
    await page.getByLabel("新对话", { exact: true }).click();
    await expect(page.getByLabel("消息投递方式")).toHaveValue("queue");
    await expect(page.getByLabel("消息投递方式").locator('option[value="steer"]')).toBeDisabled();
    await rpc("cancel", { sessionId: previous });
    await expect.poll(async () => (await rpc("state")).db.sessions.find((item: any) => item.id === previous).state).toBe("idle");
  });
  test("会话归档可恢复，窄侧边栏没有文本溢出", async () => {
    const old = (await rpc("state")).db.activeSessionId;
    const session = (await rpc("state")).db.sessions.find((item: any) => item.id === old);
    await page.getByRole("button", { name: `归档会话：${session.title}`, exact: true }).click();
    await page.getByRole("checkbox", { name: "归档", exact: true }).check();
    await page.getByRole("button", { name: `恢复归档：${session.title}`, exact: true }).click();
    await page.getByRole("checkbox", { name: "归档", exact: true }).uncheck();
    await page.getByRole("button", { name: `切换会话：${session.title}`, exact: true }).click();
    for (const width of [420, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole("button", { name: "AI 会话", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator(".composer").evaluate(element => element.getBoundingClientRect().bottom <= innerHeight - 45)).toBe(true);
      await page.screenshot({ path: `.local/screenshots/sessions-${width}.png` });
    }
  });
  test("斜杠菜单支持键盘选择，客户端命令不被通用提示词破坏", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await rpc("sessionNew", { providerId: "codex" });
    await page.getByLabel("发送给 Codex").fill("/status");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "当前会话状态" })).toBeVisible();
    expect((await rpc("state")).db.chat.length).toBe(0);
    await page.getByLabel("关闭会话状态", { exact: true }).click();
    await rpc("connect");
    const input = page.getByLabel("发送给 Codex");
    await input.fill("/comp");
    await expect(page.getByRole("listbox", { name: "命令建议" })).toContainText("/compact");
    await input.press("Enter");
    await expect(input).toHaveValue("/compact ");
    await input.press("Enter");
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("fixture:compacted");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await rpc("sessionNew", { providerId: "fixture-acp" }); await rpc("connect");
    await expect.poll(async () => { const { db } = await rpc("state"); return db.sessions.find((item: any) => item.id === db.activeSessionId)?.commands?.length; }).toBeGreaterThan(0);
    await page.getByLabel("发送给 Fixture ACP").fill("/fixture-native args");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("native-command-first");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await page.getByLabel("会话配置", { exact: true }).click();
    await page.getByLabel("会话模式", { exact: true }).selectOption("plan");
    await expect(page.getByLabel("会话模式", { exact: true })).toHaveValue("plan");
  });
  test("@ 引用真实微应用和技能，引用信息进入消息与原生输入", async () => {
    await rpc("sessionNew", { providerId: "codex" }); await rpc("connect");
    const input = page.getByLabel("发送给 Codex");
    await input.fill("@表单");
    await page.getByRole("option").filter({ hasText: "表单快速填写" }).click();
    await expect(page.locator(".draft-references")).toContainText("表单快速填写");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    const state = await rpc("state");
    expect(state.db.chat.find((message: any) => message.role === "user").references[0].revisionId).toBeTruthy();
    await input.fill("@fixture");
    await page.getByRole("option").filter({ hasText: "fixture-skill" }).click();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("skill-received");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
  });
  test("文件选择分片上传，图片预览和消息附件在刷新后仍可用", async () => {
    await rpc("sessionNew", { providerId: "codex" });
    const pixel = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    await page.getByLabel("附件文件", { exact: true }).setInputFiles([
      { name: "pixel.gif", mimeType: "image/gif", buffer: pixel },
      { name: "report.csv", mimeType: "text/csv", buffer: Buffer.from("sku,count\n1,2") },
      { name: "large.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(1_100_000, 255) }
    ]);
    await expect(page.locator(".composer .attachment-item")).toHaveCount(3);
    await expect(page.getByLabel("附件上传进度")).toHaveCount(0);
    for (const width of [420, 360]) {
      await page.setViewportSize({ width, height: 900 }); await page.getByRole("button", { name: "AI 会话", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator(".composer").evaluate(element => element.getBoundingClientRect().bottom <= innerHeight - 45)).toBe(true);
      await page.screenshot({ path: `.local/screenshots/rich-composer-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByLabel("发送给 Codex").fill("read-files");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("image-received");
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("file-received");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await page.reload();
    await expect(page.locator(".message.user .attachment-item")).toHaveCount(3);
    await page.getByRole("button", { name: "预览 pixel.gif", exact: true }).click();
    await expect.poll(async () => page.getByRole("dialog", { name: "图片预览" }).locator("img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1);
    await page.getByLabel("关闭图片预览").click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 report.csv", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("report.csv");
  });
  test("粘贴和拖拽附件保留草稿，纯图片可发送，文本模型不会误收图片", async () => {
    await rpc("sessionNew", { providerId: "codex" }); await rpc("connect"); await rpc("sessionModel", { model: "beta" });
    const input = page.getByLabel("发送给 Codex");
    const base64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    await input.evaluate((element, data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), character => character.charCodeAt(0))], "pasted.gif", { type: "image/gif" }));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    }, base64);
    await expect(page.locator(".composer .attachment-item")).toHaveCount(1);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("不支持图片");
    expect((await rpc("state")).db.chat.length).toBe(0);
    await expect(page.locator(".composer .attachment-item")).toHaveCount(1);
    await page.getByLabel("模型", { exact: true }).selectOption("alpha");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("region", { name: "会话消息" })).toContainText("image-received");
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await page.locator(".messages").evaluate(element => {
      const transfer = new DataTransfer(); transfer.items.add(new File(["draft-file"], "drop.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await expect(page.locator(".composer .attachment-item")).toHaveCount(1);
    await input.fill("未发送草稿");
    await expect.poll(async () => { const { db } = await rpc("state"); return db.sessions.find((item: any) => item.id === db.activeSessionId)?.draft?.text; }).toBe("未发送草稿");
    await page.reload();
    await expect(input).toHaveValue("未发送草稿");
    await expect(page.locator(".composer .attachment-item")).toHaveCount(1);
    await input.evaluate(element => {
      const transfer = new DataTransfer(); transfer.setData("text/plain", "A".repeat(60_000));
      element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
    });
    await expect(page.locator(".composer .attachment-item")).toHaveCount(2);
    await expect(input).toHaveValue("未发送草稿");
    await expect(page.locator(".composer .attachment-list")).toContainText("粘贴文本.txt");
    const before = (await rpc("state")).db.chat.length;
    await input.evaluate(element => { element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })); });
    await expect(input).toHaveValue("未发送草稿");
    expect((await rpc("state")).db.chat.length).toBe(before);
  });
  test("Markdown 消息安全渲染，支持搜索、导出和重用而不改写历史", async () => {
    await rpc("sessionNew", { providerId: "codex" });
    let remoteImages = 0;
    await page.route("https://beehelper-image.invalid/**", route => { remoteImages++; void route.abort(); });
    const input = page.getByLabel("发送给 Codex");
    await input.fill("markdown-test");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".message.assistant table")).toBeVisible();
    await expect(page.getByRole("button", { name: "复制代码", exact: true })).toBeVisible();
    await expect(page.locator('.message.assistant a[href^="javascript:"]')).toHaveCount(0);
    await expect(page.locator(".message.assistant script")).toHaveCount(0);
    await expect(page.locator(".message.assistant img")).toHaveCount(0);
    expect(remoteImages).toBe(0);
    await expect.poll(async () => (await rpc("state")).connector.busy).toBe(false);
    await page.getByLabel("搜索消息", { exact: true }).click();
    await page.getByLabel("搜索当前会话消息").fill("no-such-message");
    await expect(page.locator(".messages .message")).toHaveCount(0);
    await page.getByLabel("关闭消息搜索").click();
    await expect(page.locator(".message.assistant table")).toBeVisible();
    const downloadPromise = page.waitForEvent("download"); await page.getByLabel("导出会话", { exact: true }).click();
    const download = await downloadPromise; const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.format).toBe("beehelper.conversation"); expect(exported.messages.some((item: any) => item.text === "markdown-test")).toBe(true);
    const before = (await rpc("state")).db.chat.length;
    await page.getByLabel("重用为新消息", { exact: true }).click();
    await expect(input).toHaveValue("markdown-test");
    await input.press("Shift+Enter");
    expect((await rpc("state")).db.chat.length).toBe(before);
    await page.setViewportSize({ width: 360, height: 740 }); await page.getByRole("button", { name: "AI 会话", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".local/screenshots/rich-messages-360.png" });
  });
  test("连接期间的授权也能回答，不会被全局连接中状态锁死", async () => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await rpc("sessionNew", { providerId: "fixture-acp-permission" });
    await page.getByLabel("连接或恢复会话", { exact: true }).click();
    await expect(page.getByLabel("Agent 授权请求", { exact: true })).toContainText("测试连接授权");
    await expect(page.getByRole("button", { name: "允许本次", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "允许本次", exact: true }).click();
    await expect.poll(async () => (await rpc("state")).connector.ready).toBe(true);
    await expect(page.getByLabel("Agent 授权请求", { exact: true })).toHaveCount(0);
  });
});
