import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserCandidates, chromiumExecutable, installedNativeHostCandidates, playwrightCacheDirs, writeNativeHostFixture } from "./e2e/harness";

test("Chromium 解析覆盖 Linux / macOS / Windows 的 Playwright 缓存布局", () => {
  const root = path.join("/browsers", "chromium-1248");
  const candidates = browserCandidates(root);
  assert.ok(candidates.includes(path.join(root, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")));
  assert.ok(candidates.includes(path.join(root, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")));
  assert.ok(candidates.includes(path.join(root, "chrome-mac", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")));
  assert.ok(candidates.includes(path.join(root, "chrome-linux64", "chrome")));
  assert.ok(candidates.includes(path.join(root, "chrome-linux", "chrome")));
  assert.ok(candidates.includes(path.join(root, "chrome-win64", "chrome.exe")));
  assert.ok(candidates.includes(path.join(root, "chrome-win", "chrome.exe")));
  assert.ok(candidates.includes(path.join(root, "chrome-win32", "chrome.exe")));
});

test("Playwright 缓存目录按平台解析，并尊重 PLAYWRIGHT_BROWSERS_PATH", () => {
  const home = path.join(path.sep, "home", "bee");
  assert.deepEqual(playwrightCacheDirs("linux", {}, home), [path.join(home, ".cache", "ms-playwright")]);
  assert.deepEqual(playwrightCacheDirs("darwin", {}, home), [path.join(home, "Library", "Caches", "ms-playwright")]);
  assert.deepEqual(
    playwrightCacheDirs("win32", { LOCALAPPDATA: path.join("C:", "Users", "bee", "AppData", "Local") }, home),
    [path.join("C:", "Users", "bee", "AppData", "Local", "ms-playwright")]
  );
  assert.deepEqual(
    playwrightCacheDirs("linux", { PLAYWRIGHT_BROWSERS_PATH: path.join(path.sep, "opt", "playwright") }, home),
    [path.join(path.sep, "opt", "playwright"), path.join(home, ".cache", "ms-playwright")]
  );
});

test("连接器清单位置按平台解析；Windows 走注册表，没有可复制的文件", () => {
  const home = path.join(path.sep, "home", "bee");
  const linux = installedNativeHostCandidates("linux", home);
  assert.ok(linux.some(item => item.endsWith(path.join("google-chrome", "NativeMessagingHosts", "io.beehelper.codex.json"))));
  assert.ok(linux.some(item => item.endsWith(path.join("google-chrome-for-testing", "NativeMessagingHosts", "io.beehelper.codex.json"))));
  assert.ok(linux.some(item => item.endsWith(path.join("chromium", "NativeMessagingHosts", "io.beehelper.codex.json"))));
  const mac = installedNativeHostCandidates("darwin", home);
  assert.ok(mac.some(item => item.includes(path.join("Google", "ChromeForTesting")) && item.endsWith("io.beehelper.codex.json")));
  assert.ok(mac.some(item => item.includes("Application Support") && item.endsWith("io.beehelper.codex.json")));
  assert.deepEqual(installedNativeHostCandidates("win32", home), []);
});

test("CHROME_PATH 优先级最高，文件缺失时给出明确错误", async () => {
  const previous = process.env.CHROME_PATH;
  try {
    process.env.CHROME_PATH = process.execPath;
    assert.equal(await chromiumExecutable(), process.execPath);
    process.env.CHROME_PATH = path.join(tmpdir(), "definitely-not-a-chrome-binary");
    await assert.rejects(chromiumExecutable(), /CHROME_PATH/);
  } finally {
    if (previous === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = previous;
  }
});

test("夹具 native host 指向仓库内 fake agent，且清单可执行", { skip: process.platform === "win32" ? "Windows 需要编译 .exe 启动器" : false }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bee-harness-"));
  try {
    await writeNativeHostFixture(directory, [{ id: "fixture-acp", name: "Fixture ACP", args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture"] }]);
    const manifest = JSON.parse(await readFile(path.join(directory, "NativeMessagingHosts", "io.beehelper.codex.json"), "utf8"));
    assert.equal(manifest.name, "io.beehelper.codex");
    assert.equal(manifest.type, "stdio");
    assert.deepEqual(manifest.allowed_origins, ["chrome-extension://llkomjgjbldjelaemjcgphogaceejbpi/"]);
    assert.equal((await stat(manifest.path)).mode & 0o777, 0o700);
    const wrapper = await readFile(manifest.path, "utf8");
    assert.ok(wrapper.includes("connector/host.mjs"));
    assert.ok(wrapper.includes("tests/fixtures/fake-agent.mjs"));
    const agents = JSON.parse(await readFile(path.join(directory, "agents.json"), "utf8"));
    assert.equal(agents.agents[0].id, "fixture-acp");
    assert.equal(agents.agents[0].command, process.execPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
