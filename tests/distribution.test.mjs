import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { installDistribution, uninstallDistribution, installationPaths } from "../connector/distribution.mjs";

test("图形分发安装、原子版本切换、失败保留与卸载仅影响自己的文件", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "bee-distribution-"));
  const source = path.join(temp, "安装包 'payload"), home = path.join(temp, "用户 home");
  try {
    for (const dir of ["runtime", "connector", "shared", "node_modules/cordis", "extension", "packaging"]) await mkdir(path.join(source, dir), { recursive: true });
    for (const file of ["runtime/node", "connector/host.mjs", "connector/mcp.mjs", "package.json", "node_modules/cordis/package.json"]) await writeFile(path.join(source, file), "{}");
    await writeFile(path.join(source, "extension/manifest.json"), JSON.stringify({ version: "0.4.0" }));
    await writeFile(path.join(source, "distribution.json"), JSON.stringify({ platform: "darwin", arch: process.arch, version: "0.4.0" }));
    const options = { source, home, platform: "darwin" };
    const first = await installDistribution(options), paths = installationPaths(home);
    assert.equal((JSON.parse(await readFile(paths.manifests[0]))).path, first.nativeHost);
    assert.match(await readFile(paths.host, "utf8"), /current\/runtime\/node/);
    assert.doesNotMatch(await readFile(paths.host, "utf8"), /payload/);
    const firstRelease = await realpath(paths.current);
    await installDistribution(options);
    const repairedRelease = await realpath(paths.current);
    assert.notEqual(firstRelease, repairedRelease);
    await rm(path.join(source, "packaging"), { recursive: true });
    await assert.rejects(installDistribution(options));
    assert.equal(await realpath(paths.current), repairedRelease);
    // 其他安装方式接管的清单及用户业务数据必须保留。
    await writeFile(paths.manifests[1], JSON.stringify({ path: "/another/connector" }));
    await mkdir(path.join(home, ".local/share/beehelper/workspace"), { recursive: true });
    await writeFile(path.join(home, ".local/share/beehelper/workspace/private.txt"), "keep");
    await uninstallDistribution({ home, platform: "darwin" });
    await assert.rejects(access(paths.root));
    await assert.rejects(access(paths.manifests[0]));
    assert.equal(JSON.parse(await readFile(paths.manifests[1])).path, "/another/connector");
    assert.equal(await readFile(path.join(home, ".local/share/beehelper/workspace/private.txt"), "utf8"), "keep");
  } finally { await rm(temp, { recursive: true, force: true }); }
});
