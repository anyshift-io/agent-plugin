# Graph evidence patterns

## Choose a dedicated tool first

| Decision | Tool | Interpretation |
|---|---|---|
| Which resource does this human name identify? | `resolve_resource` | Candidate identity, not a guess |
| What directly connects to this resource? | `get_dependencies` | Direct upstream and downstream evidence |
| What could be reached if this changes or fails? | `get_blast_radius` | Bounded transitive reachability, not guaranteed failure |
| What changed recently? | `get_recent_changes` | Observed time-windowed events |
| What could this change affect operationally? | `get_operational_impact` | Reviewed directional impact edges |
| Which deterministic capability lacks a dedicated tool? | `query_graph` | Constrained read-only query language |

Do not use direct dependencies as a synonym for blast radius. Do not use blast radius as proof that
every reachable node will fail.

## Resolve before traversing

Resolve names that are short, overloaded, or shared across namespaces and resource kinds. If more
than one candidate remains plausible, present the candidates and ask the user to choose instead of
silently selecting one.

## Correlate changes conservatively

For incident and deployment questions:

1. inspect direct or transitive topology for the named resource;
2. request recent changes with the narrowest useful time window;
3. match stable identifiers, namespaces, and timestamps;
4. distinguish an observed correlated change from an established root cause.

## Bounded query language

`query_graph` accepts one constrained `SELECT` statement, not Cypher and not natural language.
Prefer a small `LIMIT` and the narrowest supported filters. Never submit multiple statements,
comments, mutations, or credentials.

Examples:

```sql
SELECT * FROM connections WHERE resource = checkout LIMIT 50
SELECT * FROM events WHERE resource = checkout AND since = 2h LIMIT 20
SELECT count(*) FROM resources WHERE type = service
```

If a query is rejected, revise it using the public catalog reported by the tool error. Do not try
to evade parser limits.

