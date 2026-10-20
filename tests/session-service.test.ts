import test from "node:test";
import assert from "node:assert/strict";
import { AgentSessionService } from "../src/agents/session-service";
import { migrateSessions, requireSession, syncChatProjection } from "../src/core/sessions";
import { createInitialDatabase } from "../src/core/samples";
import type { Database } from "../src/core/model";

function fixture(metadata: Record<string, unknown> = {}, clientAlive?: (id: string) => boolean) {
  let db = migrateSessions(createInitialDatabase());
  let transaction: Promise<unknown> = Promise.resolve();
  const calls: { method: string; params: any }[] = [];
  const service = new AgentSessionService({
    read: () => db, connected: () => true, clientAlive,
    mutate: <T,>(callback: (database: Database) => T): Promise<T> => {
      const next = transaction.catch(() => {}).then(() => {
        const clone = structuredClone(db); const result = callback(clone); syncChatProjection(clone); db = clone; return result;
      }); transaction = next; return next;
    },
    context: async selection => structuredClone(selection),
    request: async (method, params: any) => {
      calls.push({ method, params });
      if (method === "connect") return { nativeSessionId: "native", capabilities: { models: true, steer: true, resume: true, tools: true }, models: [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }], appliedModel: "alpha", ...metadata };
      if (method === "send" && params.text === "timeout") throw new Error("连接器请求超时");
      if (method === "attachmentBegin") return { id: crypto.randomUUID() };
      return { accepted: true };
    }
  });
  return { service, calls, read: () => db };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("等待会话状态超时");
}
test("并发提交只投递一次，其余持久排队；上下文固定、下一轮采用已选模型", async () => {
  const { service, calls, read } = fixture();
  const firstContext = { targetTabId: 1 }, queuedContext = { targetTabId: 2 };
  await Promise.all([
    service.handle({ type: "chat", text: "first", context: firstContext, clientId: "owner-a" }),
    service.handle({ type: "chat", text: "queued", context: queuedContext, clientId: "owner-b" })
  ]);
  assert.equal(calls.filter(call => call.method === "send").length, 1);
  assert.equal(requireSession(read()).queue.length, 1);
  queuedContext.targetTabId = 999;
  await service.handle({ type: "sessionModel", model: "beta" });
  const session = requireSession(read());
  await service.receive({ type: "done", sessionId: session.id, connectionId: session.connectionId, status: "completed" });
  await until(() => calls.filter(call => call.method === "send").length === 2);
  const next = calls.filter(call => call.method === "send")[1].params;
  assert.deepEqual(next.context, { targetTabId: 2 }); assert.equal(next.model, "beta");
  assert.equal(requireSession(read()).executionClientId, "owner-b");
});
test("插话不更换任务所有者，也不夹带切模型参数到协议层", async () => {
  const { service, calls, read } = fixture();
  await service.handle({ type: "chat", text: "first", clientId: "original" });
  await service.handle({ type: "chat", text: "steer", mode: "steer", clientId: "other-window" });
  assert.equal(requireSession(read()).executionClientId, "original");
  assert.equal(calls.filter(call => call.method === "send").at(-1)?.params.mode, "steer");
  assert.equal(requireSession(read()).queue.length, 0);
});
test("停止确认之后队列依然暂停，只有显式继续会再次投递", async () => {
  const { service, calls, read } = fixture();
  await service.handle({ type: "chat", text: "first" });
  await service.handle({ type: "chat", text: "queued" });
  await service.handle({ type: "cancel" });
  const session = requireSession(read());
  await service.receive({ type: "done", sessionId: session.id, connectionId: session.connectionId, status: "interrupted" });
  assert.equal(calls.filter(call => call.method === "send").length, 1);
  assert.equal(requireSession(read()).queuePaused, true);
  await service.handle({ type: "queueResume" });
  assert.equal(calls.filter(call => call.method === "send").length, 2);
});
test("投递超时保留结果未知，不允许自动重放；旧连接事件不触发队列", async () => {
  const { service, calls, read } = fixture();
  await assert.rejects(service.handle({ type: "chat", text: "timeout" }), /超时/);
  assert.equal(requireSession(read()).state, "unknown");
  assert.equal(requireSession(read()).messages[0].delivery, "unknown");
  await assert.rejects(service.handle({ type: "chat", text: "retry" }), /先恢复/);
  const session = requireSession(read());
  assert.equal(await service.receive({ type: "done", sessionId: session.id, connectionId: "stale", status: "completed" }), false);
  assert.equal(calls.filter(call => call.method === "send").length, 1);
});
test("无效模型不改变会话设置；归档保留原生恢复标识", async () => {
  const { service, read } = fixture();
  await service.handle({ type: "connect" });
  await assert.rejects(service.handle({ type: "sessionModel", model: "made-up" }), /可选列表/);
  assert.equal(requireSession(read()).model, undefined);
  const old = requireSession(read());
  await service.handle({ type: "sessionArchive", sessionId: old.id, archived: true });
  const archived = read().sessions!.find(item => item.id === old.id)!;
  assert.equal(archived.nativeSessionId, "native"); assert.equal(archived.archived, true);
  assert.notEqual(read().activeSessionId, old.id);
});
test("纯附件可发送，原始字节与客户端路径不进入会话投递帧", async () => {
  const { service, calls, read } = fixture();
  const attachment = { id: crypto.randomUUID(), name: "file.txt", mime: "text/plain", kind: "file", size: 3, createdAt: 1, path: "/forged" };
  await service.handle({ type: "chat", attachments: [attachment] });
  const sent = calls.find(call => call.method === "send")!.params;
  assert.deepEqual(sent.attachments, [{ id: attachment.id }]);
  assert.equal(requireSession(read()).messages[0].attachments?.[0].name, "file.txt");
  assert.equal("path" in requireSession(read()).messages[0].attachments![0], false);
});
test("未知原生命令和不支持的图片在投递前拒绝，不丢失用户草稿", async () => {
  const { service, calls, read } = fixture({ capabilities: { models: true, steer: true, resume: true, tools: true, images: false }, commands: [] });
  await service.handle({ type: "sessionDraft", draft: { text: "/unknown", references: [], attachments: [] } });
  await assert.rejects(service.handle({ type: "chat", text: "/unknown" }), /未声明/);
  const image = { id: crypto.randomUUID(), name: "image.png", mime: "image/png", kind: "image", size: 5, createdAt: 1 };
  await assert.rejects(service.handle({ type: "chat", attachments: [image] }), /图片/);
  assert.equal(requireSession(read()).messages.length, 0); assert.equal(calls.some(call => call.method === "send"), false);
  assert.equal(requireSession(read()).draft?.text, "/unknown");
});
test("会话配置按下一轮应用，延迟草稿写入不覆盖较新的输入", async () => {
  const { service, calls, read } = fixture({ configOptions: [{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "code", options: [{ value: "code", name: "Code" }, { value: "plan", name: "Plan" }] }] });
  await service.handle({ type: "chat", text: "first" }); await service.handle({ type: "chat", text: "next" });
  await service.handle({ type: "sessionConfig", configId: "mode", value: "plan" });
  assert.equal(calls.some(call => call.method === "setConfig"), false);
  const session = requireSession(read());
  await service.receive({ type: "done", sessionId: session.id, connectionId: session.connectionId, status: "completed" });
  await until(() => calls.filter(call => call.method === "send").length === 2);
  assert.equal(calls.filter(call => call.method === "send")[1].params.config.mode, "plan");
  await service.handle({ type: "sessionDraft", updatedAt: 100, draft: { text: "new", attachments: [], references: [] } });
  await service.handle({ type: "sessionDraft", updatedAt: 1, draft: { text: "old", attachments: [], references: [] } });
  assert.equal(requireSession(read()).draft?.text, "new");
});
test("关闭工作台释放其未完成上传，不取消其他窗口上传", async () => {
  let alive = true;
  const { service, calls } = fixture({}, () => alive);
  const first = await service.handle({ type: "attachmentBegin", clientId: "one", name: "one.txt", mime: "text/plain", size: 2 });
  const second = await service.handle({ type: "attachmentBegin", clientId: "two", name: "two.txt", mime: "text/plain", size: 2 });
  alive = false; await service.releaseClient("one");
  assert.equal(calls.filter(call => call.method === "attachmentAbort").length, 1);
  assert.equal(calls.find(call => call.method === "attachmentAbort")?.params.id, first.id);
  assert.notEqual(first.id, second.id);
  await assert.rejects(service.handle({ type: "attachmentBegin", clientId: "one", name: "closed.txt", mime: "text/plain", size: 1 }), /已关闭/);
});
