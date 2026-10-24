import { cp, mkdir, readFile, writeFile, chmod, symlink, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const hostName = "io.beehelper.codex";
export const extensionId = "llkomjgjbldjelaemjcgphogaceejbpi";
export const quoteShell = value => "'" + value.replaceAll("'", "'\\''") + "'";
export function installationPaths(home) {
  const root = path.join(home, "Library/Application Support/BeeHelper");
  return { root, host: path.join(root, "native-host.sh"), current: path.join(root, "current"),
    manifests: ["Google/Chrome", "Google/ChromeForTesting", "Chromium"].map(browser => path.join(home, "Library/Application Support", browser, "NativeMessagingHosts", `${hostName}.json`)) };
}

/** 仅切换已完整复制的版本；不依赖源码目录、系统 Node 或管理员权限。 */
export async function installDistribution({ source, home, platform = process.platform }) {
  if (platform !== "darwin") throw new Error("此图形安装包目前仅支持 macOS");
  const paths = installationPaths(home);
  const metadata = JSON.parse(await readFile(path.join(source, "distribution.json"), "utf8"));
  if (metadata.platform !== platform || metadata.arch !== process.arch) throw new Error("安装包与当前系统或 CPU 架构不匹配");
  for (const file of ["runtime/node", "connector/host.mjs", "connector/mcp.mjs", "node_modules/cordis/package.json", "extension/manifest.json"]) await readFile(path.join(source, file));
  const manifest = JSON.parse(await readFile(path.join(source, "extension/manifest.json"), "utf8"));
  if (manifest.version !== metadata.version) throw new Error("扩展与连接器版本不一致");
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const release = path.join(paths.root, "releases", `${metadata.version}-${randomUUID()}`);
  await mkdir(release, { recursive: true, mode: 0o700 });
  try {
    for (const item of ["runtime", "connector", "shared", "node_modules", "extension", "packaging", "package.json", "distribution.json"]) await cp(path.join(source, item), path.join(release, item), { recursive: true, dereference: true });
    await chmod(path.join(release, "runtime/node"), 0o700);
    const temporary = path.join(paths.root, `current-${randomUUID()}`);
    await symlink(release, temporary);
    await rename(temporary, paths.current);
  } catch (error) { await rm(release, { recursive: true, force: true }); throw error; }
  const runtime = path.join(paths.current, "runtime");
  await writeFile(paths.host, `#!/bin/sh\nexport PATH=${quoteShell(runtime)}:"$PATH":/opt/homebrew/bin:/usr/local/bin\nexec ${quoteShell(path.join(runtime, "node"))} ${quoteShell(path.join(paths.current, "connector/host.mjs"))} "$@"\n`, { mode: 0o700 });
  await chmod(paths.host, 0o700);
  for (const file of paths.manifests) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ name: hostName, description: "BeeHelper local agent connector", path: paths.host, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2), { mode: 0o600 });
  }
  return { version: metadata.version, extension: path.join(paths.current, "extension"), nativeHost: paths.host };
}

/** 只删除仍指向本安装器的清单；不删除浏览器库、Agent 登录或工作目录。 */
export async function uninstallDistribution({ home, platform = process.platform }) {
  if (platform !== "darwin") throw new Error("此卸载器目前仅支持 macOS");
  const paths = installationPaths(home);
  for (const file of paths.manifests) {
    try { if (JSON.parse(await readFile(file, "utf8")).path === paths.host) await rm(file); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await rm(paths.root, { recursive: true, force: true });
}
