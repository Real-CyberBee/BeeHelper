import { request } from "../client";
import { contentLimits, type ChatAttachment } from "../core/chat-content";

const urls = new Map<string, string>();
const imageMimes = new Map([["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["webp", "image/webp"], ["gif", "image/gif"]]);
function cacheUrl(id: string, blob: Blob) {
  const previous = urls.get(id); if (previous) URL.revokeObjectURL(previous);
  const url = URL.createObjectURL(blob); urls.set(id, url);
  while (urls.size > 20) { const [key, value] = urls.entries().next().value!; urls.delete(key); URL.revokeObjectURL(value); }
  return url;
}
export function cachedAttachmentUrl(id: string) { return urls.get(id); }
function encode(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return btoa(binary);
}
async function thumbnail(file: File) {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) return;
  try {
    const bitmap = await createImageBitmap(file, { resizeWidth: 128, resizeQuality: "medium" });
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0); bitmap.close();
    const data = canvas.toDataURL("image/webp", 0.65);
    return data.length <= 30_000 ? data : undefined;
  } catch {}
}
export async function uploadAttachment(file: File, sessionId: string, onProgress: (percent: number) => void, signal: AbortSignal): Promise<ChatAttachment> {
  if (file.size > contentLimits.maxFileBytes) throw new Error(`${file.name} 超过 20 MB`);
  const mime = file.type || imageMimes.get(file.name.split(".").at(-1)?.toLowerCase() ?? "") || "application/octet-stream";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime) && file.size > contentLimits.maxImageBytes) throw new Error(`${file.name} 图片超过 4 MB`);
  const check = () => { if (signal.aborted) throw new DOMException("上传已取消", "AbortError"); };
  check();
  const staged = await request<ChatAttachment>("attachmentBegin", { sessionId, name: file.name || "clipboard.png", mime, size: file.size });
  const abort = () => { void request("attachmentAbort", { sessionId, id: staged.id }).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (let offset = 0; offset < file.size; offset += contentLimits.chunkBytes) {
      check();
      const bytes = new Uint8Array(await file.slice(offset, offset + contentLimits.chunkBytes).arrayBuffer());
      await request("attachmentChunk", { sessionId, id: staged.id, offset, data: encode(bytes) });
      onProgress(Math.floor(Math.min(file.size, offset + bytes.length) / file.size * 100));
    }
    check();
    const result = await request<ChatAttachment>("attachmentFinish", { sessionId, id: staged.id });
    check();
    if (result.kind === "image") { result.thumbnail = await thumbnail(file); cacheUrl(result.id, file); }
    onProgress(100); return result;
  } catch (error) {
    await request("attachmentAbort", { sessionId, id: staged.id }).catch(() => {});
    throw error;
  } finally { signal.removeEventListener("abort", abort); }
}
export async function attachmentBlob(item: ChatAttachment, sessionId: string): Promise<Blob> {
  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < item.size;) {
    const chunk = await request<{ data: string; offset: number; size: number }>("attachmentRead", { sessionId, id: item.id, offset });
    if (chunk.offset <= offset || chunk.offset > item.size || chunk.size !== item.size) throw new Error("附件内容不完整，请重新选择文件");
    const binary = atob(chunk.data); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    chunks.push(bytes.buffer); offset = chunk.offset;
  }
  return new Blob(chunks, { type: item.mime });
}
export async function attachmentUrl(item: ChatAttachment, sessionId: string) {
  return urls.get(item.id) ?? cacheUrl(item.id, await attachmentBlob(item, sessionId));
}
export async function downloadAttachment(item: ChatAttachment, sessionId: string) {
  const url = URL.createObjectURL(await attachmentBlob(item, sessionId));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = item.name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
