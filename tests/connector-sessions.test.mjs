import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { SessionHost } from "../connector/session-host.mjs";
import { createProviderRegistry } from "../connector/providers/registry.mjs";
import { createCodexAdapter } from "../connector/providers/codex.mjs";
import { createAcpAdapter, normalizeConfig } from "../connector/providers/acp.mjs";

const fixture = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const mcpPath = fileURLToPath(new URL("../connector/mcp.mjs", import.meta.url));
function hostFor(protocol, args = []) {
  const events = [];
  const factory = protocol === "codex" ? createCodexAdapter : createAcpAdapter;
  const registry = createProviderRegistry([{ id: protocol, name: protocol, available: true, protocol, create: options => factory({ ...options, launch: { command: process.execPath, args: [fixture, ...(protocol === "acp" ? ["--acp-fixture"] : []), ...args] } }) }]);
  const host = new SessionHost({ registry, workspace: tmpdir(), mcpPath, version: "test", emit: event => events.push(event) });
  host.socketPath = "/tmp/beehelper-not-used-in-protocol-fixture";
  return { host, events };
}
async function until(condition) {
  for (let i = 0; i < 200; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail("未收到预期会话事件");
}
for (const protocol of ["codex", "acp"]) test(`${protocol} 插件：真实子进程握手、模型、插话、取消、会话隔离`, async () => {
  const { host, events } = hostFor(protocol);
  const a = { sessionId: "A", connectionId: "conn-A", providerId: protocol };
  const b = { sessionId: "B", connectionId: "conn-B", providerId: protocol };
  try {
    const meta = await host.connect(a); await host.connect(b);
    assert.equal(meta.models.length, 2); assert.equal(meta.capabilities.steer, true);
    await host.setModel({ ...a, model: "beta" });
    await host.send({ ...a, messageId: "a1", text: "hold-test", model: "beta" });
    await host.send({ ...b, messageId: "b1", text: "hold-test" });
    await until(() => events.some(event => event.sessionId === "B" && event.type === "delta"));
    await assert.rejects(host.send({ ...a, messageId: "duplicate", text: "another" }), /正在运行/);
    await host.send({ ...a, messageId: "steer", mode: "steer", text: "finish-test" });
    await until(() => events.some(event => event.sessionId === "A" && event.type === "done"));
    assert.equal(events.some(event => event.sessionId === "A" && event.text?.includes("beta")), true);
    assert.equal(events.some(event => event.sessionId === "B" && event.type === "done"), false);
    await host.cancel(b);
    await until(() => events.some(event => event.sessionId === "B" && event.type === "done" && event.status === "interrupted"));
    assert.equal(events.some(event => event.type === "delta" && !event.connectionId), false);
    await assert.rejects(host.send({ ...a, connectionId: "stale", messageId: "old", text: "old" }), /失效/);
    assert.equal(host.scope("A", "conn-B"), undefined);
    host.disconnect(a);
    const resumed = await host.connect({ ...a, connectionId: "resumed", nativeSessionId: meta.nativeSessionId });
    assert.equal(resumed.nativeSessionId, meta.nativeSessionId);
  } finally { host.close(); }
});
test("ACP 模型目录支持分组，配置 ID 不硬编码", () => {
  const config = normalizeConfig([{ id: "provider/model", category: "model", currentValue: "chosen", options: [{ group: "g", options: [{ value: "chosen", name: "Chosen" }] }] }]);
  assert.equal(config.modelConfigId, "provider/model"); assert.deepEqual(config.models, [{ id: "chosen", name: "Chosen" }]);
});
test("ACP 切换后采用新模型目录，不尝试设置已被移除的旧选项", async () => {
  const { host } = hostFor("acp", ["--dynamic-models"]);
  const scope = { sessionId: "dynamic", connectionId: "dynamic", providerId: "acp" };
  try {
    const before = await host.connect(scope);
    assert.equal(before.models.length, 3);
    const after = await host.setModel({ ...scope, model: "alpha" });
    assert.equal(after.models.length, 2); assert.equal(after.appliedModel, "alpha");
    await assert.rejects(host.setModel({ ...scope, model: "auto" }), /未提供/);
  } finally { await host.close(); }
});
test("Codex 压缩命令不冒充已经应用下一轮模型和推理配置", async () => {
  const { host, events } = hostFor("codex");
  const scope = { sessionId: "compact", connectionId: "compact", providerId: "codex" };
  try {
    await host.connect(scope);
    await host.setModel({ ...scope, model: "beta" });
    await host.send({ ...scope, messageId: "compact-message", text: "/compact", command: "compact", model: "beta", config: { effort: "high" } });
    await until(() => events.some(event => event.type === "done"));
    assert.equal(events.filter(event => event.type === "session").at(-1).appliedModel, "alpha");
  } finally { await host.close(); }
});
for (const configured of [false, true]) test(`Codex 首轮保留原生推理配置：${configured ? "有已确认值" : "未确认时不猜目录默认值"}`, async () => {
  const { host, events } = hostFor("codex", ["--inspect-effort", ...(configured ? ["--configured-effort"] : [])]);
  const scope = { sessionId: "effort", connectionId: "effort", providerId: "codex" };
  try {
    await host.connect(scope);
    await host.send({ ...scope, messageId: "first", text: "first" });
    await until(() => events.some(event => event.type === "done"));
    assert.equal(events.some(event => event.text?.includes(`effort:${configured ? "high" : "unset"}`)), true);
  } finally { await host.close(); }
});
test("连接失败可重试，旧连接事件不重新写入新会话", async () => {
  let options, creations = 0; const events = [];
  const registry = createProviderRegistry([{ id: "custom", name: "Custom", available: true, protocol: "fixture", create: context => {
    options = context; const generation = ++creations;
    return { connect: async () => { if (generation === 1) throw new Error("初次失败"); return { nativeSessionId: "n", capabilities: { steer: false } }; }, close() {} };
  } }]);
  const host = new SessionHost({ registry, workspace: tmpdir(), mcpPath, emit: event => events.push(event) }); host.socketPath = "/unused";
  try {
    await assert.rejects(host.connect({ sessionId: "a", connectionId: "old", providerId: "custom" }), /初次失败/);
    const stale = options;
    await host.connect({ sessionId: "a", connectionId: "new", providerId: "custom" });
    const before = events.length;
    stale.emit({ type: "delta", text: "stale" });
    assert.equal(events.length, before);
  } finally { host.close(); }
});
test("目录同步期间的新通知不会被较旧的请求返回值覆盖", async () => {
  const registry = createProviderRegistry([{ id: "catalog", name: "Catalog", protocol: "fixture", available: true, create: options => ({
    connect: async () => ({ nativeSessionId: "catalog-native", commands: [] }),
    refresh: async () => { options.emit({ type: "session", nativeSessionId: "catalog-native", commands: [{ name: "new-command", description: "new" }] }); return { nativeSessionId: "catalog-native", commands: [] }; },
    close() {}
  }) }]);
  const host = new SessionHost({ registry, workspace: tmpdir(), mcpPath, emit() {} }); host.socketPath = "/unused";
  const scope = { sessionId: "catalog", connectionId: "catalog", providerId: "catalog" };
  try {
    await host.connect(scope);
    const result = await host.refresh(scope);
    assert.equal(result.commands[0]?.name, "new-command");
  } finally { await host.close(); }
});
