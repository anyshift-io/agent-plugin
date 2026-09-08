# Named analysis recipes (deterministic use cases as Cypher)

These are the curated analyses the previous catalog surface exposed as fixed queries.
On this surface they are recipes: adapt labels/relationship types to what
`describe_schema` returns for the project (vocabulary differs per stack), and keep the
interpretation caveats — the recipe retrieves evidence, it does not prove impact.

Anchor a known resource as `(x:RESOURCE:ALIVE {hashedID: …})`: `hashedID` is indexed on
`RESOURCE`, so a bare `(x:ALIVE {hashedID: …})` or label-less `({hashedID: …})` anchor scans
every live node instead (27 s versus 0.2 s on a large tenant).

Every recipe: current-state queries match `:ALIVE`; event windows wrap bounds in
`datetime()`; add `LIMIT`.

## Event histogram (the open sweep)

What happened in a window, grouped by type — run this BEFORE narrowing to any specific
failure theory; it surfaces fleet-wide waves a targeted query misses.

```cypher
MATCH (e:EVENT)
WHERE e.ts > datetime('2026-09-01T14:00:00Z') AND e.ts < datetime('2026-09-01T15:30:00Z')
RETURN e.type AS type, e.isRoot AS isRoot, count(*) AS n
ORDER BY n DESC LIMIT 50
```

Caveat: counts are evidence of activity, not impact. A high count can be routine churn —
compare against an adjacent quiet window before calling it anomalous.

## SPOF fan-in ranking

Highly shared dependencies (config, identity, nodes) by dependent count.

```cypher
MATCH (w:ALIVE)-[r:MOUNTS_CONFIGMAP|USES_SA|SCHEDULED_ON]->(shared:ALIVE)  // types per describe_schema
RETURN labels(shared) AS kind, shared.name AS name, type(r) AS via, count(DISTINCT w) AS dependents
ORDER BY dependents DESC LIMIT 25
```

Keep the types in the pattern, not in a `WHERE type(r) IN […]` on an untyped `[r]`: the
untyped form scans every edge (14 s vs 5 s on a large tenant).

Caveat: fan-in is exposure, not fragility — a 200-pod node is normal; a 200-workload
ConfigMap is a blast-radius concentrator.

## Orphans / dangling resources

Resources of a kind with no live inbound relationship of the kinds that would use them.

```cypher
MATCH (c:K8S_CONFIGMAP:ALIVE)
WHERE NOT ( (:ALIVE)-[:MOUNTS_CONFIGMAP]->(c) )
RETURN c.namespace AS ns, c.name AS name LIMIT 100
```

Caveat: "no stored edge" ≠ "unused" — usage paths outside graph coverage (env-var refs,
operators) won't appear. Report as candidates, not verdicts.

## Co-tenancy (shared node)

```cypher
MATCH (p:RESOURCE:ALIVE {hashedID: $pod})-[:SCHEDULED_ON]->(n:ALIVE)<-[:SCHEDULED_ON]-(other:ALIVE)
WHERE other <> p
RETURN n.name AS node, collect(DISTINCT other.name)[..50] AS cotenants
```

## Shared-config coupling

```cypher
MATCH (a:RESOURCE:ALIVE {hashedID: $workload})-[:MOUNTS_CONFIGMAP]->(cm:ALIVE)<-[:MOUNTS_CONFIGMAP]-(b:ALIVE)
WHERE a <> b
RETURN cm.name AS configmap, collect(DISTINCT b.name) AS coupled
```

## Deploy-impact join

Deployments followed by failure-class events on the same target.

```cypher
MATCH (d:EVENT) WHERE d.type IN ['deployment_image_rotated','update_function_code']  // per describe_schema
  AND d.ts > datetime('2026-09-01T00:00:00Z')
MATCH (f:EVENT) WHERE f.targetHashedID = d.targetHashedID
  AND f.ts > d.ts AND f.ts < d.ts + duration('PT2H')
  AND f.type IN ['pod_oom_killed','pod_crash_looping','alert_triggered']
RETURN d.type, d.ts, f.type, f.ts, f.targetHashedID ORDER BY d.ts DESC LIMIT 50
```

Caveat: temporal adjacency is a lead, not causation — say so when reporting.

## Common cause behind recent failures

```cypher
MATCH (f:EVENT) WHERE f.ts > datetime('2026-09-01T14:00:00Z')
  AND f.type IN ['pod_oom_killed','pod_failed_scheduling','node_not_ready']
MATCH (r:RESOURCE {hashedID: f.targetHashedID})-[:SCHEDULED_ON|RUNS_ON*0..1]->(shared)
RETURN shared.name AS candidate, count(DISTINCT f) AS failures, collect(DISTINCT f.type) AS types
ORDER BY failures DESC LIMIT 20
```

## Blast-radius-style traversal (bounded)

```cypher
MATCH p = (start:RESOURCE:ALIVE {hashedID: $hashedID})<-[:CONTROLS|MANAGES|SCHEDULED_ON|EXPOSES|ROUTES_TO|MOUNTS_CONFIGMAP|USES_SA|CLAIMS|CALLS_TO|USES_DATASTORE|RUNS_ON|ATTACHES|USES*1..3]-(dependent:ALIVE)
RETURN dependent.name AS name, labels(dependent) AS kind, length(p) AS hops
ORDER BY hops LIMIT 200
```

Caveats (important): seed by `hashedID` (from `find_resources`), never by name — the same
name exists across namespaces, clusters and kinds, and a name seed merges every match into
one fake blast radius. Keep the relationship list explicit (take it from
`describe_schema`): an unqualified `[*1..3]` traverses EVERY stored edge type, including
weak/annotational ones, and from a hub such as a node it does not finish (timed out at
130 s on a large tenant; the typed form returns in 0.2 s). Reachability here means
"connected in the graph", NOT "will fail if start fails"; keep depth ≤3 and report as
potential reachability with the edge types named.

## Correlated incident chain

Prefer `get_correlated_events` with a `correlation_id` picked off an event. Cypher form:

```cypher
MATCH (e:EVENT {correlationId: $cid})
RETURN e.type, e.ts, e.isRoot, e.summary ORDER BY e.ts LIMIT 200
```

## Public exposure trace (edge → workload)

How does a public hostname reach a workload, and what controls sit on it? The exposure
layer exists only when the project has the Cloudflare and/or cloud integrations
(`describe_schema` lists `CLOUDFLARE_HOSTNAME`, `ELASTICLOADBALANCING_LOADBALANCER`,
`K8S_INGRESS` when it does). Forward, from a hostname:

```cypher
MATCH (h:CLOUDFLARE_HOSTNAME:ALIVE {name: 'app.example.com'})
OPTIONAL MATCH edge = (h)-[:PROXIES_TO|RESOLVES_DIRECTLY_TO|ROUTES_THROUGH|FRONTS]->(entry:ALIVE)
// entry is a K8S_INGRESS (→ service → pods → workload) or a cloud load balancer
// (→ target group → ECS service / instances); both continuations are optional.
OPTIONAL MATCH (entry)-[:ROUTES_TO]->(:K8S_SERVICE:ALIVE)-[:EXPOSES]->(:K8S_POD:ALIVE)<-[:CONTROLS|MANAGES*1..2]-(w:ALIVE)
WHERE w:K8S_DEPLOYMENT OR w:K8S_STATEFULSET OR w:K8S_DAEMONSET
OPTIONAL MATCH (entry)-[:CONTAINS]->(:ELASTICLOADBALANCING_TARGETGROUP:ALIVE)-[:TARGETS]->(target:ALIVE)
OPTIONAL MATCH (control:ALIVE)-[c:APPLIES_TO|PROTECTS|TERMINATES_TLS_FOR|DEFINES]->(h)
RETURN h.name AS hostname,
       [r IN relationships(edge) | type(r)] AS hop, entry.name AS entryPoint,
       coalesce(entry.kind, [l IN labels(entry) WHERE NOT l IN ['RESOURCE','ALIVE','CLOUD_RESOURCE','CLOUD','RESOURCE_INSTANCE','K8S_RESOURCE']][0]) AS entryKind,
       collect(DISTINCT w.namespace + '/' + w.name)[0..20] AS workloads,
       collect(DISTINCT coalesce(target.name, target.hashedID))[0..20] AS cloudTargets,
       collect(DISTINCT type(c) + ':' + coalesce(control.name, control.hashedID))[0..20] AS controls
```

`controls` can be large (one Cloudflare hostname carried 1,077 `APPLIES_TO` rules on a
real tenant): the slice keeps the payload bounded — group by `type(c)` with a count when you
need the full picture.

Reverse, from a workload ("is this reachable from the internet?"):

```cypher
MATCH (w:RESOURCE:ALIVE {hashedID: '<workload hashedID>'})
MATCH (w)-[:CONTROLS|MANAGES*1..2]->(p:K8S_POD:ALIVE)<-[:EXPOSES]-(svc:K8S_SERVICE:ALIVE)
OPTIONAL MATCH (ing:K8S_INGRESS:ALIVE)-[:ROUTES_TO]->(svc)
OPTIONAL MATCH (h:CLOUDFLARE_HOSTNAME:ALIVE)-[:FRONTS|PROXIES_TO|ROUTES_THROUGH]->(ing)
RETURN svc.name AS service, svc.type AS serviceType,
       collect(DISTINCT ing.name) AS ingresses, collect(DISTINCT h.name) AS publicHostnames
```

Caveat: an empty `publicHostnames` means no *stored* route, not "private" — a LoadBalancer
Service, a NodePort, or a hostname managed outside the connected Cloudflare account are
all invisible here. Say which layers you searched. Edge names differ by stack
(`PROXIES_TO` vs `RESOLVES_DIRECTLY_TO` vs `FRONTS`): take them from `describe_schema`.

## Shortest path between two resources

"How is A connected to B?" over topology edges only (event and history edges excluded).

```cypher
MATCH (a:RESOURCE:ALIVE {hashedID: '<hashedID A>'}), (b:RESOURCE:ALIVE {hashedID: '<hashedID B>'})
MATCH p = shortestPath((a)-[:CONTROLS|MANAGES|SCHEDULES|SCHEDULED_ON|EXPOSES|ROUTES_TO|MOUNTS_CONFIGMAP|READS_ENV_FROM_CONFIGMAP|USES_SA|GRANTS_ROLE|BINDS_SUBJECT|SCALES|CLAIMS|BOUND_TO|CALLS_TO|USES_DATASTORE|PRODUCES_TO|CONSUMED_BY|RUNS_ON|CONTAINS|ATTACHES|USES*..5]-(b))
WHERE all(n IN nodes(p) WHERE n:ALIVE)
RETURN [n IN nodes(p) | coalesce(n.name, n.hashedID)] AS via,
       [r IN relationships(p) | type(r)] AS edges, length(p) AS hops
```

Caveat: anchor BOTH ends by `hashedID` (from `find_resources`) — a node predicate on either
end forces an exhaustive expansion that runs for tens of seconds on a dense graph. A path
is connectivity, not causality; `CONTAINS`/`ATTACHES` hops through a VPC or node connect
almost everything, so read `edges` before drawing a conclusion. No path within 5 hops is
"not connected within 5 topology hops", nothing more.

## RBAC reach

Which service accounts carry cluster-wide power, and which workloads run as them.

```cypher
MATCH (sa:K8S_SERVICEACCOUNT:ALIVE)
WITH sa, COUNT { (sa)<-[:BINDS_SUBJECT]-(:K8S_CLUSTERROLEBINDING:ALIVE) } AS clusterBindings,
     COUNT { (sa)<-[:BINDS_SUBJECT]-(:ALIVE) } AS bindings
WHERE bindings > 0
ORDER BY clusterBindings DESC, bindings DESC LIMIT 25
MATCH (sa)<-[:BINDS_SUBJECT]-(rb:ALIVE)-[:GRANTS_ROLE]->(role:ALIVE)
WITH sa, clusterBindings, bindings,
     collect(DISTINCT rb.kind + '/' + rb.name + ' -> ' + role.kind + '/' + role.name)[0..5] AS sampleGrants
OPTIONAL MATCH (w:ALIVE)-[:USES_SA]->(sa)
WHERE w:K8S_DEPLOYMENT OR w:K8S_STATEFULSET OR w:K8S_DAEMONSET OR w:K8S_CRONJOB
RETURN sa.clusterID AS cluster, sa.namespace + '/' + sa.name AS serviceAccount,
       clusterBindings, bindings, sampleGrants,
       collect(DISTINCT w.namespace + '/' + w.name)[0..10] AS workloads
ORDER BY clusterBindings DESC, bindings DESC
```

Rank on degree counts first, expand bindings and workloads only for the top N — expanding
every service account first is 30× slower on a multi-cluster tenant. Keep `clusterID` in
the output: the same `namespace/name` exists once per cluster.

Caveat: a ClusterRoleBinding to a namespaced Role, or a Role named `admin` that only
grants `get`, are not "cluster-admin" — the rules live on the role node's properties
(`get_resource_details` on the role), not in the edge. Rank, then read the rules.

## Kubernetes hygiene gaps (one shape, six checks)

"Workloads without X" is one query shape: match the workload, exclude the guarding edge.

```cypher
// Deployments / StatefulSets with no PodDisruptionBudget protecting any of their pods.
// Walk UP from the (few) protected pods to their workloads, then subtract — expanding
// every workload down to its pods is 5× slower on a large tenant.
OPTIONAL MATCH (:K8S_PDB:ALIVE)-[:PROTECTS]->(:K8S_POD:ALIVE)<-[:CONTROLS|MANAGES*1..2]-(pw:ALIVE)
WHERE pw:K8S_DEPLOYMENT OR pw:K8S_STATEFULSET
WITH collect(DISTINCT pw) AS protected  // [] when no PDB exists, so every workload is listed
MATCH (w:ALIVE)
WHERE (w:K8S_DEPLOYMENT OR w:K8S_STATEFULSET) AND NOT w IN protected
RETURN w.clusterID AS cluster, w.namespace AS namespace, w.kind AS kind, w.name AS name
ORDER BY cluster, namespace, name LIMIT 100
```

Mind operator precedence in these: `w:A OR w:B AND NOT …` parses as `w:A OR (w:B AND NOT …)`
and silently returns every `A`. Parenthesize the label disjunction.

```cypher
// Deployments with no HorizontalPodAutoscaler
MATCH (w:K8S_DEPLOYMENT:ALIVE) WHERE NOT (w)<-[:SCALES]-(:K8S_HPA:ALIVE)
RETURN w.namespace AS namespace, w.name AS name, w.replicas AS replicas ORDER BY namespace, name LIMIT 100
```

```cypher
// Pods running with no PriorityClass (first to be evicted under node pressure)
MATCH (p:K8S_POD:ALIVE) WHERE NOT (p)-[:HAS_PRIORITY]->(:K8S_PRIORITYCLASS:ALIVE)
RETURN p.namespace AS namespace, count(*) AS podsWithoutPriority ORDER BY podsWithoutPriority DESC LIMIT 50
```

```cypher
// Namespaces whose pods are covered by no NetworkPolicy at all
MATCH (p:K8S_POD:ALIVE)
WITH p.clusterID AS cluster, p.namespace AS namespace, count(*) AS pods,
     count(CASE WHEN EXISTS { (:K8S_NETWORKPOLICY:ALIVE)-[:APPLIES_TO]->(p) } THEN 1 END) AS covered
WHERE covered = 0
RETURN cluster, namespace, pods ORDER BY pods DESC LIMIT 50
```

```cypher
// Unclaimed PVCs (no pod mounts them) and PVCs bound to nothing
MATCH (pvc:K8S_PVC:ALIVE)
OPTIONAL MATCH (pvc)-[:BOUND_TO]->(pv:K8S_PV:ALIVE)
WITH pvc, pv, EXISTS { (:K8S_POD:ALIVE)-[:CLAIMS]->(pvc) } AS claimed
WHERE NOT claimed OR pv IS NULL
RETURN pvc.namespace AS namespace, pvc.name AS pvc, claimed, pv.name AS boundPV, pvc.storageClass AS storageClass
ORDER BY namespace, pvc LIMIT 100
```

```cypher
// Image inventory: which images run where (tag drift, unpinned :latest, rogue registries)
MATCH (p:K8S_POD:ALIVE)-[:HAS_CONTAINER]->(c:K8S_CONTAINER:ALIVE)
WHERE c.image IS NOT NULL
RETURN c.image AS image, count(DISTINCT p) AS pods, collect(DISTINCT p.namespace)[0..5] AS namespaces
ORDER BY pods DESC LIMIT 50
```

Caveat: absence of the guarding edge is absence *in the graph*. A PDB whose selector
matches no pod, or an HPA on a custom resource the agent does not watch, both read as a
gap here. Check `describe_schema` for the label (`K8S_PDB`, `K8S_HPA`, `K8S_NETWORKPOLICY`,
`K8S_PRIORITYCLASS`) before reporting "none configured": if the label is absent, the
project has no data for that kind, which is not the same finding. Property names
(`replicas`, `storageClass`, `image`) are per-source: confirm with `get_resource_details`
on one node first.

## Hotspots (noisiest resources in a window)

Which resources changed the most, by event type — churn concentrates on a few targets.

```cypher
MATCH (e:EVENT)-[:CHANGED]->(r)
WHERE e.ts > datetime('2026-09-01T14:00:00Z') AND e.ts < datetime('2026-09-01T15:00:00Z')
RETURN coalesce(r.namespace + '/', '') + coalesce(r.name, r.hashedID) AS target, r.kind AS kind,
       count(*) AS events, collect(DISTINCT e.type)[0..5] AS eventTypes
ORDER BY events DESC LIMIT 25
```

Caveat: a hotspot is where change lands, not where it originates — a Deployment that
rolls every commit is noisy by design. Pair with the event histogram and `get_correlated_events`
to separate routine churn from a wave. Keep the window to about an hour and widen only if
it is quiet: this walks every event in the range, and a large tenant produces ~100k events
an hour (measured: 1 h ≈ 0.5 s, 6 h ≈ 110 s, i.e. the query timeout). Add `AND e.type = '…'`
to look at one kind of change over a longer span.
