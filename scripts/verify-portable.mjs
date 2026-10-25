import { mkdtemp, cp, readFile, writeFile, access, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { installPortable, uninstallPortable, portablePaths } from "../connector/portable-install.mjs";
import { FrameDecoder, encodeFrame } from "../connector/framing.mjs";

const pkg = JSON.parse(await readFile("package.json"));
const platformName = process.platform === "win32" ? "Windows" : "Linux";
const temp = await mkdtemp(path.join(tmpdir(), "bee-portable-"));
const home = path.join(temp, "测试用户 'home"), localAppData = path.join(home, "AppData/Local");
const source = path.join(temp, "安装包 'source");
const options = { source, home, localAppData };
let child;
try {
  // 从归档重新解包后执行；验证用户下载内容，而不是只测试 staging。
  const { execFileSync } = await import("node:child_process");
  const archive = path.resolve(`.local/installers/BeeHelper-${pkg.version}-${platformName}-${process.arch}.${process.platform === "win32" ? "zip" : "tar.gz"}`);
  const extract = path.join(temp, "extract");
  const { mkdir } = await import("node:fs/promises"); await mkdir(extract);
  if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-Command", 'Expand-Archive -LiteralPath $env:BEEHELPER_ARCHIVE -DestinationPath $env:BEEHELPER_EXTRACT'], { env: { ...process.env, BEEHELPER_ARCHIVE: archive, BEEHELPER_EXTRACT: extract } });
  else execFileSync("tar", ["-xzf", archive, "-C", extract]);
  await cp(path.join(extract, `BeeHelper-${pkg.version}-${platformName}-${process.arch}`), source, { recursive: true });
  const installed = await installPortable(options);
  await access(installed.nativeHost);
  await assert.rejects(access(path.join(installed.release, "node_modules")));
  const fixture = path.join(temp, "fixture-agent.mjs");
  await cp("tests/fixtures/fake-agent.mjs", fixture);
  const runtime = path.join(installed.release, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const config = path.join(temp, "agents.json");
  await writeFile(config, JSON.stringify({ agents: [{ id: "portable-fixture", name: "Portable Fixture", command: runtime, args: [fixture, "--acp-fixture", "--native-mcp-probe"] }] }));
  const env = { ...process.env, BEEHELPER_WORKSPACE: path.join(temp, "workspace"), BEEHELPER_AGENTS_CONFIG: config,
    PATH: process.platform === "win32" ? path.join(process.env.WINDIR, "System32") : "/usr/bin:/bin" };
  for (const name of ["CODEX", "CLAUDE", "DSH", "CODEBUDDY", "CLAUDE_ACP"]) env[`BEEHELPER_${name}`] = path.join(temp, "missing-agent");
  child = spawn(installed.nativeHost, ["chrome-extension://llkomjgjbldjelaemjcgphogaceejbpi/"], { cwd: temp, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const decoder = new FrameDecoder(), pending = new Map(); let sequence = 0, stderr = "", transcript = "";
  const fail = error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); };
  child.stderr.on("data", data => stderr += data);
  child.once("error", fail); child.once("exit", code => fail(new Error(`分发连接器退出 ${code}: ${stderr}`)));
  let doneResolve; const done = new Promise(resolve => doneResolve = resolve);
  child.stdout.on("data", chunk => {
    for (const message of decoder.push(chunk)) {
      if (message.kind === "tool") child.stdin.write(encodeFrame({ kind: "toolResult", id: message.id, result: { portableSmoke: true } }));
      if (message.event?.type === "delta") transcript += message.event.text;
      if (message.event?.type === "done") doneResolve(message.event.status);
      const request = pending.get(message.id);
      if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); }
    }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时: ${stderr}`)); }, 30_000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(encodeFrame({ kind: "rpc", id, method, params }));
  });
  const diagnostics = await rpc("diagnostics"); assert.equal(diagnostics.version, pkg.version);
  const scope = { sessionId: "smoke", connectionId: "smoke", providerId: "portable-fixture" };
  assert.equal((await rpc("connect", scope)).appliedModel, "alpha");
  await rpc("send", { ...scope, messageId: "probe", text: "portable-mcp-probe" });
  let timer;
  try { assert.equal(await Promise.race([done, new Promise((_, reject) => timer = setTimeout(() => reject(new Error(`MCP probe 超时: ${stderr}`)), 45_000))]), "completed"); }
  finally { clearTimeout(timer); }
  assert.match(transcript, /portableSmoke/);
  const exit = new Promise(resolve => child.once("exit", resolve)); child.stdin.end();
  let exitTimer;
  try { await Promise.race([exit, new Promise((_, reject) => exitTimer = setTimeout(() => reject(new Error("宿主未随 stdin 关闭")), 10_000))]); }
  finally { clearTimeout(exitTimer); }
  child = undefined;
  const repaired = await installPortable(options); assert.notEqual(repaired.nativeHost, installed.nativeHost);
  await rm(path.join(source, "connector/mcp.mjs"));
  await assert.rejects(installPortable(options));
  const paths = portablePaths(options);
  assert.equal(JSON.parse(await readFile(paths.record)).nativeHost, repaired.nativeHost);
  if (process.platform !== "win32") await writeFile(paths.manifests[1], JSON.stringify({ path: "/another/connector" }));
  await uninstallPortable(options);
  await assert.rejects(access(paths.record)); await assert.rejects(access(paths.manifests[0]));
  if (process.platform !== "win32") assert.equal(JSON.parse(await readFile(paths.manifests[1])).path, "/another/connector");
  await access(repaired.extensionDirectory);
  console.log(JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, archiveExtracted: true, installation: true, nativeMessaging: true, acp: true, mcpRoundtrip: true, repair: true, failurePreservesInstallation: true, uninstall: true, bundledRuntime: true }));
} catch (error) { console.error(error); throw error; }
finally {
  if (child) {
    if (process.platform === "win32") {
      const { execFileSync } = await import("node:child_process");
      try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" }); } catch {}
    } else child.kill();
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
