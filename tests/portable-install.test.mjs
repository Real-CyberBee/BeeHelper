import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { portablePaths, installPortable } from "../connector/portable-install.mjs";

test("便携安装路径按用户隔离，Windows 不使用 Unix 清单目录", () => {
  const home = path.join(path.sep, "users", "测试用户");
  const linux = portablePaths({ home, platform: "linux" });
  assert.equal(linux.root, path.join(home, ".local/share/BeeHelper"));
  assert.equal(linux.manifests.length, 3);
  assert.ok(linux.manifests.some(file => file.includes("google-chrome-for-testing")));
  const localAppData = path.join(home, "LocalData");
  const windows = portablePaths({ home, platform: "win32", localAppData });
  assert.equal(windows.root, path.join(localAppData, "BeeHelper"));
  assert.equal(windows.manifests.length, 1);
  assert.throws(() => portablePaths({ home, platform: "darwin" }), /仅支持/);
});

test("安装拒绝错误系统，避免运行异平台归档", async () => {
  await assert.rejects(installPortable({ source: "/missing", platform: process.platform === "win32" ? "linux" : "win32" }), /目标系统/);
});
