import test from "node:test";
import assert from "node:assert/strict";
import { commandToken, completionToken, validateDraft } from "../src/core/chat-content";
import { localCommand, availableClientCommands } from "../src/core/chat-commands";
import { migrateSessions, requireSession, addUserMessage } from "../src/core/sessions";
import { createInitialDatabase } from "../src/core/samples";

test("命令与路径不混淆，提及检测尊重光标与邮箱边界", () => {
  assert.deepEqual(commandToken("/compact"), { name: "compact", args: "" });
  assert.equal(commandToken("/tmp/report.txt"), undefined);
  assert.deepEqual(completionToken("请看 @表单", 6), { kind: "reference", query: "表单", start: 3, end: 6 });
  assert.equal(completionToken("qa@example.com", 14), undefined);
  assert.equal(completionToken("hello /comp", 11), undefined);
  assert.equal(completionToken("/comp", 5)?.kind, "command");
});
test("客户端原生命令优先，BeeHelper 命令保留独立命名空间", () => {
  const native = [{ name: "status", description: "native" }];
  assert.equal(localCommand("status", native), undefined);
  assert.equal(localCommand("bee:status", native), "status");
  assert.equal(availableClientCommands(native).some(command => command.name === "bee:status"), true);
});
test("富消息在队列及迁移中保留附件与引用，不把路径当附件 ID", () => {
  const attachment = { id: crypto.randomUUID(), name: "test.csv", mime: "text/csv", size: 2, kind: "file" as const, createdAt: 1 };
  const content = validateDraft({ text: "", attachments: [attachment], references: [{ kind: "microapp", id: "app", label: "应用" }] });
  const db = migrateSessions(createInitialDatabase()), session = requireSession(db);
  addUserMessage(session, { id: "m", text: "", context: {}, time: 1, attachments: content.attachments, references: content.references }, true);
  const restored = requireSession(migrateSessions(db, true));
  assert.equal(restored.messages[0].attachments![0].id, attachment.id); assert.equal(restored.queue[0].references![0].id, "app");
  assert.throws(() => validateDraft({ ...content, attachments: [{ ...attachment, id: "/etc/passwd" }] }), /元数据/);
  assert.throws(() => validateDraft({ ...content, attachments: [attachment, attachment] }), /重复/);
});
