import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNative } from "./build-native.mjs";

if (process.platform !== "darwin") throw new Error("请在 macOS 构建安装包；每种 CPU 架构使用对应开发环境构建");
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const output = path.join(root, ".local/installers");
const staging = path.join(output, `staging-${process.arch}`);
const app = path.join(staging, "BeeHelper Installer.app");
await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
execFileSync("osacompile", ["-o", app, path.join(root, "packaging/macos/installer.applescript")]);
const payload = path.join(app, "Contents/Resources/payload");
await buildNative(payload);
await cp(path.join(root, "dist"), path.join(payload, "extension"), { recursive: true });
await writeFile(path.join(payload, "distribution.json"), JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, engine: "system-javascriptcore", minimumMacOS: "13.0" }, null, 2));
const identity = process.env.BEEHELPER_SIGN_IDENTITY;
execFileSync("codesign", ["--force", "--options", "runtime", "--sign", identity || "-", path.join(payload, "bin/beehelper")]);
execFileSync("codesign", ["--force", "--options", "runtime", "--deep", "--sign", identity || "-", app]);
const name = `BeeHelper-${pkg.version}-macOS-${process.arch}`;
const dmg = path.join(output, `${name}.dmg`);
await rm(dmg, { force: true });
execFileSync("hdiutil", ["create", "-volname", "BeeHelper", "-srcfolder", staging, "-ov", "-format", "UDZO", dmg], { stdio: "inherit" });
if (process.env.BEEHELPER_NOTARY_PROFILE) {
  execFileSync("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", process.env.BEEHELPER_NOTARY_PROFILE, "--wait"], { stdio: "inherit" });
  execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
}
const archive = await readFile(dmg);
// 使用十进制 MB 门槛，避免实际下载体积超过用户预期。
if (archive.length > 5_000_000) throw new Error(`安装包超过 5 MB：${archive.length} bytes`);
const checksum = createHash("sha256").update(archive).digest("hex");
await writeFile(`${dmg}.sha256`, `${checksum}  ${path.basename(dmg)}\n`);
console.log(JSON.stringify({ file: dmg, sha256: checksum, bytes: archive.length, engine: "system-javascriptcore", signed: Boolean(identity), notarized: Boolean(process.env.BEEHELPER_NOTARY_PROFILE) }));
