import test from "node:test";
import assert from "node:assert/strict";
import capabilities from "../shared/capabilities.json" with { type: "json" };
import { tools, serverInstructions, formatTaskInput } from "../connector/tools.mjs";

test("能力清单与实际注册工具一一对应", () => {
  assert.deepEqual(tools.map(tool => tool[0]), capabilities.tools);
  assert.ok(serverInstructions.slice(0, 512).includes("microapp_get"));
  assert.ok(serverInstructions.slice(0, 512).includes("browser_inspect"));
  assert.ok(serverInstructions.includes("run_get({runId})"));
});
test("旧对话的每轮输入也包含新能力和当前选择，而非只在建会话时提示", () => {
  const first = formatTaskInput("读取源码", { selectedApp: { id: "first" } });
  const second = formatTaskInput("你不能操作页面吗", { selectedApp: { id: "second" }, recentRuns: [{ runId: "full-run-id" }] });
  assert.ok(first.includes('"id":"first"'));
  assert.ok(second.includes('"id":"second"'));
  assert.ok(!second.includes('"id":"first"'));
  assert.ok(second.includes("capabilities_get"));
  assert.ok(second.includes("full-run-id"));
});
