# Anyshift Production Intelligence

A portable [Agent Plugins 1.0.0](https://agent-plugins.org/specification) package that gives
compatible agent clients fast, deterministic, read-only production evidence from Anyshift over
[MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28).

The package combines one Agent Skill with a Streamable HTTP MCP configuration. It embeds no token,
authorization header, project identifier, or database name. Compatible clients discover OAuth,
collect consent for one Anyshift project, and store credentials themselves.

## Status

Published versions are listed in [GitHub Releases](https://github.com/anyshift-io/anyshift-production-intelligence/releases),
and each package release remains gated on production verification of its matching Graph API support.
The portable package validates against Agent Plugins 1.0.0, and the production endpoint has passed
OAuth discovery, MCP connection, discovery of all six tools, and authenticated read-only calls from
Codex CLI 0.147.0 and Cursor 3.15.6. See [Compatibility evidence](#compatibility-evidence) for the
precise boundary of that claim.

## MCP protocol compatibility

The production endpoint at `https://graph.anyshift.io/mcp` supports the stateless Streamable HTTP
transport defined by MCP `2026-07-28`. Modern requests are self-contained and carry the negotiated
protocol version, client metadata, method, and tool name on every request. The endpoint also retains
legacy MCP compatibility through `2025-11-25` for clients that still use initialization negotiation.

Authorization follows the MCP HTTP authorization profile: the server publishes OAuth protected
resource metadata, challenges unauthenticated requests, and binds the resulting `graph:read` grant
to one user-selected Anyshift project.

## Capabilities

- resolve ambiguous infrastructure resources;
- inspect direct dependencies and bounded transitive blast radius;
- correlate recent changes with topology;
- assess evidence-backed operational impact; and
- use the constrained Graph query language for deterministic capabilities without a dedicated
  tool.

This plugin supplies production graph evidence to an agent already doing a task. It is not an
autonomous SRE agent and does not contain an incident-response loop.

## Install

Agent Plugins clients can load this repository root directly. They discover the portable
`plugin.json`, `mcp.json`, and `skills/` components. OAuth and project consent are handled by the
client; the package contains no credentials or project identifiers.

### Codex CLI

Codex 0.147.0 or newer is recommended:

```bash
codex plugin marketplace add anyshift-io/anyshift-production-intelligence --ref main
codex plugin add anyshift-production-intelligence@anyshift
codex mcp add anyshift-production-intelligence --url https://graph.anyshift.io/mcp
```

The final command is required by Codex CLI 0.147.0 because its plugin installer does not yet launch
OAuth for a plugin-owned remote MCP server. It opens the browser OAuth flow; select the Anyshift
project the plugin may read. Start a new Codex thread after installation so the skill and MCP tools
are loaded together.

Codex CLI 0.147.0 may also log an `Auth required` warning for the unauthenticated portable MCP
entry while using the explicitly registered authenticated connection. Tool discovery and calls are
unaffected; no unauthenticated request can read graph data.

### Cursor

Cursor 3.15.6 or newer is recommended. Cursor supports Agent Plugins and remote Streamable HTTP MCP
with OAuth. The verified install path below registers the Graph MCP endpoint in the user MCP config
and completes browser OAuth plus project consent.

#### Verified path: user MCP config

Add the server to `~/.cursor/mcp.json` (merge with any existing `mcpServers` entries):

```json
{
  "mcpServers": {
    "anyshift-production-intelligence": {
      "url": "https://graph.anyshift.io/mcp"
    }
  }
}
```

Or register the same remote URL through the Cursor CLI:

```bash
cursor --add-mcp '{"name":"anyshift-production-intelligence","url":"https://graph.anyshift.io/mcp"}'
```

Then authenticate when Cursor prompts (`needsAuth` / `mcp_auth`), select the Anyshift project the
plugin may read, and start a new agent chat so the six Graph tools are available.

This URL-only config is enough for OAuth, tool discovery, and authenticated reads. Package
attribution headers are not part of the Cursor install snippet; the portable package `mcp.json`
supplies them by default when you install the Agent Plugin (see below).

#### Optional: local Agent Plugin package

To load the portable `plugin.json`, `mcp.json`, and `skills/` package from disk while developing:

```bash
git clone https://github.com/anyshift-io/anyshift-production-intelligence.git \
  ~/.cursor/plugins/local/anyshift-production-intelligence
```

Reload the Cursor window (`Developer: Reload Window`). Cursor discovers Agent Plugins from
`~/.cursor/plugins/local`. The package `mcp.json` already includes the attribution headers, so you
do not need to copy them into `~/.cursor/mcp.json`. Complete OAuth for the Graph MCP server if it
is not already authenticated.

Do not symlink a checkout from outside `~/.cursor/plugins/local` into that directory. Cursor 3.15.6
rejects out-of-tree local plugin symlink targets and skips the package.

#### Uninstall (Cursor)

1. Remove the `anyshift-production-intelligence` entry from `~/.cursor/mcp.json` (or the matching
   entry created by `cursor --add-mcp` under Cursor settings MCP servers).
2. If you installed the local package, delete
   `~/.cursor/plugins/local/anyshift-production-intelligence`.
3. Reload the Cursor window.

#### Cursor caveats

- Prefer either the user MCP config path or the local Agent Plugin package, not both at once.
  Installing both registers two Cursor MCP clients against the same Graph endpoint and can clear
  stored OAuth credentials when one of them is removed.
- Attribution headers are not required for OAuth or tool calls on the user MCP path. Prefer the
  local Agent Plugin package when you want package attribution by default.
- Cursor's verified remote MCP shape uses a `url` field. Cursor connects over Streamable HTTP and
  runs OAuth when the endpoint challenges. The portable package `mcp.json` keeps the Agent Plugins
  `type: "streamable-http"` form for cross-client portability; Cursor accepts that package form when
  loading the local Agent Plugin.
- `cursor --add-mcp` writes into Cursor settings MCP servers; editing `~/.cursor/mcp.json` is the
  file-based path documented above. Both can register the same remote endpoint.
- While unauthenticated, Cursor may expose a client-side `mcp_auth` helper alongside the Graph
  tools. That helper is not part of the Graph API tool surface.
- Cursor Marketplace one-click install is not verified for this package yet.
- Local plugin symlinks whose target is outside `~/.cursor/plugins/local` are rejected.

## Usage attribution

Compatible Agent Plugin clients send a fixed, non-secret package name and version with Graph MCP requests. Anyshift uses this declaration for aggregate product usage and reliability telemetry in PostHog and request diagnostics in Sentry. It is not used for authentication, authorization, tenant selection, or rate-limit identity, and the package contains no credentials.

Codex CLI 0.147.0 installs the skill but requires a separate `codex mcp add` command. That separately configured connection may not forward the package headers, so Anyshift can identify the Codex MCP and OAuth clients without claiming exact plugin attribution for those requests.

On Cursor, install the local Agent Plugin package when you want package attribution by default.
A URL-only `~/.cursor/mcp.json` entry still works for OAuth and tool use without those headers.

## Resource identity

Graph resource names are not globally unique. For example, one deployment name can identify both a
Terraform `STATE_RESOURCE` and the runtime `ECS_SERVICE` it manages. For short, overloaded, or
same-named resources:

1. call `resolve_resource`;
2. select the candidate with the intended resource type; and
3. pass that candidate's stable `id` as the `resource` argument to subsequent tools or constrained
   queries.

An unqualified name-only query remains deterministic, but it can select a different same-named
resource kind. Using the resolved stable identifier preserves the selected identity without placing
project IDs, database names, or credentials in tool arguments.

## Validate

```bash
npm ci
npm run validate
```

The validator loads the immutable canonical Agent Plugins 1.0.0 schemas, checks the complete
package layout, rejects symlinks and credential-bearing MCP configuration, and verifies the skill's
untrusted-data boundary.

## Compatibility evidence

| Client | Version | OAuth | Initialize | Tools | Authenticated call | Evidence date |
|---|---:|---|---|---|---|---|
| Codex CLI on macOS | 0.147.0, explicit `codex mcp add` | Pass | Pass | Six tools discovered | `get_recent_changes` passed | 2026-08-08 |
| Cursor on Linux | 3.15.6, `~/.cursor/mcp.json` remote URL + OAuth | Pass | Pass | Six tools discovered | `get_recent_changes` passed | 2026-08-11 |

The verified tools are `resolve_resource`, `get_dependencies`, `get_blast_radius`,
`get_recent_changes`, `get_operational_impact`, and `query_graph`. The authenticated call returned
structured production evidence with a current evidence timestamp. Tokens, OAuth client identifiers,
project identifiers, and customer resource names are intentionally excluded from this record.

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
