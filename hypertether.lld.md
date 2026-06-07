# hypertether

HTTP client with integrated caching and subscriptions. The data layer for vanilla-bean-components; same principle, different medium. In VBC, `_setOption` is the explicit dependency declaration: when this option changes, run this code. In hypertether, `invalidates` is the explicit dependency declaration: when this mutation succeeds, wake these subscribers. You own the update path in both layers. It is never inferred.

## Subscription key and cache key are separate identities

`apiId` identifies the logical operation: the subject all subscribers care about. `cacheId` identifies a specific invocation with a specific configuration (a particular resource ID, a particular page, a particular sort order). These are not the same thing and collapsing them forces workarounds that belong in the library, not in application code.

One write can wake every subscriber sharing an `apiId` while each subscriber independently refetches its own URL with its own parameters. This is how paginated queries, multi-variant resources, and conditional fetching work without manual wiring.

```js
// Two pages: separate cache entries, shared subscription group
GET('/users', { apiId: 'users', cacheId: 'users-page-1', searchParameters: { page: 1 } });
GET('/users', { apiId: 'users', cacheId: 'users-page-2', searchParameters: { page: 2 } });

// One write wakes both subscribers; each refetches its own URL
POST('/users', { body: newUser, invalidates: ['users'] });
```

## Result carries data state and network state as separate fields

- `status: 'idle' | 'loading' | 'success' | 'error'`: data state; idle when skipped (`enabled: false`), loading during the initial fetch, success on 2xx, error otherwise
- `isFetching: boolean`: network state; true during any in-flight fetch: initial load, invalidation-triggered refetch, SWR background revalidation, focus or reconnect refetch. `onFetching` subscribers receive `isFetching: true`; `onResponse`/`onSuccess`/`onError` subscribers receive `isFetching: false` (they only fire on completion)

`status` and `isFetching` carry different information. `status` answers "what do we know?" (idle, good data, error). `isFetching` answers "is something changing right now?" Both are needed; neither subsumes the other.

## GET requests are cached by default; writes are not

- GET requests cache their response without any configuration; mutations that declare `invalidates` are not cached (declaring invalidations implies a write)
- A GET request hits the network once; subsequent identical calls serve from cache
- A POST request is never served from cache; each call hits the network

## Subscriptions react to cache invalidation, not to data changing

The subscriber does not watch the underlying data. It is notified when its cache entry is cleared, which triggers a refetch. This is the explicit model: the mutation declares what it invalidates, the cache clears, subscribers refetch. No magic dependency tracking; the relationship is named in application code and readable at the call site.

- A subscriber is notified when its cache entry is cleared, triggering a refetch; it does not poll or watch the underlying data directly

## Subscriptions can be declared before they are active

Data dependencies can be established at initialization time and activated later. This mirrors VBC's render lifecycle: structure and wiring are declared synchronously; data arrives after.

- Subscriptions are established even when `enabled: false`; data dependencies can be declared at component initialization time and activated later
- A request with `enabled: false` does not hit the network

## Invalidation is cascading

- A successful write with `invalidates` clears all matching cache entries by cacheId or apiId

## select transforms at delivery time; the cache always stores the raw response

`select` is applied per-call at the point of delivery. Cache entries always hold the raw server response. Each subscriber on a shared `apiId` applies its own select independently. `select` is skipped on error results; user transforms are never called on error bodies.

This matters when multiple subscribers share an endpoint but need different projections of it. The cache pays the cost of one fetch; each subscriber pays only the cost of its own transform. Without this, callers either fetch redundantly or pass raw data through and transform in callbacks, which works, but scatters the transform logic across call sites rather than declaring it alongside the subscription.

`select` earns its place when two or more subscribers on the same `apiId` need different shapes from the same response. For a single subscriber, the transform belongs in `onResponse` directly. Reach for `select` when the duplication of fetching is the problem being solved.

- A call with `select` receives the transformed body; the cache entry retains the raw body
- Two subscribers on the same `apiId` with different `select` functions each receive their own transformation
- `select` is not called when the request fails; the raw error body is delivered unchanged

## apiId is the method; cacheId is the invocation

- `apiId` is the subscription key: it identifies the logical operation; `cacheId` is the storage key: it identifies a specific invocation with a specific configuration
- Multiple cacheIds can share one apiId; a write invalidating by apiId clears all of them simultaneously
