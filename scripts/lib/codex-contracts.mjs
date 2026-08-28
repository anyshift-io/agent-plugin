import assert from "node:assert/strict";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { parse } from "yaml";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const READ_NOFOLLOW = constants.O_RDONLY | constants.O_NOFOLLOW;

function assertUnderRoot(resolved, resolvedRoot, path) {
  const rootPrefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  assert.ok(
    resolved === resolvedRoot || resolved.startsWith(rootPrefix),
    `path escapes allowed root: ${path}`,
  );
}

/**
 * Reject attacker-controlled / malformed paths before any filesystem read.
 * Resolved (and realpath-canonicalized when the target exists) paths must stay
 * under the provided trusted root so symlink escapes are rejected too.
 */
export async function assertReadablePath(path, root) {
  assert.equal(typeof path, "string", "path must be a string");
  assert.ok(path.length > 0 && path.trim().length > 0, "path must be non-empty");
  assert.equal(path.includes("\0"), false, "path must not contain null bytes");
  assert.equal(typeof root, "string", "root must be a string");
  assert.ok(root.length > 0 && root.trim().length > 0, "root must be non-empty");
  assert.equal(root.includes("\0"), false, "root must not contain null bytes");

  const resolvedRoot = await realpath(root);
  const lexical = resolve(path);
  assertUnderRoot(lexical, resolve(root), path);

  let resolved;
  try {
    resolved = await realpath(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return lexical;
    }
    throw error;
  }
  assertUnderRoot(resolved, resolvedRoot, path);
  return resolved;
}

/** Open without following a final-component symlink, then read that same handle. */
async function readTrustedFile(path, root) {
  const safePath = await assertReadablePath(path, root);
  const handle = await open(safePath, READ_NOFOLLOW);
  try {
    const resolvedRoot = await realpath(root);
    let openedPath;
    try {
      openedPath = await realpath(`/proc/self/fd/${handle.fd}`);
    } catch (error) {
      throw new Error(
        `unable to verify opened descriptor under root (requires /proc/self/fd): ${error.message}`,
        { cause: error },
      );
    }
    assertUnderRoot(openedPath, resolvedRoot, path);
    return { safePath: openedPath, content: await handle.readFile("utf8") };
  } finally {
    await handle.close();
  }
}

function plainObject(value, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function rejectUnknown(value, allowed, label) {
  plainObject(value, label);
  for (const key of Object.keys(value)) {
    assert.ok(allowed.has(key), `${label}.${key} is not accepted`);
  }
}

function nonEmpty(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim(), `${label} must be non-empty`);
}

function httpsUrl(value, label) {
  nonEmpty(value, label);
  const url = new URL(value);
  assert.equal(url.protocol, "https:", `${label} must be an absolute https URL`);
}

function stringArray(value, label, { min = 0, max = Number.POSITIVE_INFINITY, maxLength } = {}) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length >= min, `${label} must contain at least ${min} item(s)`);
  assert.ok(value.length <= max, `${label} must contain at most ${max} item(s)`);
  value.forEach((item, index) => {
    nonEmpty(item, `${label}[${index}]`);
    if (maxLength !== undefined) {
      assert.ok(item.length <= maxLength, `${label}[${index}] must contain at most ${maxLength} characters`);
    }
  });
}

export async function loadJsonObject(path, root) {
  const { safePath, content } = await readTrustedFile(path, root);
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error(`${safePath} must contain valid JSON: ${error.message}`, { cause: error });
  }
  return plainObject(value, safePath);
}

export async function loadYamlObject(path, root) {
  const { safePath, content } = await readTrustedFile(path, root);
  let value;
  try {
    value = parse(content);
  } catch (error) {
    throw new Error(`${safePath} must contain valid YAML: ${error.message}`, { cause: error });
  }
  return plainObject(value, safePath);
}

export function validateCodexPlugin(document) {
  rejectUnknown(
    document,
    new Set([
      "name",
      "version",
      "description",
      "author",
      "homepage",
      "repository",
      "license",
      "keywords",
      "skills",
      "interface",
    ]),
    "codexPlugin",
  );
  for (const field of ["name", "version", "description", "license", "skills"]) {
    nonEmpty(document[field], `codexPlugin.${field}`);
  }
  assert.match(document.version, SEMVER, "codexPlugin.version must be strict semver");
  assert.equal(document.skills, "./skills/", "codexPlugin.skills must be ./skills/");
  assert.equal("mcpServers" in document, false, "codexPlugin must not duplicate portable mcp.json");
  httpsUrl(document.homepage, "codexPlugin.homepage");
  httpsUrl(document.repository, "codexPlugin.repository");
  stringArray(document.keywords, "codexPlugin.keywords", { min: 1 });

  const author = plainObject(document.author, "codexPlugin.author");
  rejectUnknown(author, new Set(["name", "url"]), "codexPlugin.author");
  nonEmpty(author.name, "codexPlugin.author.name");
  httpsUrl(author.url, "codexPlugin.author.url");

  const userInterface = plainObject(document.interface, "codexPlugin.interface");
  rejectUnknown(
    userInterface,
    new Set([
      "displayName",
      "shortDescription",
      "longDescription",
      "developerName",
      "category",
      "capabilities",
      "websiteURL",
      "privacyPolicyURL",
      "termsOfServiceURL",
      "defaultPrompt",
      "brandColor",
      "screenshots",
    ]),
    "codexPlugin.interface",
  );
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
    nonEmpty(userInterface[field], `codexPlugin.interface.${field}`);
  }
  for (const field of ["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]) {
    httpsUrl(userInterface[field], `codexPlugin.interface.${field}`);
  }
  stringArray(userInterface.capabilities, "codexPlugin.interface.capabilities", { min: 1 });
  stringArray(userInterface.defaultPrompt, "codexPlugin.interface.defaultPrompt", {
    min: 1,
    max: 3,
    maxLength: 128,
  });
  assert.match(userInterface.brandColor, HEX_COLOR, "codexPlugin.interface.brandColor must use #RRGGBB");
  stringArray(userInterface.screenshots, "codexPlugin.interface.screenshots");
}

export function validateMarketplace(document) {
  rejectUnknown(document, new Set(["name", "interface", "plugins"]), "marketplace");
  assert.equal(document.name, "anyshift", "marketplace.name must be anyshift");

  const userInterface = plainObject(document.interface, "marketplace.interface");
  rejectUnknown(userInterface, new Set(["displayName"]), "marketplace.interface");
  assert.equal(userInterface.displayName, "Anyshift", "marketplace.interface.displayName must be Anyshift");

  assert.ok(Array.isArray(document.plugins), "marketplace.plugins must be an array");
  assert.equal(document.plugins.length, 1, "marketplace.plugins must contain exactly one entry");
  const entry = plainObject(document.plugins[0], "marketplace.plugins[0]");
  rejectUnknown(entry, new Set(["name", "source", "policy", "category"]), "marketplace.plugins[0]");
  assert.equal(entry.name, "agent-plugin", "marketplace.plugins[0].name must be agent-plugin");
  assert.equal(entry.category, "Developer Tools", "marketplace.plugins[0].category must be Developer Tools");

  const source = plainObject(entry.source, "marketplace.plugins[0].source");
  rejectUnknown(source, new Set(["source", "url"]), "marketplace.plugins[0].source");
  assert.equal(source.source, "url", "marketplace.plugins[0].source.source must be url");
  assert.equal(source.url, "./", "marketplace.plugins[0].source.url must be ./");

  const policy = plainObject(entry.policy, "marketplace.plugins[0].policy");
  rejectUnknown(policy, new Set(["installation", "authentication"]), "marketplace.plugins[0].policy");
  assert.ok(
    new Set(["NOT_AVAILABLE", "AVAILABLE", "INSTALLED_BY_DEFAULT"]).has(policy.installation),
    `marketplace.plugins[0].policy.installation has unsupported value ${policy.installation}`,
  );
  assert.ok(
    new Set(["ON_INSTALL", "ON_USE"]).has(policy.authentication),
    `marketplace.plugins[0].policy.authentication has unsupported value ${policy.authentication}`,
  );
  assert.equal(policy.installation, "AVAILABLE", "marketplace.plugins[0].policy.installation must be AVAILABLE");
  assert.equal(policy.authentication, "ON_INSTALL", "marketplace.plugins[0].policy.authentication must be ON_INSTALL");
}

export function validateOpenAiAgent(document) {
  rejectUnknown(document, new Set(["interface"]), "openAiAgent");
  const userInterface = plainObject(document.interface, "openAiAgent.interface");
  rejectUnknown(
    userInterface,
    new Set(["display_name", "short_description", "default_prompt"]),
    "openAiAgent.interface",
  );
  for (const field of ["display_name", "short_description", "default_prompt"]) {
    nonEmpty(userInterface[field], `openAiAgent.interface.${field}`);
  }
}
