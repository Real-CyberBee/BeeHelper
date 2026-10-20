export function encodeFrame(message) {
  const data = Buffer.from(JSON.stringify(message), "utf8");
  if (data.length > 1_000_000) throw new Error("消息超过本地通道限制");
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([size, data]);
}
export class FrameDecoder {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE();
      if (length > 64 * 1024 * 1024) throw new Error("非法消息长度");
      if (this.buffer.length < length + 4) break;
      messages.push(JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")));
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }
}
