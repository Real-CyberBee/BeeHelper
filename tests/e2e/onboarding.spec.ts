import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { enableUserScripts, e2eTempDirectory, extensionUrl, launchExtensionContext, waitForServiceWorker, writeNativeHostFixture } from "./harness";
import { formSample } from "../../src/core/samples";
let context: BrowserContext, page: Page, directory: string;
async function rpc(type: string, data: Record<string, unknown> = {}) {
  return page.evaluate(async ({ type, data }) => {
    const reply = await chrome.runtime.sendMessage({ channel: "bee:request", type, ...data });
    if (!reply.ok) throw new Error(reply.error); return reply.data;
  }, { type, data });
}
test.describe.serial("首次使用、内置微应用和真实页面生效状态", () => {
  test.skip(process.platform === "win32", "夹具目前使用 POSIX Native Messaging 启动器");
  test.beforeAll(async () => {
    directory = await e2eTempDirectory("bee-onboarding-");
    await writeNativeHostFixture(directory, [{ id: "fixture-acp", name: "Fixture ACP", args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture"] }]);
    context = await launchExtensionContext(directory); await waitForServiceWorker(context);
    page = await context.newPage(); await page.goto(extensionUrl);
    await mkdir(".local/screenshots", { recursive: true });
  });
  test.afterAll(async () => { await context?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
  test("首次打开自动检查，用户脚本未启用有引导，可选择真实夹具连接并导出脱敏诊断", async () => {
    const dialog = page.getByRole("dialog", { name: "首次使用与诊断" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("不可卸载");
    await expect(dialog).toContainText("连接器已就绪");
    await expect(dialog).toContainText("请在扩展详情开启");
    await dialog.getByLabel("向导 AI 客户端").selectOption("fixture-acp");
    await dialog.getByRole("button", { name: "连接所选客户端" }).click();
    await expect(dialog.getByRole("status")).toHaveText("AI 客户端已连接");
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出脱敏诊断" }).click();
    const downloaded = await download;
    const report = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
    expect(report.format).toBe("beehelper.diagnostics");
    expect(JSON.stringify(report)).not.toMatch(/workspace|Bearer|example.com|\/Users\//);
    await page.setViewportSize({ width: 360, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: ".local/screenshots/onboarding-360.png" });
    await dialog.getByRole("button", { name: "开始使用微应用" }).click();
    await page.reload(); await expect(dialog).toHaveCount(0);
    await page.getByLabel("设置", { exact: true }).click(); await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 960 });
  });
  test("匹配不等于生效；实际实例、刷新、SPA、禁用与角标一致", async () => {
    await enableUserScripts(context);
    const demo = await context.newPage(); await demo.goto("http://127.0.0.1:4173/demo.html?onboarding=1");
    const tabs = await rpc("tabs"), tabId = tabs.find((tab: any) => tab.url.includes("onboarding=1")).id;
    const entry = await rpc("operation", { operation: { type: "create", definition: { ...formSample, title: "页面生效面板验证", trigger: "manual", code: 'bee.mount("<div id=bee-live-test>生效</div>");' } } });
    await rpc("operation", { operation: { type: "install", id: entry.id, revisionId: entry.revisionId } });
    const panel = page.getByRole("region", { name: "当前页面生效面板" });
    await panel.getByRole("button", { name: /当前页面/ }).click();
    await expect(panel.getByLabel("生效面板目标页面").locator(`option[value="${tabId}"]`)).toHaveCount(1);
    await panel.getByLabel("生效面板目标页面").selectOption(String(tabId));
    const row = panel.locator(`[data-app-id="${entry.id}"]`);
    await expect(row).toContainText("等待手动运行");
    await rpc("run", { id: entry.id, revisionId: entry.revisionId, tabId });
    await expect(demo.locator("#bee-live-test")).toBeVisible();
    await expect(row).toContainText("持续生效");
    await expect.poll(() => page.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("1");
    await row.getByRole("button", { name: "停止此实例" }).click();
    await expect(demo.locator("#bee-live-test")).toHaveCount(0);
    await expect(row).toContainText("等待手动运行");
    await rpc("run", { id: entry.id, revisionId: entry.revisionId, tabId });
    await demo.reload(); await expect(row).toContainText("等待手动运行");
    await expect.poll(() => page.evaluate(id => chrome.action.getBadgeText({ tabId: id }), tabId)).toBe("");
    await rpc("run", { id: entry.id, revisionId: entry.revisionId, tabId });
    await demo.evaluate(() => history.pushState({}, "", "?onboarding=1&spa=2"));
    await expect(row).toContainText("等待手动运行");
    await rpc("operation", { operation: { type: "enable", id: entry.id, value: false } });
    await expect(row).toContainText("已禁用");
    await page.screenshot({ path: ".local/screenshots/page-activity.png" });
    const denied = await page.evaluate(async id => {
      const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: async () => chrome.runtime.sendMessage({ channel: "bee:request", type: "setupSnapshot" }) });
      return results[0].result;
    }, tabId);
    expect(denied.ok).toBe(false); expect(denied.error).toContain("仅对 BeeHelper 工作台开放");
    await demo.close(); await expect(panel).toContainText("请选择网页");
  });
});

test("连接器缺失仍可完成向导并运行本地面板", async () => {
  test.skip(process.platform === "win32", "POSIX 夹具");
  const temp = await e2eTempDirectory("bee-missing-host-");
  let browser: BrowserContext | undefined;
  try {
    await writeNativeHostFixture(temp, []);
    const file = path.join(temp, "NativeMessagingHosts/io.beehelper.codex.json");
    const manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.path = path.join(temp, "does-not-exist"); await writeFile(file, JSON.stringify(manifest));
    browser = await launchExtensionContext(temp); await waitForServiceWorker(browser);
    const ui = await browser.newPage(); await ui.goto(extensionUrl);
    const dialog = ui.getByRole("dialog", { name: "首次使用与诊断" });
    await expect(dialog).toContainText("连接器未响应");
    await dialog.getByRole("button", { name: "开始使用微应用" }).click();
    await ui.getByRole("button", { name: /批量文本整理/ }).click();
    await ui.getByRole("button", { name: "查看效果", exact: true }).click();
    const frame = ui.frameLocator('iframe[title="微应用效果"]');
    await frame.locator("#source").fill("a\na\nb");
    await frame.getByRole("button", { name: "去重并整理" }).click();
    await expect(frame.locator("#result")).toHaveText("a\nb");
  } finally { await browser?.close(); await rm(temp, { recursive: true, force: true }); }
});


test("连接器可用但没有 Agent 时给出提示，完成向导不强制连接", async () => {
  test.skip(process.platform === "win32", "POSIX 夹具");
  const temp = await e2eTempDirectory("bee-no-agents-");
  let browser: BrowserContext | undefined;
  try {
    await writeNativeHostFixture(temp, []);
    const wrapper = path.join(temp, "native-host.sh");
    const override = ["BEEHELPER_CODEX", "BEEHELPER_CLAUDE", "BEEHELPER_DSH", "BEEHELPER_CODEBUDDY"].map(name => `export ${name}=/nonexistent/beehelper-test-client`).join("\n");
    await writeFile(wrapper, (await readFile(wrapper, "utf8")).replace("exec ", `${override}\nexec `), { mode: 0o700 });
    browser = await launchExtensionContext(temp); await waitForServiceWorker(browser);
    const ui = await browser.newPage(); await ui.goto(extensionUrl);
    const dialog = ui.getByRole("dialog", { name: "首次使用与诊断" });
    await expect(dialog).toContainText("连接器已就绪");
    await expect(dialog).toContainText("未检测到可用客户端");
    await expect(dialog.getByRole("button", { name: "连接所选客户端" })).toBeDisabled();
    await dialog.getByRole("button", { name: "开始使用微应用" }).click();
    await expect(dialog).toHaveCount(0);
  } finally { await browser?.close(); await rm(temp, { recursive: true, force: true }); }
});
