import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadYamlObject } from "../scripts/lib/codex-contracts.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const PINNED_ACTION = /^[^@]+@[0-9a-f]{40}$/;

function assertActionsArePinned(workflow) {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.uses) {
        assert.match(step.uses, PINNED_ACTION, `${step.uses} must use a full commit SHA`);
      }
    }
  }
}

test("release workflow isolates read-only validation from publication", async () => {
  const workflow = await loadYamlObject(join(root, ".github/workflows/release.yml"));

  assert.ok(workflow.on.workflow_dispatch, "release must be manually dispatched");
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.validate.if, "github.ref == 'refs/heads/main'");
  assert.equal(workflow.jobs.validate.permissions.contents, "read");
  assert.equal(workflow.jobs.publish.permissions.contents, "write");
  assert.equal(workflow.jobs.publish.needs, "validate");
  assert.equal(workflow.jobs.validate.outputs["release-tag"], "${{ inputs.tag }}");
  assert.equal(workflow.jobs.validate.outputs["release-sha"], "${{ github.sha }}");

  const checkout = workflow.jobs.validate.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.ok(checkout, "validation must check out the release candidate");
  assert.equal(checkout.with["persist-credentials"], false);

  const validationCommands = workflow.jobs.validate.steps.map(step => step.run ?? "").join("\n");
  assert.match(validationCommands, /npm test/);
  assert.match(validationCommands, /npm run validate/);
  assert.match(validationCommands, /npm run verify:release/);

  const publishCommands = workflow.jobs.publish.steps.map(step => step.run ?? "").join("\n");
  assert.doesNotMatch(publishCommands, /npm|node|scripts\//, "publish must not execute repository code");
  assert.match(publishCommands, /gh release create "\$RELEASE_TAG"/);
  assert.match(publishCommands, /--target "\$RELEASE_SHA"/);
  assert.match(publishCommands, /repos\/\$GITHUB_REPOSITORY\/commits\/\$RELEASE_TAG/);
  assertActionsArePinned(workflow);
});

test("validation workflow verifies every direct v-prefixed tag push", async () => {
  const workflow = await loadYamlObject(join(root, ".github/workflows/validate.yml"));

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  const tagStep = workflow.jobs.validate.steps.find(step => step.run?.includes("npm run verify:release"));
  assert.ok(tagStep, "tag validation step is required");
  assert.equal(tagStep.if, "startsWith(github.ref, 'refs/tags/v')");
  assert.match(tagStep.run, /"\$GITHUB_REF_NAME"/);
  const checkout = workflow.jobs.validate.steps.find(step => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with["persist-credentials"], false);
  assertActionsArePinned(workflow);
});
