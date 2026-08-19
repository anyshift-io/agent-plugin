import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadJsonObject,
  loadYamlObject,
  validateCodexPlugin,
  validateMarketplace,
  validateOpenAiAgent,
} from "../scripts/lib/codex-contracts.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function currentDocuments() {
  return {
    codex: await loadJsonObject(join(root, ".codex-plugin/plugin.json")),
    marketplace: await loadJsonObject(join(root, ".agents/plugins/marketplace.json")),
    agent: await loadYamlObject(join(root, "skills/agent-plugin/agents/openai.yaml")),
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
    await assert.rejects(() => loadYamlObject(path), /openai\.yaml.*YAML/i);
  } finally {
    await rm(directory, { recursive: true });
  }
});
