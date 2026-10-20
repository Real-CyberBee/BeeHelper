import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { encodeFrame, FrameDecoder } from "./framing.mjs";
const host = fileURLToPath(new URL("./host.mjs", import.meta.url));
const providerId = process.argv[process.argv.indexOf("--agent") + 1] && process.argv.includes("--agent") ? process.argv[process.argv.indexOf("--agent") + 1] : "codex";
const child = spawn(process.execPath, [host], { stdio: ["pipe", "pipe", "inherit"] });
const decoder = new FrameDecoder();
let info, selected, checkResult, finished = false;
const scope = { sessionId: "doctor", connectionId: "doctor", providerId };
const call = (id, method, params) => child.stdin.write(encodeFrame({ kind: "rpc", id, method, params }));
const timeout = setTimeout(() => { console.error("FAIL: 连接器诊断超时"); child.kill("SIGTERM"); process.exitCode = 1; }, 60_000);
function finish(error) {
  if (finished) return;
  finished = true;
  console.log(JSON.stringify({ ok: !error, providerId, error, version: info?.version, authenticated: info?.authenticated, modelCount: info?.models?.length, commandCount: info?.commands?.length, skillCount: info?.skills?.length, configCount: info?.configOptions?.length, capabilities: info?.capabilities, modelCheck: checkResult }, null, 2));
  clearTimeout(timeout); child.stdin.end();
  if (error || info?.authenticated === false) process.exitCode = 1;
}
child.stdout.on("data", chunk => {
  for (const message of decoder.push(chunk)) if (message.kind === "reply") {
    if (message.error) { finish(message.error); continue; }
    if (message.id === "doctor") {
      info = message.result;
      if (process.argv.includes("--check-model") && info.models?.length > 1) {
        selected = info.models.find(model => model.id !== info.appliedModel).id;
        call("model-check", "setModel", { ...scope, model: selected });
      } else finish();
    } else if (message.id === "model-check") {
      checkResult = message.result?.nextTurn ? "accepted-for-next-turn" : message.result?.appliedModel === selected ? "confirmed" : "unconfirmed";
      if (checkResult === "unconfirmed") { finish("后端未确认模型配置"); continue; }
      if (info.appliedModel && message.result.models?.some(model => model.id === info.appliedModel)) call("model-restore", "setModel", { ...scope, model: info.appliedModel });
      else finish();
    } else if (message.id === "model-restore") finish();
  }
});
child.on("exit", code => { clearTimeout(timeout); if (code || !finished) process.exitCode = 1; });
call("doctor", "connect", scope);
