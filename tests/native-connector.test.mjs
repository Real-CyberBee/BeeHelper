import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "node:net";
import { FrameDecoder, encodeFrame } from "../connector/framing.mjs";
const executable = path.resolve(".local/native/bin/beehelper");
const skip = process.platform !== "darwin" || !existsSync(executable);

async function nativeHost(extraArgs = [], codex = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "bee-native-"));
  const config = path.join(directory, "agents.json");
  await writeFile(config, JSON.stringify({ agents: [{ id: "fixture", name: "Fixture ACP", command: process.execPath, args: [path.resolve("tests/fixtures/fake-agent.mjs"), "--acp-fixture", ...extraArgs] }] }));
  const launcher = path.join(directory, "fake-codex");
  const quote = value => "'"+value.replaceAll("'", "'\\''")+"'";
  await writeFile(launcher, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.resolve("tests/fixtures/fake-agent.mjs"))} "$@"\n`, { mode: 0o700 });
  const child = spawn(executable, [], { cwd: directory, env: { PATH: "/usr/bin:/bin", BEEHELPER_AGENTS_CONFIG: config, BEEHELPER_WORKSPACE: path.join(directory, "workspace"), ...Object.fromEntries(["CODEX", "CLAUDE", "DSH", "CODEBUDDY"].map(key => [`BEEHELPER_${key}`, key === "CODEX" && codex ? launcher : path.join(directory, "absent")])) }, stdio: ["pipe", "pipe", "pipe"] });
  const decoder = new FrameDecoder(), pending = new Map(), events = [], toolRequests = []; let sequence = 0, stderr = "";
  child.stderr.on("data", bytes => { stderr += bytes; });
  child.stdout.on("data", bytes => { for (const message of decoder.push(bytes)) {
    if (message.kind === "event") events.push(message.event);
    if (message.kind === "tool") { toolRequests.push(message); child.stdin.write(encodeFrame({ kind: "toolResult", id: message.id, result: { owner: message.sessionId } })); }
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(message.error)) : request.resolve(message.result); }
  } });
  child.on("exit", code => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`native exit ${code}: ${stderr}`)); } pending.clear(); });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = String(++sequence), timer = setTimeout(() => { pending.delete(id); reject(new Error(`native timeout: ${method}; ${stderr}`)); }, 10_000);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(encodeFrame({ kind: "rpc", id, method, params }));
  });
  return { rpc, events, toolRequests, child, directory, async close() { child.stdin.end(); await new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once("exit", resolve); }); await rm(directory, { recursive: true, force: true }); } };
}
async function until(condition) { for (let index = 0; index < 1000; index++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail("native event timeout"); }

test("原生 JavaScriptCore：ACP 会话、并行隔离、模型配置、插话与取消", { skip }, async () => {
  const host = await nativeHost();
  const a = { sessionId: "A", connectionId: "a", providerId: "fixture" }, b = { sessionId: "B", connectionId: "b", providerId: "fixture" };
  try {
    const snapshot = await host.rpc("diagnostics"); assert.equal(snapshot.providers.find(item => item.id === "fixture").available, true);
    const metadata = await host.rpc("connect", a); await host.rpc("connect", b);
    assert.equal(metadata.appliedModel, "alpha"); assert.equal(metadata.capabilities.steer, true);
    await host.rpc("setModel", { ...a, model: "beta" });
    await host.rpc("send", { ...a, messageId: "a1", text: "hold-test" });
    await host.rpc("send", { ...b, messageId: "b1", text: "hold-test" });
    await until(() => host.events.some(event => event.sessionId === "B" && event.type === "delta"));
    await assert.rejects(host.rpc("send", { ...a, messageId: "dup", text: "dup" }), /正在运行/);
    await host.rpc("send", { ...a, messageId: "steer", text: "finish-test", mode: "steer" });
    await until(() => host.events.some(event => event.sessionId === "A" && event.type === "done"));
    assert.equal(host.events.some(event => event.sessionId === "A" && event.text?.includes("beta")), true);
    assert.equal(host.events.some(event => event.sessionId === "B" && event.type === "done"), false);
    await host.rpc("cancel", b); await until(() => host.events.some(event => event.sessionId === "B" && event.status === "interrupted"));
    await assert.rejects(host.rpc("refresh", { ...a, connectionId: "stale" }), /失效/);
    await host.rpc("disconnect", a);
    const resumed = await host.rpc("connect", { ...a, connectionId: "resumed", nativeSessionId: metadata.nativeSessionId });
    assert.equal(resumed.nativeSessionId, metadata.nativeSessionId);
  } finally { await host.close(); }
});

test("原生 JavaScriptCore：附件分片、重试一致性、UTF-8、校验与会话归属", { skip }, async () => {
  const host = await nativeHost();
  try {
    const content = Buffer.from("姓名,值\n测试,42\n".repeat(3000));
    const file = await host.rpc("attachmentBegin", { sessionId: "A", name: "测试.csv", mime: "text/csv", size: content.length });
    for (let offset = 0; offset < content.length; offset += 32768) {
      const args = { sessionId: "A", id: file.id, offset, data: content.subarray(offset, offset+32768).toString("base64") };
      await host.rpc("attachmentChunk", args); await host.rpc("attachmentChunk", args);
    }
    await assert.rejects(host.rpc("attachmentChunk", { sessionId: "A", id: file.id, offset: 0, data: Buffer.from("bad").toString("base64") }), /不一致/);
    await host.rpc("attachmentChunk", { sessionId: "A", id: file.id, offset: 0, data: content.subarray(0,32768).toString("base64") });
    await host.rpc("attachmentFinish", { sessionId: "A", id: file.id });
    const read = await host.rpc("attachmentRead", { sessionId: "A", id: file.id, offset: 0 });
    assert.equal(Buffer.from(read.data, "base64").subarray(0, 6).toString(), content.subarray(0,6).toString());
    await assert.rejects(host.rpc("attachmentRead", { sessionId: "B", id: file.id, offset: 0 }), /不存在/);
    const scope = { sessionId: "A", connectionId: "a", providerId: "fixture" };
    await host.rpc("connect", scope); await host.rpc("send", { ...scope, messageId: "file", text: "测试附件", attachments: [file] });
    await until(() => host.events.some(event => event.type === "delta" && event.text.includes("file-received")));
  } finally { await host.close(); }
});

test("原生 JavaScriptCore：连接期间授权可回答", { skip }, async () => {
  const host = await nativeHost(["--permission-on-connect"]);
  const scope = { sessionId: "permission", connectionId: "p", providerId: "fixture" };
  try {
    const connecting = host.rpc("connect", scope);
    await until(() => host.events.some(event => event.permission));
    const request = host.events.find(event => event.permission).permission;
    await host.rpc("permission", { ...scope, requestId: request.id, optionId: "once" });
    assert.equal((await connecting).appliedModel, "alpha");
  } finally { await host.close(); }
});

test("原生 MCP：官方 SDK 客户端可发现工具、调用并验证 UTF-8 与参数", { skip }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bee-mcp-")), file = path.join(directory, "t.sock");
  const received = [];
  const server = createServer(socket => { let buffer = ""; socket.setEncoding("utf8"); socket.on("data", data => {
    buffer += data; if (!buffer.includes("\n")) return;
    const request = JSON.parse(buffer); received.push(request); socket.end(JSON.stringify({ result: { query: request.args.query } })+"\n");
  }); });
  await new Promise(resolve => server.listen(file, resolve));
  const client = new Client({ name: "native-test", version: "1" });
  const transport = new StdioClientTransport({ command: executable, args: ["--mcp"], env: { BEEHELPER_SOCKET: file, BEEHELPER_TOKEN: "test", BEEHELPER_SESSION_ID: "A", BEEHELPER_CONNECTION_ID: "a" } });
  try {
    await client.connect(transport);
    const catalog = await client.listTools(); assert.ok(catalog.tools.some(item => item.name === "microapp_create"));
    const result = await client.callTool({ name: "userscript_search", arguments: { query: "中文脚本😀" } });
    assert.equal(JSON.parse(result.content[0].text).query, "中文脚本😀");
    assert.equal(received[0].token, "test"); assert.equal(received[0].sessionId, "A");
    assert.equal((await client.callTool({ name: "browser_action", arguments: { tabId: "wrong" } })).isError, true);
    assert.notEqual((await client.callTool({ name: "browser_open", arguments: { url: "https://example.com/path" } })).isError, true);
    assert.equal(received.length, 2);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});


for (const invalid of [false, true]) test(`原生 host → ACP → MCP → 原生工具代理全链路（${invalid ? "拒绝错误 token" : "有效 token"}）`, { skip }, async () => {
  const host = await nativeHost(["--native-mcp-probe", ...(invalid ? ["--invalid-token"] : [])]);
  const scope = { sessionId: "MCP", connectionId: "mcp", providerId: "fixture" };
  try {
    await host.rpc("connect", scope); await host.rpc("send", { ...scope, messageId: "probe", text: "mcp probe" });
    await until(() => host.events.some(event => event.type === "done"));
    const result = host.events.filter(event => event.type === "delta").map(event => event.text).join("");
    assert.match(result, /mcp-result/);
    if (invalid) { assert.match(result, /isError/); assert.equal(host.toolRequests.length, 0); }
    else { assert.match(result, /owner/); assert.equal(host.toolRequests[0].sessionId, "MCP"); assert.equal(host.toolRequests[0].name, "capabilities_get"); }
  } finally { await host.close(); }
});


test("原生 JavaScriptCore：Codex 握手、技能、推理配置与取消", { skip }, async () => {
  const host = await nativeHost([], true);
  const scope = { sessionId: "codex", connectionId: "c", providerId: "codex" };
  try {
    const metadata = await host.rpc("connect", scope);
    assert.equal(metadata.authenticated, true); assert.equal(metadata.appliedModel, "alpha");
    assert.equal(metadata.skills[0].name, "fixture-skill");
    assert.equal((await host.rpc("setConfig", { ...scope, configId: "effort", value: "high" })).nextTurn, true);
    await host.rpc("send", { ...scope, messageId: "codex-turn", text: "hold-test", config: { effort: "high" } });
    await until(() => host.events.some(event => event.type === "delta"));
    await host.rpc("cancel", scope);
    await until(() => host.events.some(event => event.type === "done" && event.status === "interrupted"));
  } finally { await host.close(); }
});
