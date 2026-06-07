# hypertether

The data layer for framework-free JavaScript. Reactive subscriptions, automatic cache invalidation, and pagination, built on `fetch`. Zero dependencies.

```sh
npm install @vanilla-bean/hypertether   # or: bun add @vanilla-bean/hypertether
```

**ESM only.** Requires an ES module environment (`"type": "module"` in package.json, or a bundler). CommonJS `require()` is not supported.

**Who this is for:** vanilla JS, web components, and any architecture where you own the reactivity directly. If you're using React, Vue, or Svelte, those ecosystems have their own fetch hooks integrated with their render cycles. This library is what you reach for when your ecosystem doesn't provide one.

## The Core Idea

**Subscription key and cache key are separate identities.**

`apiId` identifies a logical operation: the subject all subscribers care about. `cacheId` identifies a specific invocation with a specific configuration (a particular resource ID, a particular page, a particular sort). One write can wake every subscriber sharing an `apiId` while each subscriber independently refetches its own URL with its own parameters.

This separation is what makes paginated queries, multi-variant resources, and conditional fetching work without manual wiring:

```js
// Two pages: separate cache entries, shared subscription group
await GET('/users', { apiId: 'users', cacheId: 'users-page-1', searchParameters: { page: 1 } });
await GET('/users', { apiId: 'users', cacheId: 'users-page-2', searchParameters: { page: 2 } });

// One write wakes both subscribers; each refetches its own URL
await POST('/users', { body: newUser, invalidates: ['users'] });
```

## Quick Start

```js
import { GET, POST, PATCH, DELETE, configure } from '@vanilla-bean/hypertether';

// Global config: set once at app init
configure({
	fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
	refetchOnWindowFocus: true,
	refetchOnReconnect: true,
});

// Subscribe to data: fires on load, on every revalidation, and after mutations
await GET('/users', {
	apiId: 'users',
	onSuccess: result => renderUsers(result.body),
	onError: result => showError(result.body),
});

// Mutate: subscribers refetch automatically
await POST('/users', {
	body: { name: 'Alice' },
	invalidates: ['users'],
});
```

**Without this library** (manual cache management):

```js
const users = await fetch('/users').then(r => r.json());
renderUsers(users);
// Later, after mutation...
await fetch('/users', { method: 'POST', body: JSON.stringify(newUser) });
const updated = await fetch('/users').then(r => r.json());
renderUsers(updated); // easy to forget, easy to get the timing wrong
```

**With this library:** declare the relationship once, let invalidation handle the rest:

```js
await GET('/users', { apiId: 'users', onSuccess: result => renderUsers(result.body) });
await POST('/users', { body: newUser, invalidates: ['users'] }); // renderUsers fires automatically
```

## Key Features

- **Four reactive hooks:** `onFetching` before the response, `onResponse` on any completion, `onSuccess` on 2xx, `onError` on failure; each creates a subscription
- **Full loading state:** `status: 'loading'` on initial fetch; `isFetching: true` whenever a refetch is in flight
- **Cache invalidation:** `invalidates: ['id']` on a mutation clears matching entries and triggers subscriber refetches
- **`select`:** transform the response body at delivery time; cache always stores raw data
- **Stale-while-revalidate:** serve cached data immediately, push fresh data when the background fetch lands
- **Optimistic updates:** apply changes before the server confirms them; roll back on failure via `onMutate` / `onSettled`
- **Focus and reconnect refetch:** opt-in automatic revalidation on tab visibility change and network reconnect
- **Request cancellation:** `resetRequest()` aborts all in-flight requests immediately
- **Non-throwing errors:** HTTP errors are captured in `result.status`; nothing throws on 4xx/5xx
- **Zero dependencies**

## Core Concepts

### `apiId` vs `cacheId`

| ID | Purpose | Default | When to customize |
| --- | --- | --- | --- |
| `apiId` | Subscription group key | `method + originalUrl` | When you want a mutation to wake subscribers across multiple URLs |
| `cacheId` | Cache storage key | `method + finalUrl` | When the same logical resource is fetched at different URLs |

```js
// Three pages share a subscription group; invalidating 'users' wakes all three
await GET('/users', { apiId: 'users', cacheId: 'users-page-1', searchParameters: { page: 1 } });
await GET('/users', { apiId: 'users', cacheId: 'users-page-2', searchParameters: { page: 2 } });
await GET('/users', { apiId: 'users', cacheId: 'users-page-3', searchParameters: { page: 3 } });

// Invalidate one page's cache; only that subscriber refetches
await POST('/users', { body: newUser, invalidates: ['users-page-1'] });

// Invalidate by apiId; all three subscribers refetch their own URL
await POST('/users', { body: newUser, invalidates: ['users'] });
```

**Array `apiId`:** when a resource belongs to more than one logical group, `apiId` can be an array. Elements are sorted before comparison, so `['users', 'admin']` and `['admin', 'users']` are the same group. To invalidate an array `apiId`, pass the same values (in any order) as an element of `invalidates`:

```js
await GET('/users', { apiId: ['users', 'admin'], onSuccess: r => updateUI(r.body) });

// Wakes the ['users', 'admin'] group; order does not matter
await POST('/users', { body: newUser, invalidates: [['users', 'admin']] });

// Also wakes any subscriber whose apiId includes 'users' as a string element
await POST('/users', { body: newUser, invalidates: ['users'] });
```

### Subscriptions and reactive hooks

Any of the four hooks creates a subscription on the `apiId`. They fire reactively: on the initial fetch, and again on every invalidation-triggered refetch, focus refetch, or revalidation.

| Hook         | Fires when                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| `onFetching` | a fetch starts; body is previous data if available, `null` on first request |
| `onResponse` | any fetch completes (success or error)                                      |
| `onSuccess`  | a fetch completes with a 2xx response                                       |
| `onError`    | a fetch completes with an error or non-2xx response                         |

```js
GET('/users', {
	apiId: 'users',
	scope: this.#scope.signal,
	onFetching: () => this.showSkeleton(),
	onSuccess: r => {
		this.hideSkeleton();
		this.render(r.body);
	},
	onError: r => {
		this.hideSkeleton();
		this.showError(r.body);
	},
});
```

Use them together or individually; they're additive. Combine `onFetching` with `onResponse` when you want a single callback for completed results but still need to track when a refetch starts:

```js
GET('/users', {
	apiId: 'users',
	onFetching: () => {
		this.loading = true;
	},
	onResponse: r => {
		this.loading = false;
		if (r.status === 'success') this.render(r.body);
		if (r.status === 'error') this.showError(r.body);
	},
});
```

`onResponse` always fires with `isFetching: false`; it only runs when a fetch completes. Use `onFetching` to know when a background refetch starts.

**Callbacks on mutations auto-unsubscribe.** When a reactive hook is passed to a non-cached request (any mutation, or a GET with `cache: false`) without `refetchInterval`, the subscription fires once when the response arrives and then automatically unsubscribes. For ongoing reactivity after a mutation, subscribe via a `GET` with `invalidates` on the mutation:

```js
// ✓ reactive: GET subscription stays alive, fires after every POST
await GET('/users', { apiId: 'users', onSuccess: r => render(r.body) });
await POST('/users', { body: newUser, invalidates: ['users'] });

// one-shot: fires once, then auto-unsubscribes
await POST('/users', { body: newUser, onSuccess: r => showToast(r.body) });
```

Each subscriber refetches its own URL with its own parameters. A notification on a shared `apiId` does not merge or overwrite; each subscriber runs independently.

```js
const result = await GET('/users', { apiId: 'users' });
const { unsubscribe } = result.subscribe(r => updateUI(r.body));
// call unsubscribe() when this view is no longer active
```

`result.subscribe(callback)` registers an `onResponse`-only subscription: it fires on completed fetches but not on `isFetching: true` loading notifications. For `onFetching`/`onSuccess`/`onError` granularity, use the options directly.

### Result state

`status` and `isFetching` are orthogonal fields; read them together.

| `status`    | `isFetching` | what it means               |
| ----------- | ------------ | --------------------------- |
| `'idle'`    | `false`      | disabled (`enabled: false`) |
| `'loading'` | `true`       | first fetch in flight       |
| `'success'` | `false`      | data, nothing in flight     |
| `'success'` | `true`       | data + refetch in progress  |
| `'error'`   | `false`      | error, nothing in flight    |
| `'error'`   | `true`       | error + refetch in progress |

`status` answers "what do we have?" `isFetching` answers "is that about to change?"

### Cache Invalidation

When a successful mutation includes an `invalidates` array:

1. **Clear:** matching cache entries are deleted
2. **Refetch:** active subscriptions automatically fetch fresh data
3. **Notify:** subscription callbacks receive updated data

```js
await GET('/users', {
	apiId: 'users',
	onSuccess: data => updateUserList(data.body),
});

await POST('/users', {
	body: newUser,
	invalidates: ['users'],
});
// ↑ updateUserList fires automatically with fresh data
```

**Wildcard invalidation:** `*` matches all cache/API IDs with that prefix:

```js
// Clears users-page-1, users-page-2, users-page-N, etc.
await POST('/users', { body: newUser, invalidates: ['users-page-*'] });
```

Invalidation only occurs on successful requests (status 200–299).

### `select`

Transform the response body before it reaches callbacks and the return value. The cache always stores the raw server response; each caller applies its own `select` independently.

```js
// Pick a nested property
const result = await GET('/dashboard', {
	select: data => data.stats,
	onSuccess: r => renderStats(r.body), // r.body is data.stats
});

// Two subscribers on the same apiId, different transforms: one fetch, two views
await GET('/users', { apiId: 'users', select: data => data.users, onSuccess: r => renderList(r.body) });
await GET('/users', { apiId: 'users', select: data => data.total, onSuccess: r => renderCount(r.body) });
```

### Stale-While-Revalidate

Return cached data immediately while fetching fresh data in the background:

```js
await GET('/users', {
	apiId: 'users',
	staleWhileRevalidate: true,
	onFetching: () => showRefreshIndicator(), // background revalidation started
	onSuccess: r => {
		hideRefreshIndicator();
		updateUI(r.body);
	},
});
```

On every subsequent call that hits the cache:

1. **Return:** caller receives stale data immediately; `isFetching: true` on the return value
2. **Notify:** `onFetching` fires for active subscribers with the stale result; background fetch starts (deduplicated: one per cache key)
3. **Update:** when the fetch lands, `onSuccess` fires with fresh data

### Optimistic Updates

`setCache` writes directly to the cache and notifies active subscribers. Use `onMutate` to apply the optimistic state and return a snapshot for rollback.

```js
let currentUsers = [];
await GET('/users', {
	apiId: 'users',
	onSuccess: result => {
		currentUsers = result.body;
	},
});

await POST('/users', {
	body: newUser,
	onMutate: ({ body }) => {
		const previous = currentUsers;
		setCache('GET/users', old => [...old, body]); // apply immediately
		return { previous }; // snapshot for rollback
	},
	onSettled: (result, context) => {
		if (result.status === 'error') setCache('GET/users', context.previous); // revert on failure
	},
	invalidates: ['users'],
});
```

`onMutate` and `onSettled` are the mutation lifecycle pair: `onMutate` runs before the request, `onSettled` runs after (success or error) and receives whatever `onMutate` returned as `context`. Use them together for optimistic updates with rollback.

### Pagination

`paginate` aggregates paginated requests into a single reactive stream. Each page's cache and subscription are managed independently; cache invalidation cascades through the existing subscription system.

```js
import { paginate, GET, POST } from '@vanilla-bean/hypertether';

const query = paginate(
	page =>
		GET('/users', {
			apiId: 'users',
			cacheId: `users-page-${page}`,
			searchParameters: { page, limit: 20 },
		}),
	{ getHasNextPage: lastPage => lastPage.length > 0 },
);

// Subscribe once: fires whenever any page's data or loading state changes
query.subscribe((pages, states) => {
	renderUserList(pages.flat());
	// states: [{ page: 1, status: 'success', error: null }, ...]
	const loading = states.some(s => s.status === 'loading');
	const errors = states.filter(s => s.status === 'error');
	if (loading) showSpinner();
	if (errors.length) showErrors(errors.map(s => s.error));
});

await query.loadPage(1);
if (query.hasNextPage) await query.loadNext(); // loads page 2

console.log(query.isLoading); // true while any page is in flight

// Invalidate all pages at once
await POST('/users', { body: newUser, invalidates: ['users-page-*'] });

query.destroy(); // unsubscribes all page subscriptions
```

**API:**

- `loadPage(n)`: fetch page `n` if not already loaded; a no-op for pages already succeeded
- `loadNext()`: fetch the page after the highest loaded so far
- `subscribe(callback)`: called with `(pages, states)` whenever any page's data or loading state changes; `pages` is an array of page body arrays (one entry per loaded page), `states` is an array of `{ page, status, error }` objects. Fires immediately if pages are already loaded.
- `destroy()`: unsubscribes all page subscriptions and clears state
- `hasNextPage`: `boolean | undefined`. Calls `getHasNextPage(lastPage, allPages)` with the most recently loaded page's body. `undefined` when `getHasNextPage` is not provided or before any page has loaded.
- `isLoading`: `boolean`. `true` while any page fetch is in flight.

**Options:**

- `getHasNextPage(lastPage, allPages)`: function called with the highest-loaded page's body and the full pages array. Return `true` if more pages exist, `false` if the end has been reached. Common patterns:
  - Array length: `lastPage => lastPage.length > 0`
  - Page size threshold: `lastPage => lastPage.length >= PAGE_SIZE`
  - Server-provided cursor: `lastPage => lastPage.nextCursor != null`

## API Reference

### HTTP Methods

```js
GET(url, options?)
POST(url, options?)
PUT(url, options?)
PATCH(url, options?)
DELETE(url, options?)
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiId` | `string\|string[]\|Function` | `method+url` | Subscription group key. All subscribers using this key refetch together when any matching cache entry is invalidated. |
| `cacheId` | `string\|Function` | `method+finalUrl` | Cache storage key. Override when multiple URLs represent the same logical resource. |
| `select` | `Function` | - | Transform `(rawBody) => T` applied at delivery time. Cache stores the raw body; each subscriber applies its own select independently. |
| `invalidates` | `string[]` | - | Cache/API IDs to clear on a successful response, triggering subscriber refetches. |
| `invalidateAfter` | `number\|false` | `60000` | Cache TTL in ms. `false` = permanent. `0` = expire on next tick. |
| `cache` | `boolean` | auto | Override cache behavior. Auto: `true` for GET, `false` for mutations. |
| `deduplicate` | `boolean` | `false` | A second concurrent call returns the first call's Promise instead of firing again. Uses `cacheId` as the dedup key. |
| `staleWhileRevalidate` | `boolean` | `false` | Return cached data immediately and revalidate in the background. |
| `enabled` | `boolean` | `true` | When `false`, skips the fetch but still registers the subscription. |
| `scope` | `AbortSignal` | - | When provided, subscriptions auto-unsubscribe when the signal fires. Pass an `AbortController`'s signal for lifecycle-scoped cleanup. |
| `onFetching` | `Function` | - | Called when a fetch starts. Receives the result with `isFetching: true`; body is previous data if available, `null` on first request. Creates a subscription. |
| `onResponse` | `Function` | - | Called on every completed fetch (success or error). Creates a subscription. |
| `onSuccess` | `Function` | - | Called on 2xx responses. Creates a subscription. |
| `onError` | `Function` | - | Called on errors and non-2xx responses. Creates a subscription. |
| `onMutate` | `Function` | - | Called before the request fires. Receives `{ url, method, body, urlParameters, searchParameters }`. Return value becomes `context` in `onSettled`. |
| `onSettled` | `Function` | - | Called after every completed request. Receives `(result, context)`. Does not create a subscription. Use with `onMutate` for optimistic rollback. |
| `body` | `any` | - | Request body, JSON-serialized automatically. |
| `urlParameters` | `object` | - | Values for `:param` tokens in the URL. |
| `searchParameters` | `object` | - | Query string parameters appended after URL hydration. |
| `fetchOptions` | `object` | - | Passed directly to native `fetch` (headers, credentials, etc.). |
| `retry` | `number` | `0` | Retries on network or parse error. Does not retry on HTTP error status codes. |
| `retryDelay` | `number\|Function` | `1000` | Ms between retries, or `fn(attempt) => ms`. |
| `timeout` | `number\|false` | - | Abort after this many ms if no response has arrived. `false` disables any global timeout set via `configure` for this call. Applies to the whole call including retries; a timeout does not trigger another attempt. |
| `refetchInterval` | `number\|false` | `false` | Re-fetch on an interval (ms). Tied to the subscription; stops on `unsubscribe()`. |
| `responseType` | `'auto'\|'json'\|'text'\|'blob'\|'arrayBuffer'` | `'auto'` | How to parse the response body. `'auto'` uses Content-Type: json for `application/json`/`+json` types, text for `text/*`, blob for everything else. Use `'blob'` or `'arrayBuffer'` for file downloads, images, and other binary responses. |

### Response Object

```js
{
	status: string,              // 'idle' | 'loading' | 'success' | 'error'
	isFetching: boolean,         // true whenever a fetch is in flight
	body: any,                   // parsed response, transformed by select if provided
	contentType: string|null,
	response: Response,          // native fetch Response
	originalUrl: string,
	url: string,
	apiId: string,
	cacheId: string,
	subscriptionId: string|null,
	refetch(overrides?): Promise<RequestResult>,
	subscribe(callback, scope?): { subscriptionId, unsubscribe, refetch },
	unsubscribe(): void,
	invalidateCache(): void,
}
```

**`status`** tracks data state: `'idle'` when disabled, `'loading'` during the initial fetch, `'success'` on 2xx, `'error'` on non-2xx or network failure.

**`isFetching`** tracks network state independently. It is `true` during any in-flight fetch: initial load, invalidation-triggered refetch, SWR background fetch, focus refetch. Subscribers receive `isFetching: true` when a refetch starts and `false` when it completes.

### `setCache(cacheId, updater)`

Writes directly to the cache and notifies all active subscribers on that entry's `apiId`. A no-op when the `cacheId` has no entry.

```js
setCache('GET/users', [...currentUsers, newUser]); // replace
setCache('GET/users', old => [...old, newUser]); // updater function
```

### `resetRequest()`

Hard reset. Aborts all in-flight requests, cancels all pending TTL timeouts, clears the cache and all active subscriptions, and **removes event listeners** attached by `configure` (`refetchOnWindowFocus`, `refetchOnReconnect`, `refetchInterval`). Use on logout, auth state change, or any full app reset. Re-call `configure` after a reset to re-attach listeners.

```js
function logout() {
	resetRequest();
	redirectToLogin();
}

// After login, restore the listeners you had before:
function onLoginSuccess() {
	configure({ refetchOnWindowFocus: true, refetchOnReconnect: true });
}
```

### `clearCache()`

Soft reset. Clears all cached data and cancels TTL timers. Subscriptions and event listeners remain intact; active subscribers will refetch on their next trigger (invalidation, focus, reconnect, or interval). Use when you want fresh data on next access without disrupting the reactive wiring.

```js
// Route change: force fresh data on next access, keep focus/reconnect listeners
clearCache();

// User switches tenant within the same session: wipe stale data, keep subscriptions
clearCache();
```

Use `resetRequest()` for full teardown (logout, auth state change). Use `clearCache()` when the session is still valid but the data is stale.

### `configure(overrides)`

Sets client-wide defaults. Per-call options take precedence.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `invalidateAfter` | `number\|false` | `60000` | Default cache TTL in ms. |
| `gcTime` | `number` | `300000` | Ms to keep a cache entry after the last subscriber unsubscribes. Set to `undefined` to keep forever. |
| `retry` | `number` | `0` | Default retry count. |
| `retryDelay` | `number\|Function` | `1000` | Default ms between retries. |
| `timeout` | `number` | - | Default request timeout in ms. Per-call `timeout` takes precedence. |
| `staleWhileRevalidate` | `boolean` | `false` | Default stale-while-revalidate behavior. |
| `fetchOptions` | `object` | `{}` | Default fetch options merged into every request. |
| `refetchOnWindowFocus` | `boolean` | `false` | Refetch active subscriptions when the window regains focus or the tab becomes visible. |
| `refetchOnWindowFocusMinInterval` | `number` | `0` | Minimum ms between focus-triggered refetches. Prevents thundering herd on rapid tab switches. |
| `refetchOnReconnect` | `boolean` | `false` | Refetch active subscriptions when the browser comes back online. |
| `refetchInterval` | `number\|false` | `false` | Global polling interval in ms; refetches all active subscriptions on every tick. |
| `beforeRequest` | `Function` | - | Called once before the first fetch attempt. Receives `{ url, method, options }`. Return a `RequestInit` (or a Promise that resolves to one) to merge additional fetch options; headers are deep-merged, other keys override. Use for dynamic auth headers, correlation IDs, logging, or tracing. |
| `afterRequest` | `Function` | - | Called once when a request concludes (success, HTTP error, network error, or abort). Receives `{ result }`. Use for global error handling, metrics, or logging. |

When a focus or reconnect event fires, each unique cached resource makes one network request regardless of how many subscribers share it; the response fans out to all of them.

```js
import { configure } from '@vanilla-bean/hypertether';

configure({
	fetchOptions: { headers: { Authorization: `Bearer ${token}` } },
	invalidateAfter: 30 * 1000,
	refetchOnWindowFocus: true,
	refetchOnWindowFocusMinInterval: 5000, // at most once per 5s
	refetchOnReconnect: true,
	beforeRequest: ({ url, method }) => {
		console.debug(`[request] ${method} ${url}`);
	},
	afterRequest: ({ result }) => {
		if (result.status !== 'success') logger.error('request failed', result);
	},
});
```

### `createClient()`

Returns an isolated client with its own cache, subscriptions, and in-flight state.

```js
import { createClient } from '@vanilla-bean/hypertether';

// Server-side: one client per request so users never share cache
const client = createClient();
const result = await client.GET('/users');

// Testing: each test gets a clean slate
const { GET, resetRequest } = createClient();
```

`createClient()` returns: `{ cache, subscriptions, request, resetRequest, clearCache, setCache, configure, GET, POST, PUT, PATCH, DELETE }`.

## Advanced Usage

### URL Parameters

```js
await GET('/users/:id', { urlParameters: { id: '123' } });
// → GET /users/123

await PATCH('/organizations/:orgId/users/:userId', {
	urlParameters: { orgId: 'acme', userId: '123' },
	body: { role: 'admin' },
});
// → PATCH /organizations/acme/users/123
```

### Conditional Queries

```js
// Subscription registered immediately; fetch waits until enabled: true
await GET('/users/:id', {
	apiId: 'current-user',
	urlParameters: { id: userId },
	enabled: Boolean(userId),
	scope: this.#scope.signal,
	onSuccess: result => updateProfile(result.body),
	onError: result => showError(result.body),
});
```

### Dynamic Headers

`beforeRequest` can return a `RequestInit` (sync or async) to merge additional fetch options at request time. Headers from `beforeRequest` take priority over both global and per-call `fetchOptions`; use this for tokens that must be read fresh on each request:

```js
configure({
	beforeRequest: async () => ({
		headers: { Authorization: `Bearer ${await getAccessToken()}` },
	}),
});
```

### Binary Responses

Use `responseType` to receive non-text data without corruption. The `'auto'` default routes `application/json` and `+json` types to JSON parsing, `text/*` to text, and everything else to `blob()`:

```js
// File download: returns a Blob
const result = await GET('/exports/report.csv', { responseType: 'blob' });
const url = URL.createObjectURL(result.body);

// Raw binary: returns an ArrayBuffer
const result = await GET('/assets/font.woff2', { responseType: 'arrayBuffer' });
```

### Mutation Deduplication

```js
// User double-clicks submit; only one POST fires
await POST('/orders', {
	body: data,
	deduplicate: true,
});
```

### Polling

`refetchInterval` refetches on a timer. The interval is tied to the subscription and stops when the subscription unsubscribes; use `scope` to stop it when a component unmounts.

```js
GET('/dashboard/metrics', {
	apiId: 'metrics',
	scope: this.#scope.signal,
	refetchInterval: 30_000, // refresh every 30 seconds
	onSuccess: r => this.updateMetrics(r.body),
	onError: r => this.showStaleWarning(),
});
```

### Retry

`retry` retries on network errors and parse failures, not on HTTP error status codes (a 500 is a valid server response, not a transient failure). Pass a function to `retryDelay` for exponential backoff:

```js
await GET('/api/data', {
	retry: 3,
	retryDelay: attempt => Math.min(1000 * 2 ** attempt, 30_000),
	// attempt 1 → 2s, attempt 2 → 4s, attempt 3 → 8s (capped at 30s)
});
```

### Error Handling

```js
const result = await POST('/users', { body: invalidData });

if (result.status !== 'success') {
	console.error(result.response.status, result.body);
}

// Or via hooks: onSuccess and onError create subscriptions, fire reactively
await POST('/users', {
	body: data,
	onSuccess: result => showSuccess('Created'),
	onError: result => showError(result.body.message),
});
```

### Multi-Resource Dashboard

```js
GET('/users', { apiId: 'dashboard-users', onSuccess: result => updateUsersWidget(result.body) });
GET('/stats', { apiId: 'dashboard-stats', onSuccess: result => updateStatsWidget(result.body) });

// One mutation invalidates both; each widget refetches independently
await POST('/users', { body: userData, invalidates: ['dashboard-users', 'dashboard-stats'] });
```

### Component Lifecycle

Use `scope` to tie subscription lifetime to a component's lifecycle. Pass an `AbortController`'s signal; when the controller is aborted, all subscriptions created with that signal unsubscribe automatically. No manual cleanup array needed.

```js
class UserList extends HTMLElement {
	#scope = new AbortController();

	connectedCallback() {
		GET('/users', {
			apiId: 'users',
			scope: this.#scope.signal,
			onFetching: () => this.showSkeleton(),
			onSuccess: r => {
				this.hideSkeleton();
				this.render(r.body);
			},
			onError: r => {
				this.hideSkeleton();
				this.showError(r.body);
			},
		});
	}

	disconnectedCallback() {
		this.#scope.abort(); // all subscriptions on this scope unsubscribe
	}
}
```

The same pattern works for any object with an explicit teardown:

```js
class DashboardController {
	#scope = new AbortController();

	init() {
		// fire-and-subscribe: the hooks handle the response
		GET('/users', { apiId: 'users', scope: this.#scope.signal, onSuccess: r => this.renderUsers(r.body) });
		GET('/stats', { apiId: 'stats', scope: this.#scope.signal, onSuccess: r => this.renderStats(r.body) });
	}

	destroy() {
		this.#scope.abort(); // both subscriptions clean up in one call
	}
}
```

`scope` can also be passed as the second argument to `result.subscribe()` for manually created subscriptions:

```js
const result = await GET('/users', { apiId: 'users' });
result.subscribe(r => render(r.body), scope.signal);
```

## Troubleshooting

### Cache Not Clearing

Invalidation only fires on successful requests (200–299). Check `result.status` if subscribers are not refetching after a mutation.

```js
const result = await POST('/users', { body: data, invalidates: ['users'] });
if (result.status !== 'success') console.log('Cache not cleared, request failed:', result.response.status);
```

Also verify IDs match exactly: `'users'` does not match `'user'`.

### Callbacks Fire Multiple Times

That's the reactive model. Each invalidation or revalidation triggers your hooks again: `onFetching` when the refetch starts, then `onSuccess` or `onError` when it lands. Treat callbacks as idempotent update functions rather than one-time handlers.

### Memory Management

The recommended pattern is `scope`; see [Component Lifecycle](#component-lifecycle). Pass an `AbortController`'s signal and call `abort()` in your teardown. No subscription references to track.

For cases where `scope` isn't available, save and call `unsubscribe()` directly:

```js
const result = await GET('/users', {
	apiId: 'users',
	onResponse: result => this.render(result.body),
});
// later:
result.unsubscribe();
```

On logout or auth state change, `resetRequest()` clears everything at once: subscriptions, cache, and in-flight requests.
