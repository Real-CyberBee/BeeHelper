import test from "node:test";
import assert from "node:assert/strict";
import { acpContent, codexContent, normalizeOptions, verifyCommand } from "../connector/content.mjs";

const file = { id: "id", name: "test.csv", kind: "file", mime: "text/csv", uri: "file:///staged/test.csv", path: "/staged/test.csv", text: "sku,count\n1,2", size: 13 };
const image = { id: "image", kind: "image", mime: "image/png", path: "/staged/picture.png", data: "aGVsbG8=" };
test("ACP 原生命令保持首块原样，文本附件使用资源，二进制不使用被忽略的 blob", () => {
  const prompt = acpContent({ text: "/native args", command: "native", attachments: [file, image] }, { image: true, embeddedContext: true });
  assert.deepEqual(prompt[0], { type: "text", text: "/native args" });
  assert.equal(prompt[1].type, "resource"); assert.equal(prompt.at(-1).type, "image");
  const binary = acpContent({ text: "read", attachments: [{ ...file, text: undefined, mime: "application/pdf" }] }, { embeddedContext: true });
  assert.equal(binary[1].type, "resource_link");
});
test("ACP 未协商图片时拒绝，不伪装成文本；不支持 embeddedContext 时降级文本材料", () => {
  assert.throws(() => acpContent({ text: "look", attachments: [image] }, {}), /图片/);
  const prompt = acpContent({ text: "read", attachments: [file] }, {});
  assert.equal(prompt[1].type, "resource_link"); assert.equal(prompt[2].type, "text");
  assert.match(prompt[2].text, /sku,count/);
});
test("Codex 图片和技能作为结构化输入，不接受浏览器伪造的技能路径", () => {
  const input = codexContent({ text: "look", attachments: [file, image], references: [{ kind: "skill", id: "known", path: "/attacker" }] }, [{ id: "known", name: "skill", path: "/verified/SKILL.md" }]);
  assert.equal(input[1].type, "localImage"); assert.equal(input[2].path, "/verified/SKILL.md");
  assert.match(input[0].text, /sku,count/);
  assert.throws(() => codexContent({ text: "look", references: [{ kind: "skill", id: "unknown" }] }, []), /技能/);
});
test("配置类型与动态命令依据目录，不猜测客户端能力", () => {
  assert.deepEqual(normalizeOptions([{ id: "mode", name: "Mode", type: "select", currentValue: "x", options: [{ group: "g", options: [{ value: "x", name: "X" }] }] }])[0].options, [{ value: "x", name: "X" }]);
  assert.throws(() => verifyCommand({ text: "/missing", command: "missing" }, []), /失效/);
});
