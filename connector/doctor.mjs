import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeFrame, FrameDecoder } from "./framing.mjs";
const host = fileURLToPath(new URL("./host.mjs", import.meta.url));
console.log(execFileSync(process.env.BEEHELPER_CODEX || "codex", ["--version"], { encoding: "utf8" }).trim());
const child = spawn(process.execPath, [host], { stdio: ["pipe", "pipe", "inherit"] });
const decoder = new FrameDecoder();
const timeout = setTimeout(() => { console.error("FAIL: 连接器诊断超时"); child.kill("SIGTERM"); process.exitCode = 1; }, 60_000);
child.stdout.on("data", chunk => {
  for (const message of decoder.push(chunk)) if (message.kind === "reply" && message.id === "doctor") {
    console.log(JSON.stringify(message, null, 2));
    clearTimeout(timeout); child.stdin.end();
    if (message.error || !message.result?.authenticated) process.exitCode = 1;
  }
});
child.stdin.write(encodeFrame({ kind: "rpc", id: "doctor", method: "status" }));
