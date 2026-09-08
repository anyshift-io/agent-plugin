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
  assert.doesNotMatch(skill, /## Evidence workflow/);

  assert.match(queryPatterns, /the agent draws all conclusions/i);
  assert.doesNotMatch(queryPatterns, /## Correlate changes conservatively/);
});

test("skill documents the event-graph query mechanics", async () => {
  const skill = await readFile(join(root, "skills/agent-plugin/SKILL.md"), "utf8");
  const queryPatterns = await readFile(
    join(root, "skills/agent-plugin/references/query-patterns.md"),
    "utf8",
  );
  const recipes = await readFile(
    join(root, "skills/agent-plugin/references/recipes.md"),
    "utf8",
  );

  assert.match(skill, /Call `describe_schema` FIRST/i);
  assert.match(skill, /datetime\('2026-08-09T00:00:00Z'\)/);
  assert.match(skill, /matches ZERO rows without erroring/i);
  assert.match(skill, /Current state requires `:ALIVE`/i);
  assert.match(skill, /0 rows is NOT evidence of absence/i);
  assert.match(skill, /Tenant selection is owned by the authenticated MCP grant/i);
  assert.match(skill, /`list_projects` \+ `set_project`/);

  assert.match(queryPatterns, /hashedID/);
  assert.match(queryPatterns, /ungated event histogram/i);
  assert.match(queryPatterns, /Do not claim causality from temporal proximity alone/i);

  assert.match(recipes, /## Event histogram/i);
  assert.match(recipes, /BEFORE narrowing/i);
  assert.match(recipes, /fan-in is exposure, not fragility/i);
  for (const heading of ["Public exposure trace", "Shortest path between two resources", "RBAC reach", "Kubernetes hygiene gaps", "Hotspots"]) {
    assert.match(recipes, new RegExp(`## ${heading}`, "i"));
  }
});

test("package validation rejects a skill without the Cypher mechanics section", async () => {
  const directory = await copyPackage();
  const skillPath = join(directory, "skills/agent-plugin/SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  await writeFile(
    skillPath,
    skill.replace(/## Cypher mechanics that silently break queries[\s\S]*?(?=\n## )/, ""),
    "utf8",
  );

  try {
    const result = validatePackage(directory);
    assert.notEqual(result.status, 0, "validation must fail");
    assert.match(`${result.stdout}\n${result.stderr}`, /datetime|ZERO rows|:ALIVE/i);
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
