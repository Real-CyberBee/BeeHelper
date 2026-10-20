import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import limits from "../shared/content-limits.json" with { type: "json" };

const idPattern = /^[a-f0-9-]{36}$/i;
const imageTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const imageExtensions = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/webp", ".webp"], ["image/gif", ".gif"]]);
function owner(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new Error("附件会话标识无效");
  return value;
}
function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
}
async function digest(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
export class AttachmentStore {
  constructor(root) { this.root = root; this.uploads = new Map(); }
  directory(sessionId) { return path.join(this.root, owner(sessionId)); }
  paths(sessionId, id) {
    if (!idPattern.test(id)) throw new Error("附件 ID 无效");
    const directory = this.directory(sessionId);
    return { directory, file: path.join(directory, `${id}.bin`), manifest: path.join(directory, `${id}.json`), part: path.join(directory, `${id}.part`) };
  }
  async begin(params) {
    const sessionId = owner(params.sessionId);
    if (!Number.isSafeInteger(params.size) || params.size < 0 || params.size > limits.maxFileBytes) throw new Error("文件超过 20 MB 或大小无效");
    if (typeof params.name !== "string" || !params.name || params.name.length > 250 || typeof params.mime !== "string" || params.mime.length > 150) throw new Error("文件名称或类型无效");
    if (this.uploads.size >= 16) throw new Error("正在上传的文件过多");
    if (imageTypes.has(params.mime) && params.size > limits.maxImageBytes) throw new Error("图片超过 4 MB");
    const id = randomUUID(), paths = this.paths(sessionId, id);
    const suffix = path.extname(params.name).toLowerCase();
    const extension = imageExtensions.get(params.mime) ?? (/^\.[a-z0-9]{1,12}$/.test(suffix) ? suffix : ".bin");
    paths.file = path.join(paths.directory, `${id}${extension}`);
    await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    const file = await open(paths.part, "wx+", 0o600);
    const metadata = { id, name: params.name.replace(/[/\\\u0000-\u001f]/g, "_"), mime: params.mime || "application/octet-stream", size: params.size, kind: imageTypes.has(params.mime) ? "image" : "file", createdAt: Date.now() };
    this.uploads.set(id, { sessionId, paths, file, metadata, extension, offset: 0, lock: Promise.resolve() });
    return metadata;
  }
  upload(params) {
    const upload = this.uploads.get(params.id);
    if (!upload || upload.sessionId !== owner(params.sessionId)) throw new Error("上传已失效，请重新选择文件");
    return upload;
  }
  async chunk(params) {
    const upload = this.upload(params);
    const next = upload.lock.catch(() => {}).then(async () => {
      if (typeof params.data !== "string" || params.data.length > Math.ceil(limits.chunkBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(params.data)) throw new Error("附件分片编码无效");
      const bytes = Buffer.from(params.data, "base64");
      if (!Number.isSafeInteger(params.offset) || params.offset < 0 || params.offset + bytes.length > upload.metadata.size) throw new Error("附件分片超出范围");
      if (params.offset < upload.offset) {
        if (params.offset + bytes.length > upload.offset) throw new Error("附件分片重叠");
        const old = Buffer.alloc(bytes.length); await upload.file.read(old, 0, old.length, params.offset);
        if (!old.equals(bytes)) throw new Error("重试分片内容不一致");
        return { offset: upload.offset };
      }
      if (params.offset !== upload.offset) throw new Error("附件分片顺序错误");
      let written = 0;
      while (written < bytes.length) {
        const result = await upload.file.write(bytes, written, bytes.length - written, upload.offset + written);
        if (!result.bytesWritten) throw new Error("无法继续写入附件");
        written += result.bytesWritten;
      }
      upload.offset += written; return { offset: upload.offset };
    });
    upload.lock = next; return next;
  }
  async finish(params) {
    const upload = this.upload(params);
    await upload.lock;
    if (upload.offset !== upload.metadata.size) throw new Error("附件尚未传输完整");
    const header = Buffer.alloc(16); await upload.file.read(header, 0, header.length, 0);
    if (upload.metadata.kind === "image" && imageMime(header) !== upload.metadata.mime) throw new Error("图片内容与声明类型不一致");
    await upload.file.sync(); await upload.file.close();
    await rename(upload.paths.part, upload.paths.file);
    const hash = await digest(upload.paths.file);
    const manifest = { ...upload.metadata, sessionId: upload.sessionId, sha256: hash, extension: upload.extension };
    await writeManifest(upload.paths.manifest, manifest);
    this.uploads.delete(params.id);
    return upload.metadata;
  }
  async abort(params) {
    const upload = this.uploads.get(params.id);
    if (!upload || upload.sessionId !== owner(params.sessionId)) return false;
    this.uploads.delete(params.id); await upload.lock.catch(() => {});
    await upload.file.close().catch(() => {}); await rm(upload.paths.part, { force: true });
    return true;
  }
  async get(sessionId, id) {
    const paths = this.paths(sessionId, id);
    let manifest;
    try { manifest = JSON.parse(await readFile(paths.manifest, "utf8")); }
    catch { throw new Error("附件不存在或暂存文件已被清理，请重新选择"); }
    if (manifest.sessionId !== sessionId || manifest.id !== id || !Number.isSafeInteger(manifest.size) || manifest.size > limits.maxFileBytes || manifest.size < 0) throw new Error("附件记录无效");
    if (!/^\.[a-z0-9]{1,12}$/.test(manifest.extension ?? ".bin")) throw new Error("附件扩展名无效");
    paths.file = path.join(paths.directory, `${id}${manifest.extension ?? ".bin"}`);
    const info = await stat(paths.file);
    if (!info.isFile() || info.size !== manifest.size) throw new Error("附件内容已变化，请重新选择");
    return { ...manifest, path: paths.file, uri: pathToFileURL(paths.file).href };
  }
  async read(params) {
    const item = await this.get(owner(params.sessionId), params.id);
    if (!Number.isSafeInteger(params.offset) || params.offset < 0 || params.offset > item.size) throw new Error("读取位置无效");
    const length = Math.min(limits.chunkBytes, item.size - params.offset);
    const file = await open(item.path, "r");
    try {
      const bytes = Buffer.alloc(length); const result = await file.read(bytes, 0, length, params.offset);
      return { data: bytes.subarray(0, result.bytesRead).toString("base64"), offset: params.offset + result.bytesRead, size: item.size };
    } finally { await file.close(); }
  }
  async prepare(sessionId, attachments = []) {
    if (!Array.isArray(attachments) || attachments.length > limits.maxFiles || new Set(attachments.map(item => item.id)).size !== attachments.length) throw new Error("附件数量无效或重复");
    let total = 0; const result = [];
    for (const reference of attachments) {
      const item = await this.get(sessionId, reference.id);
      total += item.size;
      if (total > limits.maxMessageFileBytes) throw new Error("单条消息附件总大小超过限制");
      if (await digest(item.path) !== item.sha256) throw new Error("附件校验失败，请重新选择文件");
      if (item.kind === "image") item.data = (await readFile(item.path)).toString("base64");
      else if (item.size <= limits.maxEmbeddedTextBytes && (item.mime.startsWith("text/") || /^(?:application\/(?:json|xml|javascript|x-yaml))$/.test(item.mime) || /\.(?:txt|md|csv|json|jsonl|ya?ml|xml|html?|css|[cm]?js|jsx|tsx?|py|go|rs|java|sql|log|toml|ini|conf|sh|env)$/i.test(item.name))) {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(item.path));
          if (!text.includes("\0")) item.text = text;
        } catch {}
      }
      result.push(item);
    }
    return result;
  }
  async close() { await Promise.all([...this.uploads].map(([id, upload]) => this.abort({ id, sessionId: upload.sessionId }))); }
}
async function writeManifest(file, data) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(JSON.stringify(data)); } finally { await handle.close(); }
}
