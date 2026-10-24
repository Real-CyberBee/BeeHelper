import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { tools } from "../connector/tools.mjs";

export async function buildNative(output) {
  if (process.platform !== "darwin") throw new Error("原生连接器目前只在 macOS 构建");
  const root = fileURLToPath(new URL("../", import.meta.url));
  await mkdir(path.join(output, "bin"), { recursive: true });
  await mkdir(path.join(output, "connector"), { recursive: true });
  const native = path.join(root, "connector/native");
  execFileSync("swiftc", ["-Osize", "-whole-module-optimization", "-target", `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos13.0`, ...["Bridge.swift", "Installer.swift", "main.swift"].map(file => path.join(native, file)), "-o", path.join(output, "bin/beehelper")], { stdio: "inherit" });
  execFileSync("strip", ["-x", path.join(output, "bin/beehelper")]);
  const libraries = execFileSync("otool", ["-L", path.join(output, "bin/beehelper")], { encoding: "utf8" }).split("\n").slice(1).map(line => line.trim().split(" ")[0]).filter(Boolean);
  if (libraries.some(file => !file.startsWith("/usr/lib/") && !file.startsWith("/System/Library/"))) throw new Error("原生程序依赖非系统动态库，停止分发");
  const shim = path.join(native, "platform.mjs");
  const schemas = Object.fromEntries(tools.map(([name, , shape]) => [name, zodToJsonSchema(z.object(shape))]));
  const inputs = new Set();
  for (const mode of ["host", "mcp"]) {
    const result = await build({ stdin: { contents: `import ${JSON.stringify(shim)}; import ${JSON.stringify(mode === "host" ? path.join(root, "connector/host.mjs") : path.join(native, "mcp.mjs"))};`, resolveDir: root }, bundle: true, format: "esm", platform: "neutral", target: "es2022", minify: true, write: false, metafile: true,
      plugins: [{ name: "system-javascriptcore", setup(api) {
        api.onResolve({ filter: /^node:/ }, args => ({ path: args.path, namespace: "native" }));
        api.onLoad({ filter: /.*/, namespace: "native" }, args => ({ contents: `export * from ${JSON.stringify(shim)}; export {path as default} from ${JSON.stringify(shim)};`, resolveDir: root }));
        api.onResolve({ filter: /^bee:tool-schemas$/ }, () => ({ path: "tool-schemas", namespace: "generated" }));
        api.onLoad({ filter: /.*/, namespace: "generated" }, () => ({ contents: `export const toolSchemas=${JSON.stringify(schemas)};` }));
        api.onLoad({ filter: /connector\/(?:host|providers\/registry)\.mjs$/ }, async args => {
          let source = await readFile(args.path, "utf8");
          const relative = path.relative(root, args.path);
          source = source.replaceAll("import.meta.url", `globalThis.__beeFileURL(globalThis.__beeRoot+${JSON.stringify("/"+relative)})`);
          return { contents: source, resolveDir: path.dirname(args.path), loader: "js" };
        });
      } }] });
    for (const input of Object.keys(result.metafile.inputs)) inputs.add(input);
    await writeFile(path.join(output, `connector/${mode}.js`), `(async()=>{${result.outputFiles[0].text}\n})().catch(error=>{console.error(String(error));process.exit(1)});`);
  }
  // 随包保留实际编入代码的许可证，不携带 SDK 目录或开发依赖。
  const packages = new Set([...inputs].filter(file => file.includes("node_modules/")).map(file => {
    const rest = file.slice(file.lastIndexOf("node_modules/")+13).split("/"); return rest[0].startsWith("@") ? rest.slice(0,2).join("/") : rest[0];
  }));
  let notices = "BeeHelper uses macOS Foundation, CryptoKit and JavaScriptCore system frameworks. No Node runtime is bundled.\n";
  for (const name of packages) {
    const directory = path.join(root, "node_modules", name);
    const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const license = (await readdir(directory)).find(file => /^licen[cs]e(?:\..*)?$/i.test(file));
    if (!license) throw new Error(`未找到 ${name} 许可证，停止分发`);
    notices += `\n--- ${name}@${metadata.version} ---\n`+await readFile(path.join(directory, license), "utf8")+"\n";
  }
  await writeFile(path.join(output, "THIRD_PARTY_NOTICES.txt"), notices);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildNative(process.argv[2] ?? ".local/native");
