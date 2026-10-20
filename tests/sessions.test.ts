import test from "node:test";
import assert from "node:assert/strict";
import { createInitialDatabase } from "../src/core/samples";
import { migrateSessions, createSession, selectSession, addUserMessage, applySessionEvent, removeQueuedMessage, requireSession } from "../src/core/sessions";

test("旧对话迁移完整且幂等，新会话不删除旧历史", () => {
  const legacy = createInitialDatabase();
  legacy.threadId = "old-thread"; legacy.chat = [{ id: "m1", role: "user", text: "旧对话", time: 1 }];
  const db = migrateSessions(legacy);
  const old = requireSession(db);
  assert.equal(old.nativeSessionId, "old-thread"); assert.equal(old.messages[0].text, "旧对话");
  assert.deepEqual(migrateSessions(db), db);
  const next = createSession("claude"); db.sessions!.push(next); selectSession(db, next.id);
  assert.equal(db.chat.length, 0); assert.equal(old.messages.length, 1);
  selectSession(db, old.id); assert.equal(db.chat[0].text, "旧对话");
});
test("后台会话增量不串到前台，旧连接迟到事件被拒绝", () => {
  const db = migrateSessions(createInitialDatabase());
  const a = requireSession(db); a.connectionId = "conn-a";
  const b = createSession("dsh"); b.connectionId = "conn-b"; db.sessions!.push(b); selectSession(db, b.id);
  assert.equal(applySessionEvent(db, { sessionId: a.id, connectionId: "conn-a", type: "delta", messageId: "answer", text: "A" }), true);
  assert.equal(a.messages[0].text, "A"); assert.equal(db.chat.length, 0);
  assert.equal(applySessionEvent(db, { sessionId: a.id, connectionId: "old", type: "delta", messageId: "answer", text: "错误" }), false);
  selectSession(db, a.id); assert.equal(db.chat[0].text, "A");
});
test("队列持久化，未知执行状态不自动重放，停止后队列暂停", () => {
  const db = migrateSessions(createInitialDatabase()); const session = requireSession(db);
  const item = { id: "queued", text: "下一轮", context: { target: 7 }, time: 1 };
  addUserMessage(session, item, true);
  session.state = "running";
  const restored = migrateSessions(db, true); const after = requireSession(restored);
  assert.equal(after.state, "unknown"); assert.equal(after.queuePaused, true); assert.deepEqual(after.queue[0].context, { target: 7 });
  after.connectionId = "new";
  applySessionEvent(restored, { sessionId: after.id, connectionId: "new", type: "done", status: "interrupted" });
  assert.equal(after.queuePaused, true); assert.equal(after.queue.length, 1);
  removeQueuedMessage(after, item.id); assert.equal(after.queue.length, 0); assert.equal(after.messages.length, 0);
});
test("已选择模型与后端实际模型分开，配置回报不覆盖用户下一轮选择", () => {
  const db = migrateSessions(createInitialDatabase()); const session = requireSession(db);
  session.connectionId = "c"; session.model = "next-model";
  applySessionEvent(db, { type: "session", sessionId: session.id, connectionId: "c", appliedModel: "current-model" });
  assert.equal(session.model, "next-model"); assert.equal(session.appliedModel, "current-model");
});
test("同会话多项授权按顺序展示，解决一个不会丢弃其他请求", () => {
  const db = migrateSessions(createInitialDatabase()); const session = requireSession(db); session.connectionId = "c";
  for (const id of ["first", "second"]) applySessionEvent(db, { type: "permission", sessionId: session.id, connectionId: "c", permission: { id, title: id, options: [] } });
  assert.equal(session.permission?.id, "first");
  applySessionEvent(db, { type: "permission", sessionId: session.id, connectionId: "c", requestId: "first" });
  assert.equal(session.permission?.id, "second");
});
test("连接旧快照不能覆盖刚推送的客户端命令与配置目录", () => {
  const db = migrateSessions(createInitialDatabase()), session = requireSession(db); session.connectionId = "c";
  applySessionEvent(db, { type: "session", sessionId: session.id, connectionId: "c", metadataVersion: 2, commands: [{ name: "native", description: "new" }] });
  assert.equal(applySessionEvent(db, { type: "session", sessionId: session.id, connectionId: "c", metadataVersion: 1, commands: [] }), false);
  assert.equal(session.commands?.[0].name, "native");
});
