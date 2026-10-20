import test from "node:test";
import assert from "node:assert/strict";
import { FrameDecoder, encodeFrame } from "../connector/framing.mjs";
test("本地帧支持 UTF-8、分片与多帧粘包", () => {
  const messages = [{ text: "中文微应用" }, { id: 2, data: [1, 2, 3] }];
  const bytes = Buffer.concat(messages.map(encodeFrame)); const decoder = new FrameDecoder(); const results = [];
  for (let i = 0; i < bytes.length; i += 3) results.push(...decoder.push(bytes.subarray(i, i + 3)));
  assert.deepEqual(results, messages);
});
test("拒绝非法超大帧，防止无限缓冲", () => {
  const length = Buffer.alloc(4); length.writeUInt32LE(0xffffffff);
  assert.throws(() => new FrameDecoder().push(length), /非法消息长度/);
  assert.throws(() => encodeFrame({ code: "a".repeat(1_000_001) }), /通道限制/);
});
