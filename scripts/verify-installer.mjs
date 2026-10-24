import { mkdtemp, cp, writeFile, readFile, access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { installDistribution, uninstallDistribution, installationPaths, extensionId } from "../connector/distribution.mjs";
import { FrameDecoder, encodeFrame } from "../connector/framing.mjs";

if (process.platform !== "darwin") throw new Error("此安装包烟测仅在 macOS 运行");
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, `.local/installers/staging-${process.arch}/BeeHelper Installer.app/Contents/Resources/payload`);
const temporary = await mkdtemp(path.join(tmpdir(), "bee-installed-smoke-"));
const home = path.join(temporary, "测试用户 'home");
let child;
try {
  const installed = await installDistribution({ source, home });
  const paths = installationPaths(home);
  await access(path.join(paths.current, "THIRD_PARTY_NOTICES.txt"));
  await assert.rejects(access(path.join(paths.current, "runtime")));
  await assert.rejects(access(path.join(paths.current, "node_modules")));
  const fixture = path.join(temporary, "fixture-agent.mjs");
  await cp(path.join(root, "tests/fixtures/fake-agent.mjs"), fixture);
  const config = path.join(temporary, "agents.json");
  await writeFile(config, JSON.stringify({ agents: [{ id: "installed-fixture", name: "Installed Fixture", command: process.execPath, args: [fixture, "--acp-fixture"] }] }));
  // 连接器不使用 Node/npm；外部合成 Agent 夹具显式使用开发机 Node，不属于安装包依赖。
  const env = { PATH: "/usr/bin:/bin", TMPDIR: tmpdir(), BEEHELPER_WORKSPACE: path.join(temporary, "workspace"), BEEHELPER_AGENTS_CONFIG: config };
  for (const variable of ["BEEHELPER_CODEX", "BEEHELPER_CLAUDE", "BEEHELPER_DSH", "BEEHELPER_CODEBUDDY"]) env[variable] = path.join(temporary, "not-installed");
  child = spawn(paths.host, [`chrome-extension://${extensionId}/`], { cwd: temporary, env, stdio: ["pipe", "pipe", "pipe"] });
  const decoder = new FrameDecoder(), pending = new Map();
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
  child.on("error", fail); child.on("exit", code => fail(new Error(`已安装连接器退出 ${code}: ${stderr.slice(0, 1000)}`)));
  child.stdout.on("data", data => {
    for (const message of decoder.push(data)) {
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
    }
  });
  let sequence = 0;
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error(`已安装连接器 ${method} 超时`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(encodeFrame({ kind: "rpc", id, method, params }));
  });
  const status = await rpc("diagnostics");
  assert.equal(status.version, installed.version);
  assert.equal(status.providers.find(item => item.id === "installed-fixture").available, true);
  const session = await rpc("connect", { providerId: "installed-fixture", sessionId: "smoke", connectionId: "smoke" });
  assert.equal(session.appliedModel, "alpha");
  assert.ok(session.nativeSessionId);
  child.stdin.end();
  await new Promise(resolve => child.once("exit", resolve)); child = undefined;
  const repaired = await installDistribution({ source, home });
  assert.equal(repaired.nativeHost, installed.nativeHost);
  await uninstallDistribution({ home });
  await assert.rejects(access(paths.host));
  console.log(JSON.stringify({ ok: true, version: installed.version, platform: process.platform, arch: process.arch,
    systemJavaScriptCore: true, bundledRuntime: false, nativeMessaging: true, acpHandshake: true, repair: true, uninstall: true, personalConfigurationModified: false }));
} finally { child?.kill("SIGTERM"); await rm(temporary, { recursive: true, force: true }); }
