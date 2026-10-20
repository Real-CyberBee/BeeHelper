import { build } from "esbuild";
import { copyFile, readFile, writeFile } from "node:fs/promises";
await build({ entryPoints: { background: "src/background.ts", content: "src/content.ts" }, bundle: true, outdir: "dist", format: "esm", target: "chrome138", platform: "browser" });
await build({ entryPoints: ["src/sandbox.ts"], bundle: true, outfile: "dist/sandbox-runtime.js", format: "iife", target: "chrome138", platform: "browser" });
const sandbox = await readFile("sandbox.html", "utf8");
await writeFile("dist/sandbox.html", sandbox.replace('<script type="module" src="/src/sandbox.ts"></script>', '<script src="sandbox-runtime.js"></script>'));
await copyFile("extension.manifest.json", "dist/manifest.json");
console.log("扩展已构建：dist/");
