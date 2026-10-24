import test from "node:test";
import assert from "node:assert/strict";
import { pageActivity } from "../src/core/page-activity";
import { applyOperation, type Database, type Run } from "../src/core/model";
import { formSample } from "../src/core/samples";
const target = { tabId: 7, documentId: "document-current", url: "https://example.com/path" };
function fixture(status: Run["status"] = "active") {
  const result = applyOperation({ version: 2, entries: [], runs: [], chat: [] } as Database, { type: "create", definition: { ...formSample, matches: ["https://example.com/*"] } });
  const db = result.db, entry = result.entry!;
  entry.installed = true;
  const run = { id: "run", appId: entry.id, revisionId: entry.revisionId, documentId: target.documentId, tabId: 7, status, title: "test", startedAt: 1, trial: false, logs: [] };
  db.runs.push(run);
  return { db, entry, instance: { ...target, appId: entry.id, runId: run.id, revisionId: entry.revisionId } };
}
test("匹配、历史成功与实际生效分别表达，不根据旧日志推断运行", () => {
  const { db, instance } = fixture();
  assert.equal(pageActivity(db, target, [], true)[0].state, "manual");
  assert.equal(pageActivity(db, target, [instance], true)[0].state, "active");
  db.runs[0].status = "succeeded";
  const item = pageActivity(db, target, [instance], true)[0];
  assert.equal(item.state, "succeeded"); assert.equal(item.runId, undefined);
});
test("同 URL 刷新换文档、换标签页与 SPA 不把旧实例标为生效", () => {
  const { db, instance } = fixture();
  for (const changed of [{ ...target, documentId: "new-document" }, { ...target, tabId: 8 }, { ...target, url: "https://example.com/next" }]) {
    assert.notEqual(pageActivity(db, changed, [instance], true)[0].state, "active");
  }
});
test("候选只有当前文档存在临时实例才进入页面面板，禁用和权限可解释", () => {
  const { db, instance, entry } = fixture(); entry.installed = false;
  assert.equal(pageActivity(db, target, [], true).length, 0);
  assert.equal(pageActivity(db, target, [instance], true)[0].installed, false);
  entry.installed = true; entry.enabled = false; db.runs[0].status = "failed";
  assert.equal(pageActivity(db, target, [], true)[0].state, "disabled");
  entry.enabled = true; db.runs = [];
  assert.equal(pageActivity(db, target, [], false)[0].state, "permission");
});
test("后台重启后保留未知结果，不虚报仍有可控制的实例", () => {
  const { db } = fixture("unknown");
  const item = pageActivity(db, target, [], true)[0];
  assert.equal(item.state, "unknown"); assert.equal(item.runId, undefined);
});
