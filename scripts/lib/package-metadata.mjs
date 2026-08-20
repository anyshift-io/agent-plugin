import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadJsonObject } from "./codex-contracts.mjs";

const TAG_SEMVER = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export async function readPackageMetadata(root) {
  const [portable, codex, packageManifest, packageLock, mcp, marketplace, readme] = await Promise.all([
    loadJsonObject(join(root, "plugin.json")),
    loadJsonObject(join(root, ".codex-plugin/plugin.json")),
    loadJsonObject(join(root, "package.json")),
    loadJsonObject(join(root, "package-lock.json")),
    loadJsonObject(join(root, "mcp.json")),
    loadJsonObject(join(root, ".agents/plugins/marketplace.json")),
    readFile(join(root, "README.md"), "utf8"),
  ]);

  const mcpEntries = Object.entries(mcp.mcpServers ?? {});
  assert.equal(mcpEntries.length, 1, "mcp.json must contain exactly one MCP server");
  const [mcpServerName, mcpServer] = mcpEntries[0];
  assert.ok(mcpServer && typeof mcpServer === "object", "mcp.json server must be an object");

  assert.ok(Array.isArray(marketplace.plugins), "marketplace.plugins must be an array");
  assert.equal(marketplace.plugins.length, 1, "marketplace.plugins must contain exactly one entry");

  const readmeMatch = readme.match(
    /codex plugin marketplace add anyshift-io\/agent-plugin --ref (v[^\s]+)/,
  );
  assert.ok(readmeMatch, "README stable install ref is missing");

  return {
    portableName: portable.name,
    portableVersion: portable.version,
    codexName: codex.name,
    codexVersion: codex.version,
    packageName: packageManifest.name,
    packageVersion: packageManifest.version,
    lockName: packageLock.name,
    lockVersion: packageLock.version,
    lockRootName: packageLock.packages?.[""]?.name,
    lockRootVersion: packageLock.packages?.[""]?.version,
    mcpServerName,
    attributionName: mcpServer.headers?.["X-Anyshift-Agent-Plugin"],
    attributionVersion: mcpServer.headers?.["X-Anyshift-Agent-Plugin-Version"],
    marketplaceName: marketplace.plugins[0]?.name,
    readmeStableRef: readmeMatch[1],
  };
}

function equalField(metadata, field, expectedField) {
  assert.equal(
    metadata[field],
    metadata[expectedField],
    `${field} ${metadata[field]} must match ${expectedField} ${metadata[expectedField]}`,
  );
}

export function verifyInternalConsistency(metadata) {
  for (const field of [
    "codexName",
    "packageName",
    "lockName",
    "lockRootName",
    "attributionName",
    "marketplaceName",
  ]) {
    equalField(metadata, field, "portableName");
  }

  assert.equal(
    metadata.mcpServerName,
    "anyshift",
    `mcpServerName ${metadata.mcpServerName} must be anyshift`,
  );

  for (const field of [
    "codexVersion",
    "packageVersion",
    "lockVersion",
    "lockRootVersion",
    "attributionVersion",
  ]) {
    equalField(metadata, field, "portableVersion");
  }

  assert.equal(
    metadata.readmeStableRef,
    `v${metadata.portableVersion}`,
    `readmeStableRef ${metadata.readmeStableRef} must match portableVersion v${metadata.portableVersion}`,
  );
}

export function verifyReleaseTag(metadata, tag) {
  assert.equal(typeof tag, "string", "release tag must be a string");
  assert.match(tag, TAG_SEMVER, "release tag must use strict v-prefixed semver");
  verifyInternalConsistency(metadata);
  assert.equal(
    tag,
    `v${metadata.portableVersion}`,
    `tag ${tag} must match portableVersion ${metadata.portableVersion}`,
  );
}
