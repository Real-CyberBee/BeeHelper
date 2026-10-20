import test from "node:test";
import assert from "node:assert/strict";
import { applyOperation, current, exportPackage, importPackage, matchesUrl, validateDefinition } from "../src/core/model";
import { createInitialDatabase, panelSample } from "../src/core/samples";
import { createPluginHost } from "../src/core/plugins";

test("候选不默认安装；安装锁定选定版本而非稍后编辑的版本", () => {
  const db = createInitialDatabase();
  const entry = db.entries[0];
  assert.equal(entry.installed, false);
  const first = current(entry);
  const edited = applyOperation(db, { type: "edit", id: entry.id, expectedRevision: first.id, definition: { ...first.definition, title: "修改后" } });
  const installed = applyOperation(edited.db, { type: "install", id: entry.id, revisionId: first.id });
  assert.equal(installed.entry!.installed, true);
  assert.equal(current(installed.entry!).definition.title, first.definition.title);
  assert.equal(installed.entry!.revisions.length, 2);
  assert.equal(db.entries[0].revisions.length, 1);
});
test("源码修改执行 CAS，拒绝覆盖并发更新", () => {
  const db = createInitialDatabase(), entry = db.entries[0];
  const next = applyOperation(db, { type: "edit", id: entry.id, expectedRevision: entry.revisionId, definition: panelSample });
  assert.throws(() => applyOperation(next.db, { type: "edit", id: entry.id, expectedRevision: entry.revisionId, definition: panelSample }), /已被其他操作修改/);
});
test("恢复历史产生新版本而不是删除历史", () => {
  let db = createInitialDatabase(); const first = db.entries[0];
  db = applyOperation(db, { type: "edit", id: first.id, expectedRevision: first.revisionId, definition: { ...panelSample, title: "新版" } }).db;
  const result = applyOperation(db, { type: "restore", id: first.id, revisionId: first.revisionId, expectedRevision: db.entries[0].revisionId });
  assert.equal(result.entry!.revisions.length, 3);
  assert.equal(current(result.entry!).definition.title, current(first).definition.title);
});
test("包往返保留源码历史，但重新导入仍是未安装候选且身份独立", () => {
  const db = createInitialDatabase(); const original = applyOperation(db, { type: "install", id: db.entries[0].id, revisionId: db.entries[0].revisionId }).entry!;
  const imported = importPackage(exportPackage(original));
  assert.notEqual(imported.id, original.id);
  assert.equal(imported.installed, false);
  assert.deepEqual(imported.revisions, original.revisions);
});
test("拒绝损坏、缺版本、重复版本与不支持格式的包", () => {
  assert.throws(() => importPackage("{}"));
  const data = JSON.parse(exportPackage(createInitialDatabase().entries[0]));
  data.app.revisionId = "missing"; assert.throws(() => importPackage(JSON.stringify(data)), /版本不存在/);
  data.app.revisionId = data.app.revisions[0].id; data.app.revisions.push(data.app.revisions[0]); assert.throws(() => importPackage(JSON.stringify(data)), /重复版本/);
});
test("匹配规则区分主机边界、协议与路径，阻止浏览器内部页面", () => {
  assert.equal(matchesUrl("https://*.example.com/*", "https://example.com/a"), true);
  assert.equal(matchesUrl("https://*.example.com/*", "https://a.example.com/a?x=1"), true);
  assert.equal(matchesUrl("https://*.example.com/*", "https://evilexample.com/a"), false);
  assert.equal(matchesUrl("http://localhost/*", "http://localhost:4173/demo.html"), true);
  assert.equal(matchesUrl("https://example.com/client/*", "http://example.com/client/1"), false);
  assert.equal(matchesUrl("<all_urls>", "chrome://extensions/"), false);
  assert.throws(() => validateDefinition({ ...panelSample, matches: ["javascript:*"] }));
  assert.throws(() => validateDefinition({ ...panelSample, trigger: "page" }), /主动运行/);
});
test("不导出当前格式无法重新导入的包", () => {
  const entry = createInitialDatabase().entries[0];
  entry.revisions = Array.from({ length: 501 }, (_, index) => ({ ...entry.revisions[0], id: String(index) }));
  assert.throws(() => exportPackage(entry), /500/);
});
test("Cordis 插件注册实际能力，并在卸载时释放", async () => {
  let disposed = false;
  const host = createPluginHost([{ name: "test", services: { value: 42 }, dispose: () => { disposed = true; } }]);
  await host.context.fiber.await();
  assert.equal(host.get("value"), 42);
  await host.context.fiber.dispose();
  assert.equal(disposed, true);
  assert.throws(() => host.get("value"), /未注册/);
});
