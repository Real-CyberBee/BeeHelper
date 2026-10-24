import test from "node:test";
import assert from "node:assert/strict";
import { setupApp, systemApps, systemAppContext } from "../src/system-apps/registry";
import { diagnosticReport } from "../src/core/onboarding";
test("内置微应用声明身份、不可卸载属性和能力边界，拒绝未声明特权", async () => {
  const calls: string[] = [];
  const context = systemAppContext(setupApp, async <T,>(name: string) => { calls.push(name); return true as T; }, () => {});
  assert.equal(systemApps.length, 1); assert.equal(setupApp.manifest.uninstallable, false);
  assert.equal(await context.request("setupSnapshot"), true);
  await assert.rejects(context.request("operation", { operation: { type: "delete" } }), /未声明/);
  assert.deepEqual(calls, ["setupSnapshot"]);
});
test("导出诊断不会包含发现路径、错误正文和用户内容", () => {
  const report = diagnosticReport({ extension: true, version: "0.4.0", scripts: false, connector: true, completed: false,
    providers: [{ id: "codex", name: "/private/customer-name", reason: "secret page https://internal.example", installed: true, available: true, protocol: "codex-app-server" }] });
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /customer-name|secret|internal.example/);
  assert.equal(report.providers[0].available, true);
});
