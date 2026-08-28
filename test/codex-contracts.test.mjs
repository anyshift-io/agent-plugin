import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReadablePath,
  loadJsonObject,
  loadYamlObject,
  validateCodexPlugin,
  validateMarketplace,
  validateOpenAiAgent,
} from "../scripts/lib/codex-contracts.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function currentDocuments() {
  return {
    codex: await loadJsonObject(join(root, ".codex-plugin/plugin.json"), root),
    marketplace: await loadJsonObject(join(root, ".agents/plugins/marketplace.json"), root),
    agent: await loadYamlObject(join(root, "skills/agent-plugin/agents/openai.yaml"), root),
  };
}

test("current Codex metadata satisfies repository contracts", async () => {
  const { codex, marketplace, agent } = await currentDocuments();

  assert.doesNotThrow(() => validateCodexPlugin(codex));
  assert.doesNotThrow(() => validateMarketplace(marketplace));
  assert.doesNotThrow(() => validateOpenAiAgent(agent));
});

test("Codex plugin rejects unknown fields", async () => {
  const { codex } = await currentDocuments();
  codex.unexpected = true;

  assert.throws(() => validateCodexPlugin(codex), /codexPlugin\.unexpected is not accepted/);
});

test("Codex plugin rejects more than three default prompts", async () => {
  const { codex } = await currentDocuments();
  codex.interface.defaultPrompt.push("A fourth prompt");

  assert.throws(() => validateCodexPlugin(codex), /interface\.defaultPrompt.*at most 3/);
});

test("Codex plugin rejects overlong default prompts", async () => {
  const { codex } = await currentDocuments();
  codex.interface.defaultPrompt[0] = "x".repeat(129);

  assert.throws(() => validateCodexPlugin(codex), /defaultPrompt\[0\].*128/);
});

test("marketplace rejects unknown fields", async () => {
  const { marketplace } = await currentDocuments();
  marketplace.plugins[0].unexpected = true;

  assert.throws(() => validateMarketplace(marketplace), /marketplace\.plugins\[0\]\.unexpected/);
});

test("marketplace rejects unsupported installation policy", async () => {
  const { marketplace } = await currentDocuments();
  marketplace.plugins[0].policy.installation = "AUTO";

  assert.throws(() => validateMarketplace(marketplace), /policy\.installation.*AUTO/);
});

test("marketplace requires the repository URL source", async () => {
  const { marketplace } = await currentDocuments();
  marketplace.plugins[0].source = { source: "local", url: "./" };

  assert.throws(() => validateMarketplace(marketplace), /source\.source.*url/);
});

test("openai.yaml rejects unknown fields", async () => {
  const { agent } = await currentDocuments();
  agent.interface.unexpected = true;

  assert.throws(() => validateOpenAiAgent(agent), /openAiAgent\.interface\.unexpected/);
});

test("openai.yaml requires a non-empty default prompt", async () => {
  const { agent } = await currentDocuments();
  agent.interface.default_prompt = "";

  assert.throws(() => validateOpenAiAgent(agent), /interface\.default_prompt must be non-empty/);
});

test("malformed openai.yaml is rejected with its path", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-yaml-"));
  const path = join(directory, "openai.yaml");
  await writeFile(path, "interface: [", "utf8");

  try {
    await assert.rejects(() => loadYamlObject(path, directory), /openai\.yaml.*YAML/i);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("assertReadablePath rejects empty, non-string, null-byte, and escaping paths", async () => {
  await assert.rejects(() => assertReadablePath("", root), /path must be non-empty/);
  await assert.rejects(() => assertReadablePath("   ", root), /path must be non-empty/);
  await assert.rejects(() => assertReadablePath(null, root), /path must be a string/);
  await assert.rejects(() => assertReadablePath("evil\0.json", root), /null bytes/);
  await assert.rejects(() => assertReadablePath("/etc/passwd", root), /escapes allowed root/);
  await assert.rejects(() => assertReadablePath(join(root, "..", "outside.json"), root), /escapes allowed root/);
});

test("assertReadablePath rejects symlink escapes outside the trusted root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "agent-plugin-outside-"));
  const link = join(directory, "escape");
  const secret = join(outside, "secret.json");
  await writeFile(secret, '{"ok":true}', "utf8");

  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, link);
    await assert.rejects(() => assertReadablePath(join(link, "secret.json"), directory), /escapes allowed root/);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("loadJsonObject refuses to follow a final-component symlink (O_NOFOLLOW)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-nofollow-"));
  const outside = await mkdtemp(join(tmpdir(), "agent-plugin-nofollow-out-"));
  const target = join(outside, "secret.json");
  const link = join(directory, "plugin.json");
  await writeFile(target, '{"name":"escaped"}', "utf8");

  try {
    const { symlink, unlink } = await import("node:fs/promises");
    // Create a regular in-root file so realpath containment passes, then replace with symlink.
    await writeFile(link, '{"name":"ok"}', "utf8");
    await assert.doesNotReject(() => loadJsonObject(link, directory));
    await unlink(link);
    await symlink(target, link);
    await assert.rejects(() => loadJsonObject(link, directory), /ELOOP|escapes allowed root|symbolic link/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("loadJsonObject rejects null-byte paths before reading", async () => {
  await assert.rejects(() => loadJsonObject("plugin\0.json", root), /null bytes/);
});
