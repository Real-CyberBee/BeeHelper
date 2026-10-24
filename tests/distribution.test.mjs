import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { installDistribution, uninstallDistribution, installationPaths } from "../connector/distribution.mjs";

test("原生分发安装、原子版本切换、失败保留与卸载仅影响自己的文件", { skip: process.platform !== "darwin" || !existsSync(".local/native/bin/beehelper") }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "bee-distribution-"));
  const source = path.join(temp, "安装包 'payload"), home = path.join(temp, "用户 home");
  try {
    await cp(".local/native", source, { recursive: true });
    await mkdir(path.join(source, "extension"));
    await writeFile(path.join(source, "extension/manifest.json"), JSON.stringify({ version: "0.5.0" }));
    await writeFile(path.join(source, "distribution.json"), JSON.stringify({ platform: "darwin", arch: process.arch, version: "0.5.0", engine: "system-javascriptcore" }));
    const options = { source, home };
    const first = await installDistribution(options), paths = installationPaths(home);
    assert.equal((JSON.parse(await readFile(paths.manifests[0]))).path, first.nativeHost);
    await access(first.nativeHost);
    await assert.rejects(access(path.join(paths.current, "runtime")));
    await assert.rejects(access(path.join(paths.current, "node_modules")));
    const firstRelease = await realpath(paths.current);
    await installDistribution(options);
    const repairedRelease = await realpath(paths.current);
    assert.notEqual(firstRelease, repairedRelease);
    await rm(path.join(source, "connector/mcp.js"));
    await assert.rejects(installDistribution(options));
    assert.equal(await realpath(paths.current), repairedRelease);
    await writeFile(paths.manifests[1], JSON.stringify({ path: "/another/connector" }));
    await mkdir(path.join(home, ".local/share/beehelper/workspace"), { recursive: true });
    await writeFile(path.join(home, ".local/share/beehelper/workspace/private.txt"), "keep");
    await uninstallDistribution({ home });
    await assert.rejects(access(paths.root)); await assert.rejects(access(paths.manifests[0]));
    assert.equal(JSON.parse(await readFile(paths.manifests[1])).path, "/another/connector");
    assert.equal(await readFile(path.join(home, ".local/share/beehelper/workspace/private.txt"), "utf8"), "keep");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
