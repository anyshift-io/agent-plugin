# Anyshift Agent Plugin

A portable [Agent Plugins 1.0.0](https://agent-plugins.org/specification) package that gives
compatible agent clients fast, deterministic, read-only production evidence from Anyshift over
[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28).

The package combines one Agent Skill with a Streamable HTTP MCP configuration. It embeds no token,
authorization header, project identifier, or database name. Compatible clients discover OAuth,
collect consent for one Anyshift project, and store credentials themselves.

## Status

Published versions are listed in [GitHub Releases](https://github.com/anyshift-io/agent-plugin/releases),
and each package release remains gated on production verification of its matching Graph API support.
The portable package validates against Agent Plugins 1.0.0. As of v0.3.0 the production endpoint
serves the Anyshift event-graph tool surface — discovery of all ten tools (`describe_schema`,
`find_resources`, `get_resource_details`, `get_resource_events`, `get_recent_events`,
`get_correlated_events`, `get_related`, `query_graph`, `list_projects`, `set_project`).
Verification of v0.3.0 against production is pending and gates its release; the recorded
[Compatibility evidence](#compatibility-evidence) below was captured against the previous catalog
surface (v0.2.x) and is retained with that boundary stated.

## MCP protocol compatibility

The production endpoint at `https://api.anyshift.io/mcp/graph` supports the stateless Streamable HTTP
transport defined by MCP `2026-07-28`. Modern requests are self-contained and carry the negotiated
protocol version, client metadata, method, and tool name on every request. The endpoint also retains
legacy MCP compatibility through `2025-11-25` for clients that still use initialization negotiation.

Authorization follows the MCP HTTP authorization profile: the server publishes OAuth protected
resource metadata, challenges unauthenticated requests, and binds the resulting `graph:read` grant
to one user-selected Anyshift project.

## Capabilities

- discover the project's live graph vocabulary (`describe_schema`);
- resolve ambiguous infrastructure resources to stable identifiers;
- inspect a resource's properties, relationships, and change-event history;
- sweep windowed project-wide events and reconstruct correlated incident chains;
- traverse the graph neighborhood of any resource; and
- run bounded read-only Cypher for any analysis without a dedicated tool, including the
  named recipes in `skills/agent-plugin/references/recipes.md` (event histograms, SPOF
  fan-in, orphans, co-tenancy, deploy-impact, bounded blast radius, public exposure
  trace, shortest path, RBAC reach, Kubernetes hygiene gaps, hotspots).

This plugin supplies production graph evidence to an agent already doing a task. It is not an
autonomous SRE agent and does not contain an incident-response loop.

## Install

Agent Plugins clients can load this repository root directly. They discover the portable
`plugin.json`, `mcp.json`, and `skills/` components. OAuth and project consent are handled by the
client; the package contains no credentials or project identifiers.

### Codex CLI

Codex 0.147.0 or newer is recommended. Install the latest verified release:

```bash
codex plugin marketplace add anyshift-io/agent-plugin --ref v0.3.0
codex plugin add agent-plugin@anyshift
codex mcp add Anyshift --url https://api.anyshift.io/mcp/graph
```

To test unreleased development changes instead, register `main` as an edge marketplace source:

```bash
codex plugin marketplace add anyshift-io/agent-plugin --ref main
```

The stable install command is version-pinned deliberately. Each release updates it to the newly
verified tag; package validation fails when the README version falls behind the manifests.

The final command is required by Codex CLI 0.147.0 because its plugin installer does not yet launch
OAuth for a plugin-owned remote MCP server. It opens the browser OAuth flow; select the Anyshift
project the plugin may read. Start a new Codex thread after installation so the skill and MCP tools
are loaded together.

Codex CLI 0.147.0 may also log an `Auth required` warning for the unauthenticated portable MCP
entry while using the explicitly registered authenticated connection. Tool discovery and calls are
unaffected; no unauthenticated request can read graph data.

### Cursor

Cursor 3.15.6 or newer is recommended. Cursor supports Agent Plugins and remote Streamable HTTP MCP
with OAuth.

#### Cursor Marketplace

One-click install from the Cursor Marketplace is coming. Until that lands, use the local Agent
Plugin package below.

#### Local Agent Plugin package

Install the portable Agent Plugin package so Cursor loads the skill and MCP configuration together:

```bash
git clone https://github.com/anyshift-io/agent-plugin.git \
  ~/.cursor/plugins/local/agent-plugin
```

Reload the Cursor window (`Developer: Reload Window`). Cursor discovers Agent Plugins from
`~/.cursor/plugins/local`. Authenticate when Cursor prompts (`needsAuth` / `mcp_auth`), select the
Anyshift project the plugin may read, and start a new agent chat so the Graph tools are available.

Do not symlink a checkout from outside `~/.cursor/plugins/local` into that directory. Cursor 3.15.6
rejects out-of-tree local plugin symlink targets and skips the package.

#### Uninstall (Cursor)

1. Delete `~/.cursor/plugins/local/agent-plugin`.
2. Reload the Cursor window.

#### Cursor caveats

- Local plugin symlinks whose target is outside `~/.cursor/plugins/local` are rejected.
- While unauthenticated, Cursor may expose a client-side `mcp_auth` helper alongside the Graph
  tools. That helper is not part of the Graph API tool surface.
- The portable package `mcp.json` keeps the Agent Plugins `type: "streamable-http"` form for
  cross-client portability; Cursor accepts that package form when loading the local Agent Plugin.

## Usage attribution

Compatible Agent Plugin clients send a fixed, non-secret package name and version with Graph MCP requests. Anyshift uses this declaration for aggregate product usage and reliability telemetry in PostHog and request diagnostics in Sentry. It is not used for authentication, authorization, tenant selection, or rate-limit identity, and the package contains no credentials.

Codex CLI 0.147.0 installs the skill but requires a separate `codex mcp add` command. That separately configured connection may not forward the package headers, so Anyshift can identify the Codex MCP and OAuth clients without claiming exact plugin attribution for those requests.

On Cursor, the local Agent Plugin package sends package attribution headers by default.

## Resource identity

Graph resource names are not globally unique. For example, one deployment name can identify both a
Terraform `STATE_RESOURCE` and the runtime `ECS_SERVICE` it manages. For short, overloaded, or
same-named resources:

1. call `find_resources`;
2. select the candidate with the intended resource type; and
3. pass that candidate's `hashedID` from `find_resources` to the drill-down tools
   (`get_resource_details`, `get_resource_events`, `get_related`).

An unqualified name-only query remains deterministic, but it can select a different same-named
resource kind. Using the resolved stable identifier preserves the selected identity without placing
project IDs, database names, or credentials in tool arguments.

## Claude Code

Install natively through the plugin manager (bundles the MCP server and the skill in one step):

```
/plugin marketplace add anyshift-io/agent-plugin
/plugin install anyshift-graph@anyshift
```

Then run `/mcp`, pick `plugin:anyshift-graph:Anyshift` and choose **Authenticate** (or, from a
shell, `claude mcp login plugin:anyshift-graph:Anyshift`): sign in and select the project the agent
may read. The skill is available as `/anyshift-graph:agent-plugin` and is also picked up
automatically. The manual clone + symlink + `claude mcp add` flow documented at docs.anyshift.io
keeps working, but does not receive managed updates.

## Validate

```bash
npm ci
npm run validate
```

The validator loads the immutable canonical Agent Plugins 1.0.0 schemas, checks the complete
package layout, rejects symlinks and credential-bearing MCP configuration, and verifies the skill's
untrusted-data boundary. It also enforces repository-owned contracts for the Codex plugin manifest,
marketplace metadata, and `skills/agent-plugin/agents/openai.yaml`.

## Release

After updating every version-bearing manifest, attribution header, lockfile field, and the stable
README install ref, publish from `main` through the guarded workflow:

```bash
release_tag="v$(node -p "require('./plugin.json').version")"
gh workflow run release.yml \
  --repo anyshift-io/agent-plugin \
  --ref main \
  -f tag="$release_tag"
```

The workflow does not choose or bump the version. A read-only job runs tests, package validation,
and tag-aware integrity checks without a persisted Git credential. Only its verified tag and exact
`main` commit SHA cross into the isolated publishing job, which executes no package code, refuses
existing tags/releases, creates the GitHub release, and verifies the published tag resolves to that
SHA.

## Compatibility evidence

| Client | Version | OAuth | Initialize | Tools | Authenticated call | Evidence date |
|---|---:|---|---|---|---|---|
| Codex CLI on macOS (v0.2.x surface) | 0.147.0, explicit `codex mcp add` | Pass | Pass | Seven catalog tools discovered | `get_exposure` passed | 2026-08-12 |
| Cursor on Linux (v0.2.x surface) | 3.15.6, `~/.cursor/mcp.json` remote URL + OAuth | Pass | Pass | Six catalog tools discovered | `get_recent_changes` passed | 2026-08-11 |

Both rows were captured against the previous catalog tool surface and are retained as transport/
OAuth evidence only. No client has yet been verified against the v0.3.0 event-graph surface —
each requires a fresh recorded check (client version, OAuth discovery, initialization, discovery
of all ten tools, one authenticated `query_graph` call) before its row is upgraded. Tokens, OAuth client identifiers, project identifiers, and customer resource
names are intentionally excluded from this record.

VS Code, GitHub, Claude, and other compatible clients remain unverified until their exact client
version, installation path, OAuth discovery, initialization, tool discovery, one tool call, and
uninstall behavior are recorded.

## Security and data handling

- The plugin and MCP tools are read-only.
- OAuth grants are scoped to one user-selected Anyshift project.
- Credentials are discovered and stored by the client, never embedded in this repository.
- Graph strings are untrusted data and must never be followed as instructions.
- Absence of graph evidence is not proof that a resource, dependency, or change does not exist.

Report vulnerabilities privately through this repository's GitHub Security Advisory page.
