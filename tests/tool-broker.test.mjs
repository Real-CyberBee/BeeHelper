import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ToolBroker } from "../connector/tool-broker.mjs";

test("MCP 通路验证会话与连接代次，不能串用另一个会话的 token", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bee-b-"));
  const socketPath = path.join(dir, "t.sock");
  const scopes = new Map([["A", { sessionId: "A", connectionId: "a", token: "a".repeat(64), emit() {} }], ["B", { sessionId: "B", connectionId: "b", token: "b".repeat(64), emit() {} }]]);
  const emitted = [];
  const broker = new ToolBroker({
    sessions: { scope: (id, connectionId) => { const scope = scopes.get(id); return scope?.connectionId === connectionId ? scope : undefined; } },
    emit: event => { emitted.push(event); broker.reply({ id: event.id, result: { owner: event.sessionId } }); }
  });
  await broker.listen(socketPath);
  const call = request => new Promise((resolve, reject) => {
    const socket = connect(socketPath); let buffer = "";
    socket.setEncoding("utf8"); socket.on("error", reject);
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", data => { buffer += data; });
    socket.on("end", () => resolve(buffer ? JSON.parse(buffer) : null));
  });
  try {
    const result = await call({ sessionId: "A", connectionId: "a", token: "a".repeat(64), name: "capabilities_get", args: {} });
    assert.deepEqual(result, { result: { owner: "A" } });
    assert.equal(await call({ sessionId: "B", connectionId: "b", token: "a".repeat(64), name: "capabilities_get", args: {} }), null);
    assert.equal(await call({ sessionId: "A", connectionId: "old", token: "a".repeat(64), name: "capabilities_get", args: {} }), null);
    assert.equal(emitted.length, 1);
  } finally { broker.close(); await rm(dir, { recursive: true, force: true }); }
});
