import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("请在 macOS 构建安装包；每种 CPU 架构使用对应 Node 构建");
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const output = path.join(root, ".local/installers");
const staging = path.join(output, `staging-${process.arch}`);
const app = path.join(staging, "BeeHelper Installer.app");
await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
execFileSync("osacompile", ["-o", app, path.join(root, "packaging/macos/installer.applescript")]);
const payload = path.join(app, "Contents/Resources/payload");
await mkdir(path.join(payload, "runtime"), { recursive: true });
for (const item of ["connector", "shared", "packaging", "package.json", "package-lock.json"]) await cp(path.join(root, item), path.join(payload, item), { recursive: true });
await cp(process.execPath, path.join(payload, "runtime/node"));
await cp(path.join(root, "dist"), path.join(payload, "extension"), { recursive: true });
// 只安装锁文件中的生产依赖，不复制开发目录或用户配置。
execFileSync("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: payload, stdio: "inherit" });
await writeFile(path.join(payload, "distribution.json"), JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, runtime: process.version }, null, 2));
// 安装器脚本也复制到正式版本，供修复与诊断使用。
const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error("未能取得 bundled Node 的许可证，停止打包");
await writeFile(path.join(payload, "runtime/LICENSE"), await response.text());
const identity = process.env.BEEHELPER_SIGN_IDENTITY;
execFileSync("codesign", ["--force", "--options", "runtime", "--entitlements", path.join(root, "packaging/macos/entitlements.plist"), "--sign", identity || "-", path.join(payload, "runtime/node")]);
execFileSync("codesign", ["--force", "--options", "runtime", "--deep", "--sign", identity || "-", app]);
const name = `BeeHelper-${pkg.version}-macOS-${process.arch}`;
const dmg = path.join(output, `${name}.dmg`);
await rm(dmg, { force: true });
execFileSync("hdiutil", ["create", "-volname", "BeeHelper", "-srcfolder", staging, "-ov", "-format", "UDZO", dmg], { stdio: "inherit" });
if (process.env.BEEHELPER_NOTARY_PROFILE) {
  execFileSync("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", process.env.BEEHELPER_NOTARY_PROFILE, "--wait"], { stdio: "inherit" });
  execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
}
const checksum = createHash("sha256").update(await readFile(dmg)).digest("hex");
await writeFile(`${dmg}.sha256`, `${checksum}  ${path.basename(dmg)}\n`);
console.log(JSON.stringify({ file: dmg, sha256: checksum, signed: Boolean(identity), notarized: Boolean(process.env.BEEHELPER_NOTARY_PROFILE) }));
