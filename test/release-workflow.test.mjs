import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadYamlObject } from "../scripts/lib/codex-contracts.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("release workflow validates before publishing and verifies the resulting tag", async () => {
  const workflow = await loadYamlObject(join(root, ".github/workflows/release.yml"));

  assert.ok(workflow.on.workflow_dispatch, "release must be manually dispatched");
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(workflow.permissions.contents, "write");
  assert.equal(workflow.jobs.release.if, "github.ref == 'refs/heads/main'");

  const steps = workflow.jobs.release.steps;
  const commands = steps.map(step => step.run ?? "").join("\n");
  const testIndex = commands.indexOf("npm test");
  const validateIndex = commands.indexOf("npm run validate");
  const integrityIndex = commands.indexOf("npm run verify:release");
  const publishIndex = commands.indexOf("gh release create");
  const postPublishIndex = commands.indexOf("git rev-list -n 1");

  assert.ok(testIndex >= 0 && testIndex < publishIndex, "tests must run before publication");
  assert.ok(validateIndex >= 0 && validateIndex < publishIndex, "validation must run before publication");
  assert.ok(integrityIndex >= 0 && integrityIndex < publishIndex, "release integrity must run before publication");
  assert.ok(commands.indexOf("refs/tags/$RELEASE_TAG") < publishIndex, "existing tag check must run before publication");
  assert.ok(commands.indexOf("gh release view \"$RELEASE_TAG\"") < publishIndex, "existing release check must run before publication");
  assert.ok(postPublishIndex > publishIndex, "tag SHA verification must run after publication");
  assert.match(commands, /gh release create "\$RELEASE_TAG" --generate-notes --target "\$GITHUB_SHA"/);
});

test("validation workflow verifies every direct v-prefixed tag push", async () => {
  const workflow = await loadYamlObject(join(root, ".github/workflows/validate.yml"));

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  const tagStep = workflow.jobs.validate.steps.find(step => step.run?.includes("npm run verify:release"));
  assert.ok(tagStep, "tag validation step is required");
  assert.equal(tagStep.if, "startsWith(github.ref, 'refs/tags/v')");
  assert.match(tagStep.run, /"\$GITHUB_REF_NAME"/);
});
