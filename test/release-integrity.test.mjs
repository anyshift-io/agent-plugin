import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readPackageMetadata,
  verifyInternalConsistency,
  verifyReleaseTag,
} from "../scripts/lib/package-metadata.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const valid = {
  portableName: "agent-plugin",
  portableVersion: "0.2.0",
  codexName: "agent-plugin",
  codexVersion: "0.2.0",
  packageName: "agent-plugin",
  packageVersion: "0.2.0",
  lockName: "agent-plugin",
  lockVersion: "0.2.0",
  lockRootName: "agent-plugin",
  lockRootVersion: "0.2.0",
  mcpServerName: "agent-plugin",
  attributionName: "agent-plugin",
  attributionVersion: "0.2.0",
  marketplaceName: "agent-plugin",
  readmeStableRef: "v0.2.0",
};

test("current package metadata normalizes every release surface", async () => {
  assert.deepEqual(await readPackageMetadata(root), valid);
});

test("v0.2.0 matches the complete package", () => {
  assert.doesNotThrow(() => verifyReleaseTag(valid, "v0.2.0"));
});

test("a future tag is rejected before manifests are bumped", () => {
  assert.throws(() => verifyReleaseTag(valid, "v0.2.1"), /tag v0\.2\.1.*portableVersion 0\.2\.0/i);
});

test("release tags require the v-prefixed strict semver format", () => {
  assert.throws(() => verifyReleaseTag(valid, "0.2.0"), /strict v-prefixed semver/);
  assert.throws(() => verifyReleaseTag(valid, "vnext"), /strict v-prefixed semver/);
});

for (const field of [
  "codexName",
  "packageName",
  "lockName",
  "lockRootName",
  "mcpServerName",
  "attributionName",
  "marketplaceName",
]) {
  test(`${field} mismatch fails`, () => {
    const metadata = structuredClone(valid);
    metadata[field] = "wrong";
    assert.throws(() => verifyInternalConsistency(metadata), new RegExp(field));
  });
}

for (const field of [
  "codexVersion",
  "packageVersion",
  "lockVersion",
  "lockRootVersion",
  "attributionVersion",
]) {
  test(`${field} mismatch fails`, () => {
    const metadata = structuredClone(valid);
    metadata[field] = "9.9.9";
    assert.throws(() => verifyInternalConsistency(metadata), new RegExp(field));
  });
}

test("stale README stable ref fails", () => {
  const metadata = structuredClone(valid);
  metadata.readmeStableRef = "v0.1.3";
  assert.throws(() => verifyInternalConsistency(metadata), /readmeStableRef/);
});

test("release verifier CLI accepts the current package tag", () => {
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-release.mjs"), "v0.2.0"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Release integrity passed for v0\.2\.0/);
});

test("release verifier CLI rejects a future tag before the package bump", () => {
  const result = spawnSync(process.execPath, [join(root, "scripts/verify-release.mjs"), "v0.2.1"], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /tag v0\.2\.1.*portableVersion 0\.2\.0/i);
});

test("package validation accepts a fully consistent future version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-version-"));
  await cp(root, directory, {
    recursive: true,
    filter: source => !source.includes("/.git") && !source.includes("/node_modules") && !source.includes("/docs/superpowers"),
  });

  async function updateJson(relativePath, mutate) {
    const path = join(directory, relativePath);
    const document = JSON.parse(await readFile(path, "utf8"));
    mutate(document);
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }

  await updateJson("plugin.json", value => { value.version = "0.2.1"; });
  await updateJson(".codex-plugin/plugin.json", value => { value.version = "0.2.1"; });
  await updateJson("package.json", value => { value.version = "0.2.1"; });
  await updateJson("package-lock.json", value => {
    value.version = "0.2.1";
    value.packages[""].version = "0.2.1";
  });
  await updateJson("mcp.json", value => {
    value.mcpServers["agent-plugin"].headers["X-Anyshift-Agent-Plugin-Version"] = "0.2.1";
  });
  const readmePath = join(directory, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, readme.replace("--ref v0.2.0", "--ref v0.2.1"), "utf8");

  try {
    const result = spawnSync(process.execPath, [join(root, "scripts/validate.mjs"), "--root", directory], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    await rm(directory, { recursive: true });
  }
});
