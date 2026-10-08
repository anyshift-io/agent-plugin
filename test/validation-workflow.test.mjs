import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadYamlObject } from "../scripts/lib/codex-contracts.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const title = "Manual PR validation #37";

async function workflow() {
  return loadYamlObject(join(root, ".github/workflows/validate.yml"), root);
}

async function fixtureDirectory({ runId = "100", runAttempt = "1", headSha = sha } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "agent-plugin-validation-workflow-"));
  const files = {
    runs: join(dir, "runs.json"),
    pr: join(dir, "pr.json"),
    checks: join(dir, "checks.json"),
    check: join(dir, "check.json"),
    calls: join(dir, "calls.jsonl"),
    output: join(dir, "github-output"),
    gh: join(dir, "gh"),
  };
  await writeFile(files.runs, JSON.stringify([{ workflow_runs: [{
    id: Number(runId), run_number: 42, run_attempt: Number(runAttempt),
    event: "workflow_dispatch", display_title: title,
  }] }]));
  await writeFile(files.pr, JSON.stringify({
    state: "open",
    base: { repo: { full_name: "anyshift-io/agent-plugin" } },
    head: { sha: headSha },
  }));
  await writeFile(files.checks, JSON.stringify([{ check_runs: [] }]));
  await writeFile(files.check, JSON.stringify({
    id: 900, name: "validate", head_sha: sha, external_id: "manual-pr-validation:37",
  }));
  await writeFile(files.calls, "");
  await writeFile(files.output, "");
  await writeFile(files.gh, `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const endpoint = args.find(value => value.startsWith("repos/")) ?? "";
const methodIndex = args.indexOf("--method");
const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
const fixture = name => JSON.parse(readFileSync(process.env.FIXTURE_DIR + "/" + name, "utf8"));
const payload = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input ? JSON.parse(input) : null;
};
if (endpoint.includes("/actions/workflows/validate.yml/runs?")) {
  process.stdout.write(JSON.stringify(fixture("runs.json")));
} else if (/\\/pulls\\/\\d+$/.test(endpoint)) {
  process.stdout.write(JSON.stringify(fixture("pr.json")));
} else if (/\\/commits\\/[0-9a-f]{40}\\/check-runs\\?/.test(endpoint)) {
  process.stdout.write(JSON.stringify(fixture("checks.json")));
} else if (/\\/check-runs\\/\\d+$/.test(endpoint) && method === "GET") {
  process.stdout.write(JSON.stringify(fixture("check.json")));
} else if (/\\/check-runs(?:\\/\\d+)?$/.test(endpoint) && (method === "POST" || method === "PATCH")) {
  const body = await payload();
  appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({ method, endpoint, body }) + "\\n");
  process.stdout.write(method === "POST" ? JSON.stringify({ id: 900 }) : "{}");
} else {
  console.error("unexpected gh api call", method, endpoint);
  process.exit(2);
}
`);
  await chmod(files.gh, 0o755);
  return { dir, files, runId, runAttempt };
}

async function executeRun(run, step, env = {}) {
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", step.run], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${run.dir}:${process.env.PATH}`,
      FIXTURE_DIR: run.dir,
      CAPTURE_FILE: run.files.calls,
      GITHUB_OUTPUT: run.files.output,
      GITHUB_REPOSITORY: "anyshift-io/agent-plugin",
      GITHUB_RUN_ID: run.runId,
      GITHUB_RUN_ATTEMPT: run.runAttempt,
      PR_NUMBER: "37",
      HEAD_SHA: sha,
      MERGE_SHA: otherSha,
      RUN_TITLE: title,
      TARGET_URL: "https://github.com/anyshift-io/agent-plugin/actions/runs/100",
      VALIDATION_RESULT: "success",
      CHECK_RUN_ID: "900",
      ...env,
    },
  });
  assert.equal(result.status, 0, `script failed: ${result.stderr}\n${result.stdout}`);
  return result;
}

async function calls(run) {
  const text = await readFile(run.files.calls, "utf8");
  return text.trim() ? text.trim().split("\n").map(line => JSON.parse(line)) : [];
}

test("manual dispatcher creates a trusted check; validate stays manual for PRs and automatic on push", async () => {
  const config = await workflow();
  assert.ok(config.on.workflow_dispatch.inputs.pr_number);
  assert.equal(Object.hasOwn(config.on, "pull_request"), false);
  assert.ok(Object.hasOwn(config.on, "push"));
  assert.match(config.jobs.validate.if, /event_name != 'workflow_dispatch'/);
  assert.deepEqual(config.jobs["validate-fork-pr"].needs, ["resolve-fork-pr", "start-manual-validation-check"]);
  assert.match(config.jobs["start-manual-validation-check"].if, /workflow_dispatch/);
  assert.deepEqual(config.jobs["validate-fork-pr"].permissions, { contents: "read" });
  assert.deepEqual(config.jobs["start-manual-validation-check"].permissions, {
    actions: "read", checks: "write", "pull-requests": "read",
  });
  assert.deepEqual(config.jobs["finalize-manual-validation-check"].permissions, {
    actions: "read", checks: "write", "pull-requests": "read",
  });
  assert.equal(config.jobs["start-manual-validation-check"].steps.some(step => step.uses), false);
  assert.equal(config.jobs["finalize-manual-validation-check"].steps.some(step => step.uses), false);
  assert.equal(config.jobs["finalize-manual-validation-check"].permissions.statuses, undefined);
});

test("manual check is a single CheckRun named validate, bound to the captured PR head", async () => {
  const config = await workflow();
  const start = config.jobs["start-manual-validation-check"].steps.find(step => step.id === "start");
  const run = await fixtureDirectory();
  try {
    await executeRun(run, start);
    const output = await readFile(run.files.output, "utf8");
    assert.match(output, /should_run=true/);
    assert.match(output, /check_run_id=900/);
    const [request] = await calls(run);
    assert.equal(request.method, "POST");
    assert.equal(request.body.name, "validate");
    assert.equal(request.body.head_sha, sha);
    assert.equal(request.body.external_id, "manual-pr-validation:37");
    assert.equal(request.body.status, "in_progress");
    assert.doesNotMatch(start.run, /statuses\/|context=validate/);
  } finally {
    await rm(run.dir, { recursive: true, force: true });
  }
});

test("stale dispatch cannot create or complete the required check", async () => {
  const config = await workflow();
  const start = config.jobs["start-manual-validation-check"].steps.find(step => step.id === "start");
  const finish = config.jobs["finalize-manual-validation-check"].steps[0];
  const run = await fixtureDirectory();
  try {
    await writeFile(run.files.runs, JSON.stringify([{ workflow_runs: [{
      id: 101, run_number: 43, run_attempt: 1, event: "workflow_dispatch", display_title: title,
    }] }]));
    await executeRun(run, start);
    assert.match(await readFile(run.files.output, "utf8"), /should_run=false/);
    await executeRun(run, finish);
    assert.deepEqual(await calls(run), []);
  } finally {
    await rm(run.dir, { recursive: true, force: true });
  }
});

test("validator checks immutable merge SHA while the external check targets the head SHA", async () => {
  const config = await workflow();
  const checkout = config.jobs["validate-fork-pr"].steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ needs.resolve-fork-pr.outputs.merge_sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const start = config.jobs["start-manual-validation-check"].steps.find(step => step.id === "start").run;
  assert.match(start, /commits\/\$\{HEAD_SHA\}\/check-runs/);
  assert.match(start, /--arg head_sha \"\$HEAD_SHA\"/);
  assert.doesNotMatch(config.jobs["validate-fork-pr"].steps.map(step => step.run ?? "").join("\n"), /statuses: write|checks: write/);
});

test("final check reports failure and cancellation, and rejects a changed PR head", async () => {
  const config = await workflow();
  const finish = config.jobs["finalize-manual-validation-check"].steps[0];
  for (const [scenario, validationResult, currentSha, expected] of [
    ["failure", "failure", sha, "failure"],
    ["cancelled", "cancelled", sha, "cancelled"],
    ["stale-head", "success", otherSha, "cancelled"],
  ]) {
    const run = await fixtureDirectory({ headSha: currentSha });
    try {
      await executeRun(run, finish, { VALIDATION_RESULT: validationResult });
      const [update] = await calls(run);
      assert.equal(update.method, "PATCH", scenario);
      assert.equal(update.body.status, "completed", scenario);
      assert.equal(update.body.conclusion, expected, scenario);
      assert.match(update.body.output.summary, /did not complete|cancelled|head changed/i, scenario);
    } finally {
      await rm(run.dir, { recursive: true, force: true });
    }
  }
});

test("manual publisher never writes a legacy commit status", async () => {
  const config = await workflow();
  const manualScripts = [
    ...config.jobs["start-manual-validation-check"].steps,
    ...config.jobs["finalize-manual-validation-check"].steps,
  ].map(step => step.run ?? "").join("\n");
  assert.doesNotMatch(manualScripts, /repos\/\$\{GITHUB_REPOSITORY\}\/statuses|statuses: write/);
  assert.match(manualScripts, /check-runs/);
});
