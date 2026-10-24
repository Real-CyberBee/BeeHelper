import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { installDistribution, uninstallDistribution } from "../../connector/distribution.mjs";
const source = fileURLToPath(new URL("../../", import.meta.url));
if (process.argv.includes("--uninstall")) {
  await uninstallDistribution({ home: homedir() });
  console.log("BeeHelper 连接器已卸载。浏览器中的微应用与会话仍保留。");
} else {
  const result = await installDistribution({ source, home: homedir() });
  console.log(process.argv.includes("--gui") ? result.extension : JSON.stringify({ ok: true, ...result }));
}
