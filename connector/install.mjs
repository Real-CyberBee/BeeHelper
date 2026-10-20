import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "extension.manifest.json"), "utf8"));
const id = [...createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16)].flatMap(value => [value >> 4, value & 15]).map(value => String.fromCharCode(97 + value)).join("");
const local = path.join(root, ".local");
await mkdir(local, { recursive: true, mode: 0o700 });
const host = path.join(local, "native-host.sh");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
let codex = process.env.BEEHELPER_CODEX;
if (!codex) {
  try { codex = execFileSync("which", ["codex"], { encoding: "utf8" }).trim(); } catch { throw new Error("未找到 codex，请先安装 Codex CLI"); }
}
await writeFile(host, `#!/bin/sh\nexport BEEHELPER_CODEX=${quote(codex)}\nexec ${quote(process.execPath)} ${quote(path.join(root, "connector/host.mjs"))} "$@"\n`, { mode: 0o700 });
await chmod(host, 0o700);
let locations;
if (process.platform === "darwin") locations = ["Google/Chrome", "Google/Chrome for Testing", "Chromium"].map(browser => path.join(homedir(), "Library/Application Support", browser, "NativeMessagingHosts"));
else if (process.platform === "linux") locations = ["google-chrome", "chromium"].map(browser => path.join(homedir(), ".config", browser, "NativeMessagingHosts"));
else throw new Error("此首版本地安装器支持 macOS 和 Linux，Windows 安装尚未实现");
for (const directory of locations) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "io.beehelper.codex.json"), JSON.stringify({ name: "io.beehelper.codex", description: "BeeHelper Codex connector", path: host, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] }, null, 2), { mode: 0o600 });
}
console.log(JSON.stringify({ ok: true, extensionId: id, extensionDirectory: path.join(root, "dist"), nativeHost: host, registeredLocations: locations, codex }, null, 2));
