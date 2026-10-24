import { chromium, type BrowserContext, type Worker } from "@playwright/test";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * E2E 启动工具：跨 Linux / macOS / Windows。
 *
 * 环境变量：
 * - `CHROME_PATH`        指定 Chrome/Chromium 可执行文件（优先级最高）
 * - `E2E_HEADED=1`       强制有头模式；默认无头，CI 没有显示器也能跑
 * - `BEEHELPER_E2E_CONNECTOR=1` 使用本机已安装的 Native Messaging 连接器，而不是夹具
 * - `BEEHELPER_LIVE_CODEX=1`    额外允许真实模型请求（还需上面的连接器开关）
 */
export const extensionId = "llkomjgjbldjelaemjcgphogaceejbpi";
export const extensionUrl = `chrome-extension://${extensionId}/index.html`;
export const connectorTest = process.env.BEEHELPER_E2E_CONNECTOR === "1";
export const liveModelTest = connectorTest && process.env.BEEHELPER_LIVE_CODEX === "1";
export const headed = process.env.E2E_HEADED === "1";
export const isWindows = process.platform === "win32";

export function playwrightCacheDirs(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  const dirs: string[] = [];
  if (env.PLAYWRIGHT_BROWSERS_PATH) dirs.push(env.PLAYWRIGHT_BROWSERS_PATH);
  if (platform === "win32") dirs.push(path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ms-playwright"));
  else if (platform === "darwin") dirs.push(path.join(home, "Library", "Caches", "ms-playwright"));
  else dirs.push(path.join(home, ".cache", "ms-playwright"));
  return dirs;
}

/** 一个 Playwright chromium 版本目录里，各平台可执行文件的相对路径。 */
export function browserCandidates(root: string): string[] {
  const mac = ["chrome-mac-arm64", "chrome-mac-x64", "chrome-mac"].map(folder =>
    path.join(root, folder, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
  const linux = ["chrome-linux64", "chrome-linux"].map(folder => path.join(root, folder, "chrome"));
  const win = ["chrome-win64", "chrome-win", "chrome-win32"].map(folder => path.join(root, folder, "chrome.exe"));
  return [...mac, ...linux, ...win];
}

function versionOf(folder: string): number {
  return Number(folder.slice("chromium-".length)) || 0;
}

/** 解析可用的 Chromium：CHROME_PATH → Playwright 记录 → 各平台缓存目录扫描。 */
export async function chromiumExecutable(): Promise<string> {
  const explicit = process.env.CHROME_PATH?.trim();
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`CHROME_PATH 指向的文件不存在：${explicit}`);
    return explicit;
  }
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    /* Playwright 未安装时继续尝试缓存目录。 */
  }
  for (const cache of playwrightCacheDirs()) {
    if (!existsSync(cache)) continue;
    const folders = (await readdir(cache)).filter(folder => /^chromium-\d+$/.test(folder)).sort((a, b) => versionOf(b) - versionOf(a));
    for (const folder of folders) {
      for (const candidate of browserCandidates(path.join(cache, folder))) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error("未找到可用于扩展 E2E 的 Chromium。先运行 `npx playwright install chromium`，或用 CHROME_PATH 指定本机 Chrome/Chromium 可执行文件。");
}

/** 启动带扩展的持久化上下文；默认无头，`E2E_HEADED=1` 时有头。 */
export async function launchExtensionContext(directory: string, options: { extension?: string; args?: string[] } = {}): Promise<BrowserContext> {
  const extension = options.extension ?? path.resolve("dist");
  return chromium.launchPersistentContext(directory, {
    executablePath: await chromiumExecutable(),
    headless: !headed,
    viewport: { width: 1440, height: 960 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
      "--lang=en-US",
      ...(options.args ?? [])
    ]
  });
}

export async function waitForServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker", { timeout: 20_000 });
}

/** 在 chrome://extensions 中打开「允许用户脚本」，页面脚本 E2E 需要。 */
export async function enableUserScripts(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`chrome://extensions/?id=${extensionId}`);
    await page.waitForTimeout(700);
    const toggle = page.locator("#allow-user-scripts").locator("cr-toggle");
    if (await toggle.count() === 0) throw new Error("chrome://extensions 中找不到「允许用户脚本」开关；请确认使用 Chrome/Chromium 138 及以上版本");
    await toggle.click();
    await page.waitForTimeout(300);
  } finally {
    await page.close();
  }
}

export interface FixtureAgent { id: string; name: string; args?: string[] }

/**
 * 在临时用户目录里生成一个 Native Messaging host，指向仓库内的 fake ACP agent。
 * 这样会话/E2E 不依赖本机安装连接器，也不会调用真实模型。
 * Windows 的 Chrome 只接受可执行文件作为 host，POSIX shell 包装器不可用。
 */
export async function writeNativeHostFixture(directory: string, agents: FixtureAgent[]): Promise<void> {
  if (isWindows) throw new Error("Windows 的 Native Messaging 需要编译 .exe 启动器；本套件请在 macOS/Linux 运行，或只运行不依赖连接器的用例");
  const hosts = path.join(directory, "NativeMessagingHosts");
  await mkdir(hosts, { recursive: true });
  const wrapper = path.join(directory, "native-host.sh");
  const agentsFile = path.join(directory, "agents.json");
  await writeFile(agentsFile, JSON.stringify({
    agents: agents.map(agent => ({ id: agent.id, name: agent.name, command: process.execPath, args: agent.args ?? [] }))
  }));
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(wrapper, [
    "#!/bin/sh",
    `export BEEHELPER_CODEX=${quote(path.resolve("tests/fixtures/fake-agent.mjs"))}`,
    `export BEEHELPER_WORKSPACE=${quote(path.join(directory, "workspace"))}`,
    `export BEEHELPER_AGENTS_CONFIG=${quote(agentsFile)}`,
    `exec ${quote(process.execPath)} ${quote(path.resolve("connector/host.mjs"))} "$@"`,
    ""
  ].join("\n"), { mode: 0o700 });
  await writeFile(path.join(hosts, "io.beehelper.codex.json"), JSON.stringify({
    name: "io.beehelper.codex",
    description: "BeeHelper isolated fixture",
    path: wrapper,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  }));
}

/** 已安装连接器清单在各平台的候选位置。Windows 使用注册表，没有可复制的文件。 */
export function installedNativeHostCandidates(platform: NodeJS.Platform = process.platform, home = homedir()): string[] {
  if (platform === "win32") return [];
  if (platform === "darwin") {
    return ["Google/Chrome", "Google/Chrome for Testing", "Chromium"].map(browser =>
      path.join(home, "Library", "Application Support", browser, "NativeMessagingHosts", "io.beehelper.codex.json"));
  }
  return ["google-chrome", "chromium"].map(browser =>
    path.join(home, ".config", browser, "NativeMessagingHosts", "io.beehelper.codex.json"));
}

/** 把本机已安装的连接器清单复制进测试 profile；需要真连 Codex 时使用。 */
export async function copyInstalledNativeHost(directory: string): Promise<string> {
  const hosts = path.join(directory, "NativeMessagingHosts");
  await mkdir(hosts, { recursive: true });
  for (const source of installedNativeHostCandidates()) {
    if (!existsSync(source)) continue;
    const target = path.join(hosts, "io.beehelper.codex.json");
    await copyFile(source, target);
    return source;
  }
  throw new Error([
    "BEEHELPER_E2E_CONNECTOR=1 需要本机已安装 BeeHelper 连接器。",
    "先运行 `npm run setup:native` 并完成 Codex 登录；",
    "或去掉该环境变量，用仓库内的 fake agent 夹具运行不调用模型的用例。"
  ].join("\n"));
}

/** 创建 E2E 临时目录（测试 profile 与夹具都放在里面）。 */
export async function e2eTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}
