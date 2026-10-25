import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { access, chmod, cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!["linux", "win32"].includes(process.platform)) throw new Error("请在 Linux 或 Windows 构建便携包");
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await readFile(path.join(root, "package.json")));
const name = `BeeHelper-${pkg.version}-${process.platform === "win32" ? "Windows" : "Linux"}-${process.arch}`;
const output = path.join(root, ".local/installers"), stage = path.join(output, name);
await rm(stage, { recursive: true, force: true });
await mkdir(path.join(stage, "runtime"), { recursive: true });
await mkdir(path.join(stage, "connector"), { recursive: true });
await cp(path.join(root, "dist"), path.join(stage, "extension"), { recursive: true });
const node = process.platform === "win32" ? "node.exe" : "node";
await cp(process.execPath, path.join(stage, "runtime", node));
if (process.platform !== "win32") await chmod(path.join(stage, "runtime", node), 0o755);
const result = await build({ entryPoints: ["connector/host.mjs", "connector/mcp.mjs"], bundle: true, outdir: path.join(stage, "connector"), outExtension: { ".js": ".mjs" }, platform: "node", format: "esm", target: "node22", minify: true, metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  plugins: [{ name: "portable-root", setup(api) {
    api.onLoad({ filter: /connector[\\/]providers[\\/]registry\.mjs$/ }, async args => ({ contents: (await readFile(args.path, "utf8")).replace('new URL("../../", import.meta.url)', 'new URL("../", import.meta.url)'), resolveDir: path.dirname(args.path), loader: "js" }));
  } }]
});
await cp(path.join(root, "connector/portable-install.mjs"), path.join(stage, "connector/install.mjs"));
// 随包包含运行时及实际编入代码的许可证，不包含开发环境或个人配置。
const runtimeLicense = process.env.BEEHELPER_NODE_LICENSE;
if (!runtimeLicense) throw new Error("必须通过 BEEHELPER_NODE_LICENSE 指定对应 Node 运行时 LICENSE");
await access(runtimeLicense);
let notices = `BeeHelper portable preview includes Node.js ${process.version} (${process.platform}/${process.arch}).\n\n` + await readFile(runtimeLicense, "utf8");
const packages = new Set(Object.keys(result.metafile.inputs).filter(file => file.includes("node_modules/")).map(file => {
  const parts = file.slice(file.lastIndexOf("node_modules/") + 13).split("/"); return parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}));
for (const name of packages) {
  const dir = path.join(root, "node_modules", name), metadata = JSON.parse(await readFile(path.join(dir, "package.json")));
  const license = (await readdir(dir)).find(file => /^licen[cs]e(?:\..*)?$/i.test(file));
  if (!license) throw new Error(`未找到 ${name} 许可证`);
  notices += `\n--- ${name}@${metadata.version} ---\n` + await readFile(path.join(dir, license), "utf8");
}
await writeFile(path.join(stage, "THIRD_PARTY_NOTICES.txt"), notices);
await writeFile(path.join(stage, "distribution.json"), JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, engine: "bundled-node", nodeVersion: process.version }, null, 2));
await writeFile(path.join(stage, "README.txt"), `BeeHelper ${pkg.version} / ${process.platform}-${process.arch}\n\n${process.platform === "win32" ? "Extract ZIP, double click install.cmd. No administrator required. Windows .NET Framework 4.x is required by the launcher." : "Extract tar.gz, run ./install.sh as your normal user (no sudo). Requires glibc 2.28+ Linux."}\nLoad the printed extension directory in chrome://extensions/ (Developer mode). Enable Allow User Scripts.\nLocal AI Agents must be installed and signed in separately. Claude Code also needs claude-agent-acp.\nUninstall: ${process.platform === "win32" ? "uninstall.cmd" : "./uninstall.sh"}. Browser extension must be removed separately. Old version directories and user data are retained.\nDocs: https://real-cyberbee.github.io/BeeHelper/docs/install.html\nPreview: unsigned; Windows SmartScreen may block the launcher. No automatic background runtime download.\n`);
if (process.platform === "win32") {
  const compiler = path.join(process.env.WINDIR, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  execFileSync(compiler, ["/nologo", "/target:exe", `/out:${path.join(stage, "beehelper.exe")}`, path.join(root, "packaging/windows/Launcher.cs")], { stdio: "inherit" });
  for (const [file, args] of [["install", ""], ["uninstall", " --uninstall"]]) await writeFile(path.join(stage, `${file}.cmd`), `@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0connector\\install.mjs"${args}\r\nif errorlevel 1 (pause & exit /b 1)\r\npause\r\n`);
} else {
  await writeFile(path.join(stage, "beehelper"), '#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/runtime/node" "$ROOT/connector/host.mjs" "$@"\n');
  await chmod(path.join(stage, "beehelper"), 0o755);
  for (const [file, args] of [["install", ""], ["uninstall", " --uninstall"]]) {
    await writeFile(path.join(stage, `${file}.sh`), `#!/bin/sh\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$ROOT/runtime/node" "$ROOT/connector/install.mjs"${args}\n`);
    await chmod(path.join(stage, `${file}.sh`), 0o755);
  }
}
const archive = `${stage}.${process.platform === "win32" ? "zip" : "tar.gz"}`;
await rm(archive, { force: true });
if (process.platform === "win32") {
  // 通过环境传路径，避免 PowerShell 字符串插值改变空格和特殊字符。
  execFileSync("powershell.exe", ["-NoProfile", "-Command", 'Compress-Archive -LiteralPath $env:BEEHELPER_STAGE -DestinationPath $env:BEEHELPER_ARCHIVE -Force'], { env: { ...process.env, BEEHELPER_STAGE: stage, BEEHELPER_ARCHIVE: archive }, stdio: "inherit" });
} else execFileSync("tar", ["-czf", archive, "-C", output, name], { stdio: "inherit" });
const bytes = await readFile(archive), sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${archive}.sha256`, `${sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ file: archive, bytes: bytes.length, sha256, stage }));
