/* JavaScriptCore 的最小宿主接口，仅覆盖连接器使用的能力；不是通用 Node 运行时。 */
export function native(method, args = {}) {
  const reply = JSON.parse(globalThis.__beeNative(JSON.stringify({ method, ...args })));
  if (!reply.ok) { const error = new Error(reply.error); error.code = reply.code; throw error; }
  return reply.data;
}
globalThis.__beeFileURL = file => native("fileURL", { file });
class Events {
  listeners = new Map();
  on(name, callback) { const list = this.listeners.get(name) ?? []; list.push(callback); this.listeners.set(name, list); return this; }
  once(name, callback) { const once = (...args) => { this.removeListener(name, once); callback(...args); }; return this.on(name, once); }
  removeListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== callback)); return this; }
  emit(name, ...args) { for (const callback of [...(this.listeners.get(name) ?? [])]) callback(...args); }
  setEncoding() { return this; }
  resume() { return this; }
}
export class Bytes extends Uint8Array {
  static from(value, encoding = "utf8") { return new Bytes(typeof value === "string" ? native("encode", { value, encoding }) : value); }
  static alloc(length) { return new Bytes(length); }
  static concat(chunks) { const result = new Bytes(chunks.reduce((size, item) => size + item.length, 0)); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } return result; }
  static byteLength(value) { return typeof value === "string" ? Bytes.from(value).length : value.length; }
  toString(encoding = "utf8") { return native("decode", { bytes: [...this], encoding }); }
  equals(other) { return this.length === other.length && this.every((value, index) => value === other[index]); }
  readUInt32LE(offset = 0) { return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, true); }
  writeUInt32LE(value, offset = 0) { new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(offset, value, true); }
}
const handles = new Map(), timers = new Map();
let nextId = 1;
function register(object) { const id = nextId++; handles.set(id, object); return id; }
globalThis.__beeEvent = (id, type, data) => {
  if (id === "process") { if (process.listeners.get(type)?.length) process.emit(type); else process.exit(0); return; }
  if (id === "stdin") { process.stdin.emit(type, type === "data" ? Bytes.from(data, "base64") : data); return; }
  if (type === "timer") { const callback = timers.get(id); timers.delete(id); callback?.(); return; }
  const object = handles.get(id);
  if (!object) return;
  if (type === "connection") { const socket = new Socket(data); handles.set(data, socket); object.emit("connection", socket); }
  else if (type === "stdout" || type === "stderr") object[type].emit("data", data);
  else object.emit(type, data);
  if (type === "close" || type === "exit") handles.delete(id);
};
globalThis.Buffer = Bytes;
globalThis.console = { log: (...args) => native("stderr", { text: args.join(" ")+"\n" }), error: (...args) => native("stderr", { text: args.join(" ")+"\n" }), warn: (...args) => native("stderr", { text: args.join(" ")+"\n" }) };
globalThis.setTimeout = (callback, delay = 0) => { const id = nextId++; timers.set(id, callback); native("timer", { id, delay }); return { id, unref() { return this; } }; };
globalThis.clearTimeout = timer => { if (timer) { timers.delete(timer.id); native("clearTimer", { id: timer.id }); } };
globalThis.TextDecoder = class {
  constructor(_encoding, options) { this.fatal = options?.fatal === true; this.pending = Bytes.alloc(0); }
  decode(bytes = Bytes.alloc(0), options = {}) {
    const data = Bytes.concat([this.pending, bytes]); let end = data.length;
    if (options.stream && end) {
      let start = end-1;
      while (start >= 0 && (data[start]&0xc0) === 0x80) start--;
      if (start >= 0) { const first = data[start]; const length = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4; if (end-start < length) end = start; }
    }
    this.pending = data.subarray(end);
    return native("decode", { bytes: [...data.subarray(0,end)], encoding: "utf8", fatal: this.fatal });
  }
};
globalThis.TextEncoder = class { encode(text) { return Bytes.from(text); } };
globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
const info = native("info");
globalThis.process = Object.assign(new Events(), info, { stdin: new Events(), stdout: { write: data => native("stdout", { bytes: [...Bytes.from(data)] }) }, exit: code => native("exit", { code }), cwd: () => info.cwd });
globalThis.URL = class { constructor(value, base) { Object.assign(this, native("url", { value: String(value), ...(base ? { base: String(base) } : {}) })); } toString() { return this.href; } };

export const path = {
  delimiter: ":", sep: "/", isAbsolute: value => value.startsWith("/"),
  normalize(value) { const absolute = value.startsWith("/"); const parts = []; for (const part of value.split("/")) { if (!part || part === ".") continue; if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop(); else if (part === ".." && !absolute) parts.push(part); else if (part !== "..") parts.push(part); } return (absolute ? "/" : "")+parts.join("/") || "."; },
  join: (...parts) => path.normalize(parts.join("/")),
  resolve: (...parts) => { let value = ""; for (const part of parts) value = path.isAbsolute(part) ? part : value+"/"+part; return path.normalize(value); },
  dirname: value => value.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/",
  basename: value => value.replace(/\/+$/, "").split("/").at(-1),
  extname: value => { const name = path.basename(value); const index = name.lastIndexOf("."); return index > 0 ? name.slice(index) : ""; }
};
export const homedir = () => info.home, tmpdir = () => info.tmp;
export const fileURLToPath = value => native("filePath", { value: String(value) });
export const pathToFileURL = value => ({ href: native("fileURL", { file: value }) });
export const randomUUID = () => native("uuid");
export const randomBytes = length => Bytes.from(native("random", { length }));
export const timingSafeEqual = (a, b) => native("equal", { a: [...a], b: [...b] });
export function createHash(algorithm) { const id = native("hashStart", { algorithm }); return { update(bytes) { native("hashUpdate", { id, bytes: [...Bytes.from(bytes)] }); return this; }, digest(encoding) { const bytes = Bytes.from(native("hashEnd", { id })); return encoding ? bytes.toString(encoding) : bytes; } }; }
export const constants = { F_OK: 0 };
export const access = async file => native("access", { file });
export const readdir = async file => native("readdir", { file });
export const realpath = async file => native("realpath", { file });
export const mkdir = async (file, options = {}) => native("mkdir", { file, ...options });
export const mkdtemp = async prefix => native("mkdtemp", { prefix });
export const chmod = async (file, mode) => native("chmod", { file, mode });
export const rename = async (file, target) => native("rename", { file, target });
export const rm = async (file, options = {}) => native("rm", { file, ...options });
export const readFile = async (file, encoding) => { const bytes = Bytes.from(native("readFile", { file })); return encoding ? bytes.toString(encoding) : bytes; };
export const stat = async file => { const result = native("stat", { file }); return { size: result.size, isFile: () => result.file }; };
export function createReadStream(file) { return { async *[Symbol.asyncIterator]() { const handle = await open(file, "r"); try { let offset = 0; while (true) { const bytes = Bytes.alloc(65536); const result = await handle.read(bytes, 0, bytes.length, offset); if (!result.bytesRead) break; yield bytes.subarray(0, result.bytesRead); offset += result.bytesRead; } } finally { await handle.close(); } } }; }
export async function open(file, flags, mode = 0o600) {
  const fd = native("fileOpen", { file, flags, mode });
  return {
    async read(buffer, offset, length, position) { const bytes = native("fileRead", { fd, length, position }); buffer.set(bytes, offset); return { bytesRead: bytes.length }; },
    async write(buffer, offset, length, position) { return { bytesWritten: native("fileWrite", { fd, bytes: [...buffer.subarray(offset, offset+length)], position }) }; },
    async writeFile(text) { const bytes = Bytes.from(text); let offset = 0; while (offset < bytes.length) { const count = native("fileWrite", { fd, bytes: [...bytes.subarray(offset)], position: offset }); if (!count) throw new Error("文件写入中断"); offset += count; } },
    async sync() { native("fileSync", { fd }); }, async close() { native("fileClose", { fd }); }
  };
}
export function spawn(command, args = [], options = {}) {
  const child = new Events(); child.stdout = new Events(); child.stderr = new Events();
  const id = register(child);
  child.stdin = Object.assign(new Events(), { write: text => native("childWrite", { id, text }), end: () => native("childEnd", { id }) });
  child.kill = signal => native("childKill", { id, signal });
  try { native("spawn", { id, command, args, cwd: options.cwd, env: options.env }); }
  catch (error) { setTimeout(() => child.emit("error", error)); }
  return child;
}
export function execFileSync(command, args, options = {}) { return native("execSync", { command, args, ...options }); }
class Socket extends Events {
  constructor(id) { super(); this.id = id ?? register(this); }
  write(text) { native("socketWrite", { id: this.id, text }); }
  end(text) { if (text !== undefined) this.write(text); native("socketEnd", { id: this.id }); }
  destroy(error) { if (error) this.emit("error", error); native("socketEnd", { id: this.id }); }
  setTimeout(delay, callback) { this.timer = setTimeout(callback, delay); this.once("close", () => clearTimeout(this.timer)); return this; }
}
export function createServer(callback) {
  const server = new Events(); const id = register(server); server.on("connection", callback);
  server.listen = (file, callback) => { native("listen", { id, file }); callback(); };
  server.close = () => { native("serverClose", { id }); handles.delete(id); };
  return server;
}
export function connect(file) { const socket = new Socket(); native("connect", { id: socket.id, file }); return socket; }
