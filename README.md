# Anyshift Graph Context

A portable [Agent Plugins 1.0.0](https://agent-plugins.org/specification) package that gives
compatible agent clients fast, deterministic, read-only infrastructure context from Anyshift.

The package combines one Agent Skill with a Streamable HTTP MCP configuration. It embeds no token,
authorization header, project identifier, or database name. Compatible clients discover OAuth,
collect consent for one Anyshift project, and store credentials themselves.

## Status

Pre-release. The package validates locally, but it must not be tagged or announced until the
feature-gated endpoint passes authenticated staging and production isolation, revocation,
freshness, and client compatibility checks.

## Capabilities

- resolve ambiguous infrastructure resources;
- inspect direct dependencies and bounded transitive blast radius;
- correlate recent changes with topology;
- assess evidence-backed operational impact; and
- use the constrained Graph query language for deterministic capabilities without a dedicated
  tool.

This plugin supplies graph evidence to an agent already doing a task. It is not an autonomous SRE
agent and does not contain an incident-response loop.

## Validate

```bash
npm ci
npm run validate
```

The validator loads the immutable canonical Agent Plugins 1.0.0 schemas, checks the complete
package layout, rejects symlinks and credential-bearing MCP configuration, and verifies the skill's
untrusted-data boundary.

## Compatibility evidence

No compatible-client claim has been made yet. Before the first release, record the client and
version, installation path, OAuth discovery, initialization, `tools/list`, one tool call, uninstall,
and any deviation for each supported client.

