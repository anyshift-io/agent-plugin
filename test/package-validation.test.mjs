import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("package validation rejects malformed openai.yaml", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-package-"));
  await cp(root, directory, {
    recursive: true,
    filter: source => !source.includes("/.git") && !source.includes("/node_modules") && !source.includes("/docs/superpowers"),
  });
  await writeFile(join(directory, "skills/agent-plugin/agents/openai.yaml"), "interface: [", "utf8");

  try {
    const result = spawnSync(process.execPath, [join(root, "scripts/validate.mjs"), "--root", directory], {
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0, "validation must fail");
    assert.match(`${result.stdout}\n${result.stderr}`, /openai\.yaml.*YAML/i);
  } finally {
    await rm(directory, { recursive: true });
  }
});
