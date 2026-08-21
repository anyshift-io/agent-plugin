import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function copyPackage() {
  const directory = await mkdtemp(join(tmpdir(), "agent-plugin-package-"));
  await cp(root, directory, {
    recursive: true,
    filter: source => !source.includes("/.git") && !source.includes("/node_modules") && !source.includes("/docs/superpowers"),
  });
  return directory;
}

function validatePackage(directory) {
  return spawnSync(process.execPath, [join(root, "scripts/validate.mjs"), "--root", directory], {
    encoding: "utf8",
  });
}

test("skill is a tool map and forbids RCA playbook framing", async () => {
  const skill = await readFile(join(root, "skills/agent-plugin/SKILL.md"), "utf8");
  const queryPatterns = await readFile(
    join(root, "skills/agent-plugin/references/query-patterns.md"),
    "utf8",
  );

  assert.match(skill, /## Evidence kinds → tools/);
  assert.match(skill, /tool map only/i);
  assert.match(skill, /the agent draws all conclusions/i);
  assert.match(skill, /for Sentry alerts, conclude X/i);
  assert.match(skill, /factual summary plus a bounded evidence excerpt/i);
  assert.doesNotMatch(skill, /## Evidence workflow/);

  assert.match(queryPatterns, /query_graph` → `failures`/);
  assert.match(queryPatterns, /SELECT \* FROM failures/);
  assert.doesNotMatch(queryPatterns, /## Correlate changes conservatively/);
});

test("skill documents the bounded one-call cluster change workflow", async () => {
  const skill = await readFile(join(root, "skills/agent-plugin/SKILL.md"), "utf8");
  const queryPatterns = await readFile(
    join(root, "skills/agent-plugin/references/query-patterns.md"),
    "utf8",
  );
  const readme = await readFile(join(root, "README.md"), "utf8");

  assert.match(skill, /qualified cluster name directly/i);
  assert.match(skill, /one normal call when the name is unambiguous/i);
  assert.match(skill, /resolve first only when.+ambiguous.+bounded candidates/is);
  assert.match(skill, /stable `id`.+`resourceId`.+never.+legacy\s+`resource`/is);
  assert.match(skill, /half-open RFC 3339 `from`\/`until`\s+interval.+chosen timezone/is);
  assert.match(skill, /`stats: "none"`.+`nextCursor`.+`hasMore`.+final page/is);
  assert.match(skill, /Do not fetch adjacent clusters.+discard them client-side/is);
  assert.match(skill, /State the timezone and evidence boundary/i);
  assert.match(skill, /authenticated MCP grant owns tenant selection/i);
  assert.match(skill, /provider-native `project` qualifier only narrows a resource inside that tenant/i);

  assert.match(queryPatterns, /"cluster": "example-main-us-central1-prod"/);
  assert.match(queryPatterns, /"type": "node_preempted"/);
  assert.match(queryPatterns, /"from": "2026-08-19T00:00:00Z"/);
  assert.match(queryPatterns, /"until": "2026-08-20T00:00:00Z"/);
  assert.match(queryPatterns, /"stats": "none"/);
  assert.match(queryPatterns, /"limit": 100/);
  assert.match(queryPatterns, /complete only after.+final page/is);

  assert.match(readme, /stable `id` as the `resourceId` argument/);
  assert.doesNotMatch(readme, /stable `id` as the `resource` argument/);
});

test("package validation rejects a skill without the bounded cluster workflow", async () => {
  const directory = await copyPackage();
  const skillPath = join(directory, "skills/agent-plugin/SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    skill.replace(/## Bounded cluster changes[\s\S]*?(?=\n## )/, ""),
    "utf8",
  );

  try {
    const result = validatePackage(directory);
    assert.notEqual(result.status, 0, "validation must fail");
    assert.match(`${result.stdout}\n${result.stderr}`, /bounded cluster change/i);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("package validation rejects malformed openai.yaml", async () => {
  const directory = await copyPackage();
  await writeFile(join(directory, "skills/agent-plugin/agents/openai.yaml"), "interface: [", "utf8");

  try {
    const result = validatePackage(directory);
    assert.notEqual(result.status, 0, "validation must fail");
    assert.match(`${result.stdout}\n${result.stderr}`, /openai\.yaml.*YAML/i);
  } finally {
    await rm(directory, { recursive: true });
  }
});
