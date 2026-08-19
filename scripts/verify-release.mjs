#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPackageMetadata, verifyReleaseTag } from "./lib/package-metadata.mjs";

const tag = process.argv[2];
assert.ok(tag, "usage: npm run verify:release -- v<version>");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
verifyReleaseTag(await readPackageMetadata(root), tag);
process.stdout.write(`Release integrity passed for ${tag}.\n`);
