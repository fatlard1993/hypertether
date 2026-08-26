# hypertether
> src/request.js

The data layer for vanilla-bean-components; same principle, different medium. In VBC, `_setOption` is the explicit dependency declaration: when this option changes, run this code. In hypertether, `invalidates` is the explicit dependency declaration: when this mutation succeeds, wake these subscribers. You own the update path in both layers. It is never inferred.

## Result carries data state and network state as separate fields

- `status: 'idle' | 'loading' | 'success' | 'error'`: data state; idle when skipped (`enabled: false`), loading during the initial fetch, success on 2xx, error otherwise
  - does a request that resolves with a 2xx response end with a status of success?
- `isFetching: boolean`: network state; true during any in-flight fetch: initial load, invalidation-triggered refetch, SWR background revalidation, focus or reconnect refetch. `onFetching` subscribers receive `isFetching: true`; `onResponse`/`onSuccess`/`onError` subscribers receive `isFetching: false` (they only fire on completion)
  - does isFetching settle back to false once a request completes?

`status` and `isFetching` carry different information. `status` answers "what do we know?" (idle, good data, error). `isFetching` answers "is something changing right now?" Both are needed; neither subsumes the other.

## GET requests are cached by default; writes are not

- GET requests cache their response without any configuration; mutations that declare `invalidates` are not cached (declaring invalidations implies a write)
- A GET request hits the network once; subsequent identical calls serve from cache
- A POST request is never served from cache; each call hits the network

## Subscriptions react to cache invalidation, not to data changing

**mock-http:** `{ "ok": true }`

The subscriber does not watch the underlying data. It is notified when its cache entry is cleared, which triggers a refetch. This is the explicit model: the mutation declares what it invalidates, the cache clears, subscribers refetch. No magic dependency tracking; the relationship is named in application code and readable at the call site.

- A subscriber is notified when its cache entry is cleared, triggering a refetch; it does not poll or watch the underlying data directly
  - GET("https://lld.test/watch", { cacheId: "lld-watch", apiId: "lld-watch-api", onResponse: spy }) -> spy called
- a subscriber that was never activated is never notified; nothing fires on a declaration alone
  - GET("https://lld.test/watch-off", { cacheId: "lld-watch-off", apiId: "lld-watch-api", enabled: false, onResponse: spy }) -> spy not called

## Subscriptions can be declared before they are active

Data dependencies can be established at initialization time and activated later. This mirrors VBC's render lifecycle: structure and wiring are declared synchronously; data arrives after.

- Subscriptions are established even when `enabled: false`; data dependencies can be declared at component initialization time and activated later
  - does a request with enabled: false report an idle status rather than loading or error?
- A request with `enabled: false` does not hit the network
  - does a request with enabled: false leave the response empty, having never fetched?

## Invalidation is cascading

**mock-http:** `{ "ok": true }`

A subscriber woken by an invalidation fetches a second time. That second call is the observable
edge of the whole model, so the claims below count it rather than inspecting the cache: what
matters to a caller is that its callback ran again, not that a Map lost a key.

- A successful write with `invalidates` clears all matching cache entries by cacheId or apiId
  - GET("https://lld.test/inv-api", { cacheId: "lld-inv-a", apiId: "lld-inv-api", onResponse: spy }) captures a then POST("https://lld.test/write-a", { invalidates: ["lld-inv-api"] }) captures b -> spy called twice
  - GET("https://lld.test/inv-cache", { cacheId: "lld-inv-c", apiId: "lld-inv-other", onResponse: spy }) captures a then POST("https://lld.test/write-c", { invalidates: ["lld-inv-c"] }) captures b -> spy called twice
- a write naming something else leaves the subscriber alone; invalidation is declared, never inferred
  - GET("https://lld.test/inv-quiet", { cacheId: "lld-quiet", apiId: "lld-quiet-api", onResponse: spy }) captures a then POST("https://lld.test/write-q", { invalidates: ["lld-unrelated"] }) captures b -> spy called once

## select transforms at delivery time; the cache always stores the raw response

**mock-http:** `{ "name": "alpha", "extra": 7 }`

`select` is applied per-call at the point of delivery. Cache entries always hold the raw server response. Each subscriber on a shared `apiId` applies its own select independently. `select` is skipped on error results; user transforms are never called on error bodies.

This matters when multiple subscribers share an endpoint but need different projections of it. The cache pays the cost of one fetch; each subscriber pays only the cost of its own transform. Without this, callers either fetch redundantly or pass raw data through and transform in callbacks, which works, but scatters the transform logic across call sites rather than declaring it alongside the subscription.

`select` earns its place when two or more subscribers on the same `apiId` need different shapes from the same response. For a single subscriber, the transform belongs in `onResponse` directly. Reach for `select` when the duplication of fetching is the problem being solved.

- A call with `select` receives the transformed body; the cache entry retains the raw body
  - does the body delivered to the caller reflect select's return value rather than the raw response?
- Two subscribers on the same `apiId` with different `select` functions each receive their own transformation
  - GET("https://lld.test/shared", { cacheId: "lld-sel-a", apiId: "lld-sel", select: b => b.name }) captures first then GET("https://lld.test/shared", { cacheId: "lld-sel-b", apiId: "lld-sel", select: b => b.extra }) captures second -> second.body === 7
- the first subscriber keeps its own shape after the second one arrives; neither transform is applied to the other's delivery
  - GET("https://lld.test/shared-2", { cacheId: "lld-sel-c", apiId: "lld-sel-2", select: b => b.name }) captures first then GET("https://lld.test/shared-2", { cacheId: "lld-sel-d", apiId: "lld-sel-2", select: b => b.extra }) captures second -> first.body === "alpha"

## select is skipped on error; the raw error body is delivered unchanged

**mock-http:** `{ "status": 500, "body": { "message": "boom" } }`

`select` transforms successful responses only. On an error result the user's transform is never called and the raw error body is delivered unchanged, so a failing request cannot silently produce a select-shaped value the caller would mistake for data.

- a failed request reports an error status
  - GET("https://lld.test/err", { cacheId: "lld-err", apiId: "lld-err-api", select: b => b.name }) captures r -> r.status === "error"
- select is not applied on failure; the caller receives the raw error body unchanged
  - GET("https://lld.test/err2", { cacheId: "lld-err2", apiId: "lld-err-api", select: b => b.name }) captures r -> r.body.message === "boom"

## The response body is parsed by content-type

**mock-http:** `{ "contentType": "text/plain", "body": "raw text payload" }`

The parser dispatches on the response's content-type: `application/json` (and `+json`) is parsed as JSON; `text/*` is delivered as a string; anything else as a blob. The caller receives a value already in the right shape, never a Response to unwrap.

- a `text/plain` response is delivered as a raw string, not JSON-parsed
  - GET("https://lld.test/text", { cacheId: "lld-text", apiId: "lld-text-api" }) captures r -> r.body === "raw text payload"

## apiId is the method; cacheId is the invocation

**mock-http:** `{ "ok": true }`

`apiId` identifies the logical operation: the subject all subscribers care about. `cacheId` identifies a specific invocation with a specific configuration (a particular resource ID, a particular page, a particular sort order). Collapsing the two forces workarounds that belong in the library, not in application code.

For example, two requests for different pages of the same resource share one `apiId` but carry distinct `cacheId`s, so each page caches separately and refetches on its own. A write against that resource declares an invalidation naming the shared `apiId`; it wakes both page subscribers at once, and each refetches only its own page.

- `apiId` is the subscription key: it identifies the logical operation; `cacheId` is the storage key: it identifies a specific invocation with a specific configuration
  - GET("https://lld.test/keys", { enabled: false, apiId: "lld-api", cacheId: "lld-cache" }) captures r -> r.apiId === "lld-api"
  - GET("https://lld.test/keys", { enabled: false, apiId: "lld-api", cacheId: "lld-cache" }) captures r -> r.cacheId === "lld-cache"
- both keys are always resolved, even for a request that never runs: a disabled call still belongs to its subscription group and still names where its response would be stored
  - GET("https://lld.test/disabled-keys", { enabled: false, apiId: "lld-api-2" }) captures r -> r.status === "idle"
- Multiple cacheIds can share one apiId: two requests for different pages resolve the same subscription group while naming separate cache entries
  - GET("https://lld.test/page-1", { enabled: false, apiId: "lld-shared", cacheId: "lld-p1" }) captures a then GET("https://lld.test/page-2", { enabled: false, apiId: "lld-shared", cacheId: "lld-p2" }) captures b -> b.apiId === "lld-shared"
- a write invalidating by apiId clears every cache entry under it simultaneously, waking each page subscriber to refetch only its own page
  - GET("https://lld.test/page-a", { cacheId: "lld-pa", apiId: "lld-pages", onResponse: spy }) captures a then POST("https://lld.test/write-pages", { invalidates: ["lld-pages"] }) captures b -> spy called twice

The perspective above follows one page through the invalidation. The *simultaneously* half -- two
pages under one apiId waking on the same write, each refetching only its own url -- needs two
distinct handlers in one claim, and `spy` is a single reserved identifier. Watching both would take
a second one. Stated here rather than left implied by a claim that only ever watched one page.
