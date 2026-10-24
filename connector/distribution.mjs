import { execFileSync } from "node:child_process";
import path from "node:path";

export const hostName = "io.beehelper.codex";
export const extensionId = "llkomjgjbldjelaemjcgphogaceejbpi";
export function installationPaths(home) {
  const root = path.join(home, "Library/Application Support/BeeHelper");
  return { root, host: path.join(root, "current/bin/beehelper"), current: path.join(root, "current"),
    manifests: ["Google/Chrome", "Google/ChromeForTesting", "Chromium"].map(browser => path.join(home, "Library/Application Support", browser, "NativeMessagingHosts", `${hostName}.json`)) };
}
// 开发工具只调用原生安装器，分发包本身不携带这些 Node 辅助函数。
export async function installDistribution({ source, home, platform = process.platform }) {
  if (platform !== "darwin" || process.platform !== "darwin") throw new Error("此图形安装包目前仅支持 macOS");
  return JSON.parse(execFileSync(path.join(source, "bin/beehelper"), ["--install", "--source", source, "--home", home], { encoding: "utf8" }));
}
export async function uninstallDistribution({ home, platform = process.platform }) {
  if (platform !== "darwin" || process.platform !== "darwin") throw new Error("此卸载器目前仅支持 macOS");
  execFileSync(installationPaths(home).host, ["--uninstall", "--home", home], { encoding: "utf8" });
}
