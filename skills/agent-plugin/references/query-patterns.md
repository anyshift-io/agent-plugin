# Production evidence tool map

Map the **kind of evidence** you need to the tool that retrieves it. Tools return facts;
**the agent draws all conclusions**. Do not treat this file as an RCA playbook or a
mandatory diagnosis step list, and do not encode alert-specific conclusion recipes.

## Standard retrieval flow

1. `describe_schema` — once per session; the project's live vocabulary.
2. `find_resources` — turn a human name/fragment into ranked candidates with stable
   `hashedID`s. If more than one candidate remains plausible, present them and ask the
   user to choose instead of silently selecting one.
3. Drill down by evidence kind:
   - `get_resource_details` for one resource's properties + relationships;
   - `get_resource_events` (`ref`/`refs` + `from`/`to` window, `type`/`source` filters) for its change history;
   - `get_related` for its graph neighborhood — read the NEIGHBOURHOOD SUMMARY block
     first (exact edge counts per relationship type from the degree store), then drill
     into one type with `relationship_types` + a higher `limit`; event edges are
     summarized only (`get_resource_events` lists them);
   - `get_correlated_events` for a full incident chain from a `correlationId`;
   - `get_recent_events` for the project-wide feed — `since`+`until` give a two-sided
     window; `type`/`source`/`label`/`only_root`/`exclude_noise_classes` cut volume
     semantically. Prefer narrowing both window ends over raising `limit`.
4. `query_graph` for anything the dedicated tools don't shape — one read-only Cypher
   statement. See [recipes.md](recipes.md) for named analyses (event histogram, SPOF
   fan-in, orphans, deploy-impact, co-tenancy, bounded blast radius).

## Argument mechanics (retrieval only)

- Pass `hashedID`s from `find_resources` results, never guessed ids.
- Turn calendar phrases such as "yesterday" into explicit RFC 3339 bounds wrapped in
  `datetime()` in the user's timezone, and state the timezone in the final answer.
- `get_recent_events` root-only filtering hides non-root events by design — when you use
  it, ALSO run an ungated event histogram (recipes.md) before concluding a window was
  quiet.
- `query_graph` results are capped; a truncation note tells you when. Narrow the query or
  paginate with `ORDER BY` + `SKIP`/`LIMIT` (`SKIP` without `ORDER BY` is not stable).
- Structured tools (`find_resources`, `get_*_events`, `get_related`) carry a `limit`
  parameter and NO more-available signal: **a result with exactly `limit` rows must be
  treated as possibly capped** — raise `limit` or narrow the `since` window and re-check
  before treating any count as complete. Prefer window-narrowing over big limits.

## Reporting discipline

- Cite `hashedID`s and event timestamps for every load-bearing claim.
- Distinguish observed platform events from provider API records when it matters.
- An empty result is not proof of absence — say what you searched and its bounds.
- Do not claim causality from temporal proximity alone.
