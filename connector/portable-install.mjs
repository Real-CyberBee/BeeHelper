import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const hostName = "io.beehelper.codex";
export const extensionId = "llkomjgjbldjelaemjcgphogaceejbpi";
const registryKeys = ["Google\\Chrome", "Chromium"].map(browser => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${hostName}`);
export function portablePaths({ home = homedir(), platform = process.platform, localAppData = process.env.LOCALAPPDATA } = {}) {
  if (!["linux", "win32"].includes(platform)) throw new Error("便携安装包仅支持 Linux / Windows");
  const root = platform === "win32" ? path.join(localAppData || path.join(home, "AppData/Local"), "BeeHelper") : path.join(home, ".local/share/BeeHelper");
  return { root, record: path.join(root, "installation.json"), manifests: platform === "win32" ? [path.join(root, `${hostName}.json`)]
    : ["google-chrome", "google-chrome-for-testing", "chromium"].map(browser => path.join(home, ".config", browser, "NativeMessagingHosts", `${hostName}.json`)) };
}
const reg = args => execFileSync("reg.exe", args, { encoding: "utf8", windowsHide: true });
function registryValue(key) {
  try { return reg(["query", key, "/ve"]).match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim(); } catch { return undefined; }
}
async function snapshot(file) { try { return await readFile(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
async function restore(file, data) { if (data === undefined) await rm(file, { force: true }); else await writeFile(file, data); }

export async function installPortable({ source, home = homedir(), platform = process.platform, localAppData = process.env.LOCALAPPDATA } = {}) {
  if (platform !== process.platform) throw new Error("必须在目标系统执行安装");
  const paths = portablePaths({ home, platform, localAppData });
  const metadata = JSON.parse(await readFile(path.join(source, "distribution.json"), "utf8"));
  if (metadata.platform !== platform || metadata.arch !== process.arch || !/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error("安装包系统、架构或版本不匹配");
  const executable = platform === "win32" ? "beehelper.exe" : "beehelper";
  for (const file of [executable, "extension/manifest.json", "connector/host.mjs", "connector/mcp.mjs", "THIRD_PARTY_NOTICES.txt", platform === "win32" ? "runtime/node.exe" : "runtime/node"]) await access(path.join(source, file));
  if (JSON.parse(await readFile(path.join(source, "extension/manifest.json"))).version !== metadata.version) throw new Error("扩展与连接器版本不一致");
  const release = path.join(paths.root, "releases", `${metadata.version}-${randomUUID()}`);
  const backups = new Map(); const previousRegistry = new Map();
  try {
    await mkdir(path.dirname(release), { recursive: true });
    await cp(source, release, { recursive: true });
    const nativeHost = path.join(release, executable);
    const manifest = JSON.stringify({ name: hostName, description: "BeeHelper local agent connector", path: nativeHost, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2);
    for (const file of paths.manifests) {
      backups.set(file, await snapshot(file));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, manifest, { mode: 0o600 });
    }
    if (platform === "win32") for (const key of registryKeys) {
      previousRegistry.set(key, registryValue(key));
      reg(["add", key, "/ve", "/t", "REG_SZ", "/d", paths.manifests[0], "/f"]);
    }
    // 安装登记最后写入；升级保留旧版本，不删除运行中的扩展文件。
    const result = { version: metadata.version, platform, arch: metadata.arch, release, nativeHost, extensionDirectory: path.join(release, "extension"), manifests: paths.manifests };
    const temporary = `${paths.record}.tmp-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify(result, null, 2), { mode: 0o600 });
    await rename(temporary, paths.record);
    return result;
  } catch (error) {
    for (const [file, data] of backups) await restore(file, data);
    for (const [key, value] of previousRegistry) {
      if (value === undefined) { try { reg(["delete", key, "/ve", "/f"]); } catch {} }
      else reg(["add", key, "/ve", "/t", "REG_SZ", "/d", value, "/f"]);
    }
    await rm(release, { recursive: true, force: true });
    throw error;
  }
}
export async function uninstallPortable(options = {}) {
  const platform = options.platform ?? process.platform, paths = portablePaths(options);
  const record = JSON.parse(await readFile(paths.record, "utf8"));
  if (record.platform !== platform) throw new Error("安装登记系统不匹配");
  // 只移除仍指向本安装根目录的登记，避免覆盖其他连接器。
  for (const file of paths.manifests) {
    const data = await snapshot(file);
    if (data) {
      const manifest = JSON.parse(data.toString());
      const relative = path.relative(path.join(paths.root, "releases"), manifest.path);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) await rm(file);
    }
  }
  if (platform === "win32") for (const key of registryKeys) if (registryValue(key) === paths.manifests[0]) reg(["delete", key, "/ve", "/f"]);
  // 版本目录保留供浏览器仍加载的扩展使用；不触碰 workspace、会话或 Agent 登录。
  await rm(paths.record);
  return { ok: true, extensionDirectory: record.extensionDirectory, retainedReleases: path.join(paths.root, "releases") };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const result = process.argv.includes("--uninstall") ? await uninstallPortable() : await installPortable({ source });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    if (result.extensionDirectory) console.log(`\nChrome 扩展目录 / Extension directory:\n${result.extensionDirectory}\n`);
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
