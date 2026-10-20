import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentContext, getRun, listRuns } from "../src/core/agent-context";
import { createInitialDatabase } from "../src/core/samples";
import type { Run } from "../src/core/model";

function fixture() {
  const db = createInitialDatabase();
  const entry = db.entries[0];
  const run: Run = { id: crypto.randomUUID(), appId: entry.id, revisionId: entry.revisionId, title: "测试运行", tabId: 23, startedAt: 1000, trial: true, status: "active", logs: [{ time: 1000, level: "info", text: "private-log-payload" }] };
  db.runs = [run];
  return { db, entry, run };
}
test("每轮上下文来自真实本地库和标签页，附完整运行 ID 与能力，不自动发送源码/日志正文", () => {
  const { db, entry, run } = fixture();
  const context = buildAgentContext(db, { selectedAppId: entry.id, revisionId: entry.revisionId, targetTabId: 23, hasUnsavedChanges: true }, [{ id: 23, title: "真实页面", url: "https://example.com/form" }]);
  assert.equal(context.selectedApp?.title, entry.revisions[0].definition.title);
  assert.equal(context.targetPage?.title, "真实页面");
  assert.equal(context.recentRuns[0].runId, run.id);
  assert.equal(context.recentRuns[0].logCount, 1);
  assert.equal(context.hasUnsavedChanges, true);
  assert.equal(context.capabilities.browser.openShadowDOM, true);
  assert.ok(context.capabilities.tools.includes("microapp_get"));
  assert.ok(!JSON.stringify(context).includes("private-log-payload"));
  assert.ok(!JSON.stringify(context).includes(entry.revisions[0].definition.code));
});
test("不把已关闭页面或其他微应用错误地当成当前上下文", () => {
  const { db } = fixture();
  const context = buildAgentContext(db, { selectedAppId: "missing", targetTabId: 999 }, [{ id: 23, title: "别的页面", url: "https://example.com/" }]);
  assert.equal(context.selectedApp, null);
  assert.equal(context.targetPage, null);
  assert.equal(context.targetUnavailable, true);
  assert.deepEqual(context.recentRuns, []);
});
test("run_get 读完整 runId，也兼容旧 id；不再将错误标识返回 null", () => {
  const { db, run, entry } = fixture();
  assert.equal(getRun(db, { runId: run.id }).logs[0].text, "private-log-payload");
  assert.equal(getRun(db, { id: run.id }).runId, run.id);
  assert.throws(() => getRun(db, { runId: entry.id }), /微应用 ID/);
  assert.throws(() => getRun(db, { runId: run.id.slice(0, 8) + "…" }), /缩略/);
  assert.throws(() => getRun(db, { runId: "unknown" }), /run_list/);
  assert.throws(() => getRun(db, {}), /缺少完整 runId/);
  assert.throws(() => getRun(db, { runId: run.id, id: "other" }), /不一致/);
});
test("run_list 可按微应用/标签页恢复运行上下文，不泄漏日志正文", () => {
  const { db, entry, run } = fixture();
  assert.equal(listRuns(db, { appId: entry.id })[0].runId, run.id);
  assert.deepEqual(listRuns(db, { appId: "other" }), []);
  assert.deepEqual(listRuns(db, { tabId: 999 }), []);
  assert.ok(!JSON.stringify(listRuns(db)).includes("private-log-payload"));
});
