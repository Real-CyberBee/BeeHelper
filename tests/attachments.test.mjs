import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AttachmentStore } from "../connector/attachments.mjs";
import { encodeFrame } from "../connector/framing.mjs";
import limits from "../shared/content-limits.json" with { type: "json" };

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "bee-attachments-"));
  const store = new AttachmentStore(root);
  try { await run(store, root); } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}
async function stage(store, bytes, mime = "text/plain", name = "测试.txt") {
  const meta = await store.begin({ sessionId: "a", name, mime, size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += limits.chunkBytes) await store.chunk({ sessionId: "a", id: meta.id, offset, data: bytes.subarray(offset, offset + limits.chunkBytes).toString("base64") });
  return store.finish({ sessionId: "a", id: meta.id });
}
test("附件分片保持 UTF-8 和内容完整，重启后仍可按会话读取", async () => fixture(async (store, root) => {
  const bytes = Buffer.from("测试数据,数量\n商品,12\n".repeat(15000));
  const meta = await stage(store, bytes, "text/csv", "../report.csv");
  const restored = new AttachmentStore(root);
  const item = await restored.get("a", meta.id);
  assert.ok(item.path.endsWith(".csv")); assert.equal(meta.name.includes("/"), false);
  const chunks = [];
  for (let offset = 0; offset < meta.size;) {
    const result = await restored.read({ sessionId: "a", id: meta.id, offset });
    chunks.push(Buffer.from(result.data, "base64")); offset = result.offset;
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  await assert.rejects(restored.get("b", meta.id), /不存在/);
  await assert.rejects(restored.get("../outside", meta.id), /无效/);
  await restored.close();
}));
test("分片可幂等重试，但不允许重排、篡改或突破声明大小", async () => fixture(async store => {
  const meta = await store.begin({ sessionId: "a", name: "chunk.txt", mime: "text/plain", size: 6 });
  const part = { sessionId: "a", id: meta.id, offset: 0, data: Buffer.from("abc").toString("base64") };
  assert.equal((await store.chunk(part)).offset, 3);
  assert.equal((await store.chunk(part)).offset, 3);
  await assert.rejects(store.chunk({ ...part, data: Buffer.from("xyz").toString("base64") }), /不一致/);
  await assert.rejects(store.chunk({ ...part, offset: 4 }), /范围|顺序/);
  await store.chunk({ ...part, offset: 3, data: Buffer.from("def").toString("base64") });
  const result = await store.finish({ sessionId: "a", id: meta.id });
  assert.equal((await store.prepare("a", [result]))[0].text, "abcdef");
}));
test("仅接受真实图片签名，附件内容变化后不悄悄重用", async () => fixture(async store => {
  const meta = await store.begin({ sessionId: "a", name: "fake.png", mime: "image/png", size: 4 });
  await store.chunk({ sessionId: "a", id: meta.id, offset: 0, data: Buffer.from("nope").toString("base64") });
  await assert.rejects(store.finish({ sessionId: "a", id: meta.id }), /类型不一致/);
  await store.abort({ sessionId: "a", id: meta.id });
  const valid = await stage(store, Buffer.from("original"));
  const record = await store.get("a", valid.id);
  await writeFile(record.path, "modified");
  await assert.rejects(store.prepare("a", [valid]), /校验失败/);
}));
test("大小、数量和传输帧均有界，未上传完成的文件不能发送", async () => fixture(async store => {
  await assert.rejects(store.begin({ sessionId: "a", name: "large", mime: "application/octet-stream", size: limits.maxFileBytes + 1 }), /20 MB/);
  await assert.rejects(store.begin({ sessionId: "a", name: "large.png", mime: "image/png", size: limits.maxImageBytes + 1 }), /4 MB/);
  const meta = await store.begin({ sessionId: "a", name: "unfinished", mime: "text/plain", size: 3 });
  await assert.rejects(store.finish({ sessionId: "a", id: meta.id }), /尚未/);
  await assert.rejects(store.prepare("a", [meta]), /不存在/);
  assert.ok(encodeFrame({ kind: "rpc", params: { data: Buffer.alloc(limits.chunkBytes).toString("base64") } }).length < 1_000_000);
}));
test("PDF 即使字节恰好是 ASCII，也只提供文件引用而不冒充已解析文本", async () => fixture(async store => {
  const meta = await stage(store, Buffer.from("%PDF-1.7\nnot a parsed document"), "application/pdf", "report.pdf");
  const [prepared] = await store.prepare("a", [meta]);
  assert.equal(prepared.text, undefined); assert.ok(prepared.path.endsWith(".pdf"));
}));
