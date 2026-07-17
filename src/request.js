import { hydrateUrl } from './hydrateUrl.js';

const arraysEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// crypto.randomUUID requires a secure context (https or loopback); pages served over plain
// http still need unique ids for the pending and subscription maps
const genId = () =>
	typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2, 11) + Math.random().toString(36).slice(2, 11);

const makeApplySelect = select => r => (select != null && r.status === 'success' ? { ...r, body: select(r.body) } : r);

const parseBody = (response, responseType, contentType) => {
	if (responseType === 'json') return response.json();
	if (responseType === 'text') return response.text();
	if (responseType === 'blob') return response.blob();
	if (responseType === 'arrayBuffer') return response.arrayBuffer();
	// auto: json types, text/* (startsWith covers charset variants), text fallback for unknown/absent
	if (contentType?.includes('application/json') || contentType?.includes('+json')) return response.json();
	if (!contentType || contentType.startsWith('text/')) return response.text();
	return response.blob();
};

const readOnly = map =>
	new Proxy(map, {
		get(target, prop) {
			if (prop === 'set' || prop === 'delete' || prop === 'clear') {
				return () => {
					throw new TypeError(`Use the library API; direct Map mutation is not supported`);
				};
			}
			const val = Reflect.get(target, prop);
			return typeof val === 'function' ? val.bind(target) : val;
		},
	});

const checkInvalidates = (invalidates, { cacheId, apiId }) =>
	invalidates.some(invalidate => {
		if (Array.isArray(invalidate)) return Array.isArray(apiId) ? arraysEqual([...invalidate].sort(), apiId) : false;
		if (invalidate.endsWith('*')) {
			const prefix = invalidate.slice(0, -1);
			return cacheId.startsWith(prefix) || (typeof apiId === 'string' && apiId.startsWith(prefix));
		}
		if (cacheId === invalidate) return true;
		if (Array.isArray(apiId)) return apiId.includes(invalidate);
		return apiId === invalidate;
	});

const PRIVATE_OPTION_KEYS = new Set([
	'onResponse',
	'onSuccess',
	'onError',
	'onFetching',
	'onMutate',
	'onSettled',
	'scope',
]);

// Pure: derive the stable, per-call identities from a URL and options object.
const computeMeta = (url, options) => {
	const { apiId: apiIdOption, urlParameters, searchParameters, method = 'GET', invalidates } = options;

	let hydratedUrl = url;
	if (urlParameters) hydratedUrl = hydrateUrl(hydratedUrl, urlParameters);
	if (searchParameters) hydratedUrl = `${hydratedUrl}?${new URLSearchParams(searchParameters)}`;

	const rawApiId = (typeof apiIdOption === 'function' ? apiIdOption(options) : apiIdOption) || method + url;
	const apiId = Array.isArray(rawApiId) ? [...rawApiId].sort() : rawApiId;
	const subKey = Array.isArray(apiId) ? JSON.stringify(apiId) : apiId;
	const cacheId =
		(typeof options.cacheId === 'function' ? options.cacheId(options) : options.cacheId) || method + hydratedUrl;
	const useCache = options.cache ?? (invalidates ? false : method === 'GET');
	const publicOptions = Object.fromEntries(Object.entries(options).filter(([k]) => !PRIVATE_OPTION_KEYS.has(k)));

	return { hydratedUrl, apiId, subKey, cacheId, useCache, publicOptions };
};

/**
 * @typedef {object} RequestOptions
 * @property {string|string[]|Function} [apiId] - Subscription group key; all subscribers sharing this id are notified together. Defaults to method + originalUrl. When an array, elements are matched by value regardless of order: `['users','admin']` and `['admin','users']` are the same group.
 * @property {string|Function} [cacheId] - Cache storage key. Defaults to method + hydratedUrl. Use a custom value when multiple URLs represent the same logical resource.
 * @property {(string|string[])[]} [invalidates] - Cache keys to clear on a successful response. Each entry is either a string (matched against cacheId or apiId) or a string[] (matched against an array apiId by value and order). Triggers refetch for any active subscriber whose apiId or cacheId matches.
 * @property {number|false} [invalidateAfter] - Cache TTL in milliseconds. Pass `false` to cache permanently. Defaults to 60000.
 * @property {boolean} [cache] - Override cache behavior. Auto-detected when omitted: true for GET, false for all mutations.
 * @property {boolean} [deduplicate] - When true, a second call while the first is in flight returns the same Promise instead of firing a second request. Uses `cacheId` as the dedup key. Useful for preventing double-submission on mutations.
 * @property {boolean} [staleWhileRevalidate] - When true and a cache entry exists, return stale data immediately and revalidate in the background. Subscribers receive fresh data when the revalidation completes. Defaults to false.
 * @property {boolean} [enabled] - When false, skips the fetch and returns an empty result without creating a subscription. Useful for conditional queries that depend on other data being ready.
 * @property {Function} [select] - Transform the response body before delivering to callbacks and the return value. The cache always stores the raw body; select is applied per-call at delivery time. Each subscriber applies its own select independently.
 * @property {Function} [onFetching] - Called when a fetch starts. Receives the current result with `isFetching: true`; body holds stale data if any exists, or `null` if this is the initial load. Creates a subscription.
 * @property {Function} [onResponse] - Called when any fetch completes (success or error). Creates a subscription.
 * @property {Function} [onSuccess] - Called when a fetch completes with a 2xx response. Creates a subscription.
 * @property {Function} [onError] - Called when a fetch completes with an error or non-2xx response. Creates a subscription.
 * @property {Function} [onMutate] - Called before the request executes with `{ url, method, body, urlParameters, searchParameters }`. Return value is passed as `context` to `onSettled`. Use to apply optimistic updates and save a rollback snapshot.
 * @property {Function} [onSettled] - Called after every completed request (success or error). Receives `(result, context)` where `context` is the return value of `onMutate`. Does not create a subscription.
 * @property {object} [urlParameters] - Values for colon-prefixed URL variables (e.g. `{ id: '123' }` for `'/users/:id'`).
 * @property {object} [searchParameters] - Query string parameters, appended after URL hydration.
 * @property {object} [body] - Request body. JSON-serialized automatically for non-GET requests.
 * @property {object} [fetchOptions] - Options passed directly to the native `fetch` call.
 * @property {string} [method] - HTTP method. Defaults to `'GET'`.
 * @property {number} [retry] - Number of retries on network or parse error. Defaults to 0. Does not retry on HTTP error status codes.
 * @property {number|Function} [retryDelay] - Milliseconds between retries, or `fn(attempt) => ms` for dynamic backoff. Defaults to 1000.
 * @property {number|false} [timeout] - Abort the request after this many ms. `false` disables any global timeout set via `configure` for this call. Applies to the whole call including retries; a timeout that fires mid-retry does not trigger another attempt.
 * @property {'auto'|'json'|'text'|'blob'|'arrayBuffer'} [responseType] - How to parse the response body. `'auto'` (default) uses Content-Type: json for application/json or +json, text for text/*, blob for everything else. Use `'blob'` or `'arrayBuffer'` for binary responses (file downloads, images, etc.).
 * @property {AbortSignal} [scope] - When provided, subscriptions created by this call auto-unsubscribe when the signal fires. Pass the signal of an AbortController tied to a component's lifetime for automatic cleanup; no manual `unsubscribe()` calls needed.
 */

/**
 * @typedef {object} RequestResult
 * @property {string} originalUrl - Original URL before parameter hydration
 * @property {string} url - Final URL with parameters and query string
 * @property {RequestOptions} options - Request configuration used (excludes lifecycle callbacks and scope)
 * @property {string|string[]} apiId - API endpoint identifier
 * @property {string} cacheId - Cache storage key
 * @property {string|null} subscriptionId - Subscription ID if any reactive callback was provided
 * @property {Function} unsubscribe - Remove subscription
 * @property {Response|null} response - Fetch Response object; null when enabled: false or before a request completes
 * @property {'idle'|'loading'|'success'|'error'} status - Data state: idle when disabled, loading during initial fetch, success on 2xx, error otherwise
 * @property {boolean} isFetching - True when a fetch is in flight. Subscribers receive isFetching: true when a background refetch starts and isFetching: false when it completes.
 * @property {string|null} contentType - Response Content-Type header
 * @property {*} body - Parsed response body (JSON or text), transformed by `select` if provided
 * @property {Function} invalidateCache - Clear this request's cache entry
 * @property {Function} refetch - Re-execute request with optional overrides
 * @property {Function} subscribe - Create subscription to this API endpoint
 */

/**
 * Creates an isolated request client with its own cache, subscriptions, and in-flight state.
 *
 * The default module export provides a singleton client suitable for single-page apps.
 * Use `createClient()` when instances must not share state: server-side rendering
 * (one client per incoming request), multi-tenant apps, or test isolation.
 * @returns {{ cache: ReadonlyMap, subscriptions: ReadonlyMap, request: Function, resetRequest: Function, setCache: Function, configure: Function, GET: Function, POST: Function, PUT: Function, PATCH: Function, DELETE: Function }}
 */
export const createClient = () => {
	const cache = new Map();
	const subscriptions = new Map();
	const pending = new Map();
	const gcTimers = new Map();
	const pendingControllers = new Map();

	const config = {
		invalidateAfter: 60 * 1000,
		gcTime: 5 * 60 * 1000,
		retry: 0,
		retryDelay: 1000,
		timeout: undefined,
		staleWhileRevalidate: false,
		fetchOptions: {},
		refetchOnWindowFocusMinInterval: 0,
		beforeRequest: undefined,
		afterRequest: undefined,
	};

	const listeners = { focus: null, visibilitychange: null, online: null, interval: null };
	let lastWindowRefetch = 0;

	// Dispatch a result to the appropriate callbacks on a subscription entry.
	// isFetching: true → onFetching. Completed fetch → onResponse + onSuccess/onError.
	const dispatchToSub = (sub, result) => {
		if (result.isFetching) {
			sub.onFetching?.(result);
		} else {
			sub.lastResult = result; // track most recent completed result for isFetching broadcasts
			sub.onResponse?.(result);
			if (result.status === 'success') sub.onSuccess?.(result);
			if (result.status === 'error') sub.onError?.(result);
		}
	};

	// target: null → broadcast to all subscribers on subKey. subscriptionId → notify only that one.
	const notifySubscribers = (subKey, target, result) => {
		if (!subscriptions.has(subKey)) return;
		if (target) {
			const sub = subscriptions.get(subKey)[target];
			if (sub) dispatchToSub(sub, result);
		} else {
			Object.values(subscriptions.get(subKey)).forEach(sub => dispatchToSub(sub, result));
		}
	};

	const refetchAllSubscriptions = () => {
		// Keyed by cacheId so each unique URL/params combination gets exactly one request.
		const activeEntries = new Map(); // cacheId → result
		const staleBySubKey = new Map(); // subKey → any stale result, for isFetching notification

		cache.forEach((entry, cacheId) => {
			if (!subscriptions.has(entry.subKey)) return;
			activeEntries.set(cacheId, entry.result);
			if (!staleBySubKey.has(entry.subKey)) staleBySubKey.set(entry.subKey, entry.result);
			entry.invalidate();
		});

		// Notify all subscribers with isFetching: true before any requests fire.
		staleBySubKey.forEach((staleResult, subKey) => {
			notifySubscribers(subKey, null, { ...staleResult, isFetching: true });
		});

		// One request per unique cacheId; each broadcasts fresh data to all subscribers on its subKey.
		activeEntries.forEach(result => request(result.originalUrl, result.options));

		// Subscriptions with no cache entry (TTL expired or never cached):
		// one request per cacheId, one isFetching notification per subKey.
		// Disabled subscribers skip the network; their refetch() sends idle notification instead.
		const firedCacheIds = new Set();
		const notifiedSubKeys = new Set();
		subscriptions.forEach((subs, subKey) => {
			if (staleBySubKey.has(subKey)) return;
			Object.values(subs).forEach(sub => {
				if (sub.publicOptions?.enabled === false) {
					sub.refetch?.();
					return;
				}
				if (!notifiedSubKeys.has(subKey)) {
					notifySubscribers(subKey, null, { ...sub.lastResult, isFetching: true });
					notifiedSubKeys.add(subKey);
				}
				if (!firedCacheIds.has(sub.cacheId)) {
					firedCacheIds.add(sub.cacheId);
					request(sub.url, sub.publicOptions);
				}
			});
		});
	};

	/**
	 * Sets default options applied to every request on this client. Per-call options take precedence.
	 * Headers are merged: global headers are included unless the call-site overrides the same key.
	 *
	 * `refetchOnWindowFocus` attaches listeners to both `window` focus and `document` visibilitychange,
	 * covering both OS-level window focus and browser tab switching.
	 * `refetchOnReconnect` attaches a listener to the `window` online event.
	 * @param {Partial<typeof config>} overrides
	 */
	const configure = overrides => {
		Object.assign(config, overrides);
		if ('refetchOnWindowFocus' in overrides) {
			if (overrides.refetchOnWindowFocus) {
				const onWindowFocus = () => {
					const now = Date.now();
					if (
						config.refetchOnWindowFocusMinInterval > 0 &&
						now - lastWindowRefetch < config.refetchOnWindowFocusMinInterval
					)
						return;
					lastWindowRefetch = now;
					refetchAllSubscriptions();
				};
				if (!listeners.focus && typeof globalThis.window !== 'undefined') {
					listeners.focus = onWindowFocus;
					globalThis.window.addEventListener('focus', listeners.focus);
				}
				if (!listeners.visibilitychange && typeof globalThis.document !== 'undefined') {
					listeners.visibilitychange = () => {
						if (!globalThis.document.hidden) onWindowFocus();
					};
					globalThis.document.addEventListener('visibilitychange', listeners.visibilitychange);
				}
			} else {
				if (listeners.focus && typeof globalThis.window !== 'undefined') {
					globalThis.window.removeEventListener('focus', listeners.focus);
					listeners.focus = null;
				}
				if (listeners.visibilitychange && typeof globalThis.document !== 'undefined') {
					globalThis.document.removeEventListener('visibilitychange', listeners.visibilitychange);
					listeners.visibilitychange = null;
				}
			}
		}
		if ('refetchOnReconnect' in overrides) {
			if (overrides.refetchOnReconnect && !listeners.online && typeof globalThis.window !== 'undefined') {
				listeners.online = () => refetchAllSubscriptions();
				globalThis.window.addEventListener('online', listeners.online);
			} else if (!overrides.refetchOnReconnect && listeners.online && typeof globalThis.window !== 'undefined') {
				globalThis.window.removeEventListener('online', listeners.online);
				listeners.online = null;
			}
		}
		if ('refetchInterval' in overrides) {
			if (listeners.interval) clearInterval(listeners.interval);
			listeners.interval = overrides.refetchInterval
				? setInterval(() => refetchAllSubscriptions(), overrides.refetchInterval)
				: null;
		}
	};

	/**
	 * Clears all cached data and cancels TTL timers. Subscriptions and event listeners
	 * remain intact; active subscribers will refetch on their next trigger (invalidation,
	 * focus, reconnect, or interval). Use for a soft data reset (route change, user switch
	 * within an auth session) when you want to preserve the reactive wiring without a full
	 * teardown. For a hard reset that also removes event listeners, use `resetRequest()`.
	 */
	const clearCache = () => {
		cache.forEach(({ timeout }) => {
			if (timeout) clearTimeout(timeout);
		});
		cache.clear();
		gcTimers.forEach(timer => clearTimeout(timer));
		gcTimers.clear();
	};

	/**
	 * Resets the client: cancels all TTL timeouts, clears the cache, active subscriptions,
	 * in-flight deduplication state, and removes all event listeners. Call on logout, auth
	 * change, or full app reset. Re-call `configure` to re-attach focus/reconnect listeners.
	 */
	const resetRequest = () => {
		pendingControllers.forEach(controller => controller.abort());
		pendingControllers.clear();
		clearCache();
		subscriptions.clear();
		pending.clear();
		if (listeners.focus && typeof globalThis.window !== 'undefined') {
			globalThis.window.removeEventListener('focus', listeners.focus);
			listeners.focus = null;
		}
		if (listeners.visibilitychange && typeof globalThis.document !== 'undefined') {
			globalThis.document.removeEventListener('visibilitychange', listeners.visibilitychange);
			listeners.visibilitychange = null;
		}
		if (listeners.online && typeof globalThis.window !== 'undefined') {
			globalThis.window.removeEventListener('online', listeners.online);
			listeners.online = null;
		}
		if (listeners.interval) {
			clearInterval(listeners.interval);
			listeners.interval = null;
		}
	};

	/**
	 * Writes directly to the cache and notifies all active subscribers on the entry's apiId.
	 * Use for optimistic updates: apply expected state immediately, then let the mutation's
	 * invalidation replace it with the real server response.
	 * @param {string} cacheId - Cache key to update
	 * @param {*|Function} updater - New body value, or `fn(currentBody) => newBody`
	 */
	const setCache = (cacheId, updater) => {
		const entry = cache.get(cacheId);
		if (!entry) return;
		const newBody = typeof updater === 'function' ? updater(entry.result.body) : updater;
		const updatedResult = { ...entry.result, body: newBody };
		cache.set(cacheId, { ...entry, result: updatedResult });
		if (subscriptions.has(entry.subKey)) {
			Object.values(subscriptions.get(entry.subKey)).forEach(sub => dispatchToSub(sub, updatedResult));
		}
	};

	const makeResult = (url, hydratedUrl, apiId, cacheId, publicOptions) => ({
		originalUrl: url,
		url: hydratedUrl,
		options: publicOptions,
		apiId,
		cacheId,
		subscriptionId: null,
		unsubscribe: () => {},
		response: null,
		status: 'idle',
		isFetching: false,
		contentType: null,
		body: null,
		invalidateCache: () => {
			const entry = cache.get(cacheId);
			if (entry?.timeout) clearTimeout(entry.timeout);
			cache.delete(cacheId);
		},
	});

	// Core HTTP execution: shared by request() and refetchForSubscriber().
	// notifyTarget: null → broadcast to all subscribers on subKey.
	//               subscriptionId string → notify only that subscriber.
	// Retry loop stays inline: extracting it as a separate async function adds a microtask tick
	// that would shift subscriber notification past the awaiting mutation's resolution.
	const execute = async ({
		result,
		url,
		hydratedUrl,
		method,
		body,
		fetchOptions,
		onMutate,
		onSettled,
		urlParameters,
		searchParameters,
		retry,
		retryDelay,
		timeout,
		responseType,
		cacheId,
		subKey,
		apiId,
		useCache,
		invalidateAfter,
		invalidates,
		select,
		refetchInterval,
		notifyTarget,
		userOptions,
	}) => {
		const applySelect = makeApplySelect(select);
		// One-shot: a non-cached mutation with a subscription callback fires once then cleans itself up.
		const isOneShot = notifyTarget === null && !useCache && !refetchInterval && !!result.subscriptionId;

		// ── Setup ────────────────────────────────────────────────────────────────
		const controller = new AbortController();
		const execId = genId();
		pendingControllers.set(execId, controller);

		// Synchronous options merging: no await, preserves in-flight deduplication timing.
		const effectiveFetchOptions = {
			...config.fetchOptions,
			...fetchOptions,
			headers: { ...config.fetchOptions?.headers, ...fetchOptions?.headers },
		};
		const { headers: fetchHeaders, signal: userSignal, ...restFetchOptions } = effectiveFetchOptions;
		if (userSignal) userSignal.addEventListener('abort', () => controller.abort(userSignal.reason), { once: true });
		if (timeout != null && timeout !== false) {
			const timeoutSignal = AbortSignal.timeout(timeout);
			timeoutSignal.addEventListener('abort', () => controller.abort(timeoutSignal.reason), { once: true });
		}

		// ── Cache helpers (called after the fetch lands) ──────────────────────
		const processInvalidation = () => {
			const wakeSubKeys = new Set();
			cache.forEach(({ invalidate, apiId: cacheApiId, subKey: cacheSubKey }, key) => {
				if (checkInvalidates(invalidates, { cacheId: key, apiId: cacheApiId })) {
					invalidate();
					wakeSubKeys.add(cacheSubKey);
				}
			});
			// Subscriptions whose cache entry TTL-expired (or was never written) are invisible to
			// the cache walk above; match them directly so invalidation still wakes them.
			subscriptions.forEach((subs, wakeKey) => {
				if (wakeSubKeys.has(wakeKey)) return;
				// All subscribers on a subKey share the same apiId, so one match covers the group.
				const matched = Object.values(subs).some(({ cacheId: subCacheId, apiId: subApiId }) =>
					checkInvalidates(invalidates, { cacheId: subCacheId, apiId: subApiId }),
				);
				if (matched) wakeSubKeys.add(wakeKey);
			});
			wakeSubKeys.forEach(wakeKey => {
				if (subscriptions.has(wakeKey)) {
					// Each subscriber's refetch sends isFetching: true before firing.
					Object.values(subscriptions.get(wakeKey)).forEach(({ refetch }) => refetch?.());
				}
			});
		};

		const writeCache = () => {
			const staleEntry = cache.get(cacheId);
			if (staleEntry?.timeout) clearTimeout(staleEntry.timeout);
			cache.set(cacheId, {
				apiId,
				subKey,
				invalidate: result.invalidateCache,
				result: { ...result }, // raw body; select is never stored in cache
				...(invalidateAfter !== false ? { timeout: setTimeout(result.invalidateCache, invalidateAfter) } : {}),
			});
		};

		try {
			// ── onMutate ──────────────────────────────────────────────────────────
			const context =
				onMutate != null ? await onMutate({ url, method, body, urlParameters, searchParameters }) : undefined;

			const finalizeError = error => {
				result.status = 'error';
				result.body = error;
				config.afterRequest?.({ result });
				onSettled?.(applySelect(result), context);
				notifySubscribers(subKey, notifyTarget, result);
				if (isOneShot) result.unsubscribe();
				return result;
			};

			// ── beforeRequest ─────────────────────────────────────────────────────
			const requestOverrides = config.beforeRequest
				? ((await config.beforeRequest({ url: hydratedUrl, method, options: userOptions })) ?? {})
				: {};
			const { headers: overrideHeaders = {}, ...restRequestOverrides } = requestOverrides;

			// ── Fetch + retry ─────────────────────────────────────────────────────
			// Inline: extracting as a separate async function adds a microtask tick that would
			// shift subscriber notification past the awaiting mutation's resolution.
			let attempts = 0;
			while (true) {
				try {
					const hasBody = Boolean(body) && method !== 'GET';
					result.response = await fetch(hydratedUrl, {
						headers: {
							...(hasBody ? { 'Content-Type': 'application/json' } : {}),
							...fetchHeaders,
							...overrideHeaders,
						},
						body: hasBody ? JSON.stringify(body) : null,
						...restFetchOptions,
						...restRequestOverrides,
						method,
						signal: controller.signal,
					});
					const isSuccess = Math.floor(result.response.status / 100) === 2;
					result.status = isSuccess ? 'success' : 'error';
					result.contentType = result.response.headers.get('content-type');
					result.body = await parseBody(result.response, responseType, result.contentType);
					break;
				} catch (error) {
					if (controller.signal.aborted || error?.name === 'AbortError') return finalizeError(error);
					if (attempts < retry) {
						attempts++;
						const delay = typeof retryDelay === 'function' ? retryDelay(attempts) : retryDelay;
						if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
					} else {
						return finalizeError(error);
					}
				}
			}

			// ── afterRequest + onSettled ──────────────────────────────────────────
			config.afterRequest?.({ result });
			onSettled?.(applySelect(result), context);

			// ── Cache write + invalidation ────────────────────────────────────────
			if (result.status === 'success' && invalidates) processInvalidation();
			if (useCache) writeCache();

			// ── Notify + cleanup ──────────────────────────────────────────────────
			// Wire subscription identity back onto the result for subscriber refetches,
			// so callers that await a refetch get a properly populated result object.
			if (notifyTarget !== null) {
				result.subscriptionId = notifyTarget;
				result.unsubscribe = subscriptions.get(subKey)?.[notifyTarget]?.unsubscribe ?? (() => {});
			}
			notifySubscribers(subKey, notifyTarget, result);
			if (isOneShot) result.unsubscribe();
			return applySelect(result);
		} finally {
			pendingControllers.delete(execId);
		}
	};

	// Subscriber-triggered refetch. Called by the internal refetch() on a subscription entry
	// instead of going through the public request() path. Skips subscription registration,
	// cache reads, and in-flight deduplication; the subscription already exists and the cache
	// entry has been cleared before this runs.
	const refetchForSubscriber = (url, userOptions, subscriptionId) => {
		const {
			invalidates,
			select,
			onMutate,
			onSettled,
			enabled = true,
			fetchOptions,
			retry = config.retry,
			retryDelay = config.retryDelay,
			timeout = config.timeout,
			refetchInterval = false,
			responseType = 'auto',
			invalidateAfter = config.invalidateAfter,
			method = 'GET',
			urlParameters,
			searchParameters,
		} = userOptions;

		const { hydratedUrl, apiId, subKey, cacheId, useCache, publicOptions } = computeMeta(url, userOptions);

		const result = {
			...makeResult(url, hydratedUrl, apiId, cacheId, publicOptions),
			subscriptionId,
			unsubscribe: subscriptions.get(subKey)?.[subscriptionId]?.unsubscribe ?? (() => {}),
			refetch: async overrides => refetchForSubscriber(url, { ...userOptions, ...overrides }, subscriptionId),
			subscribe: () => {
				throw new Error('subscribe is not available on a subscriber-refetch result');
			},
		};

		if (!enabled) {
			notifySubscribers(subKey, subscriptionId, result);
			return Promise.resolve(result);
		}

		return execute({
			result,
			url,
			hydratedUrl,
			method,
			body: userOptions.body,
			fetchOptions,
			onMutate,
			onSettled,
			urlParameters,
			searchParameters,
			retry,
			retryDelay,
			timeout,
			responseType,
			cacheId,
			subKey,
			apiId,
			useCache,
			invalidateAfter,
			invalidates,
			select,
			refetchInterval,
			notifyTarget: subscriptionId,
			userOptions,
		});
	};

	/**
	 * Fetches a URL with automatic caching, reactive subscriptions, and cache invalidation.
	 * GET requests cache by default; mutations with `invalidates` clear matching cache entries
	 * and trigger subscriber callbacks with fresh data.
	 * @param {string} url - Request URL supporting colon-prefixed parameters (e.g., '/users/:id')
	 * @param {RequestOptions} [options] - Request configuration and caching options
	 * @returns {Promise<RequestResult>} Request result containing response data and control utilities
	 */
	const request = async (url, options = {}) => {
		const {
			invalidateAfter = config.invalidateAfter,
			invalidates,
			select,
			onResponse,
			onSuccess,
			onError,
			onFetching,
			onMutate,
			onSettled,
			enabled = true,
			staleWhileRevalidate = config.staleWhileRevalidate,
			urlParameters,
			searchParameters,
			method = 'GET',
			fetchOptions,
			retry = config.retry,
			retryDelay = config.retryDelay,
			timeout = config.timeout,
			deduplicate = false,
			refetchInterval = false,
			responseType = 'auto',
			scope,
		} = options;

		const userOptions = options;
		const { hydratedUrl, apiId, subKey, cacheId, useCache, publicOptions } = computeMeta(url, options);
		const trackPending = useCache || deduplicate;

		const applySelect = makeApplySelect(select);

		const result = {
			...makeResult(url, hydratedUrl, apiId, cacheId, publicOptions),
			refetch: async overrides => request(url, { ...userOptions, ...overrides }),
			// Public API for manual subscriptions. Registers an onResponse callback only;
			// it fires on completed fetches but not on isFetching: true notifications.
			// For the full four-hook model use the onFetching/onSuccess/onError options instead.
			subscribe: (callback, subscribeScope) => registerSubscription({ onResponse: callback, subscribeScope }),
		};

		// Registers one subscription entry covering all four reactive callbacks.
		// Each callback is wrapped with select at registration time so the cache always stores raw data.
		const registerSubscription = ({
			onResponse: cbResponse,
			onSuccess: cbSuccess,
			onError: cbError,
			onFetching: cbFetching,
			subscribeScope,
		} = {}) => {
			const wrap = cb => (cb && select != null ? r => cb(applySelect(r)) : cb);

			const wrappedOnResponse = wrap(cbResponse) ?? null;
			const wrappedOnSuccess = wrap(cbSuccess) ?? null;
			const wrappedOnError = cbError ?? null; // error bodies are never transformed by select
			const wrappedOnFetching = wrap(cbFetching) ?? null;

			const effectiveScope = subscribeScope ?? scope;
			const subscriptionId = genId();
			let intervalId;

			const unsubscribe = () => {
				if (intervalId) clearInterval(intervalId);
				const existing = subscriptions.get(subKey);
				if (!existing) return;
				delete existing[subscriptionId];
				if (Object.keys(existing).length === 0) {
					subscriptions.delete(subKey);
					if (config.gcTime != null) {
						const timer = setTimeout(() => {
							gcTimers.delete(subKey);
							cache.forEach(entry => {
								if (entry.subKey === subKey) entry.invalidate();
							});
						}, config.gcTime);
						gcTimers.set(subKey, timer);
					}
				}
			};

			const refetch = async overrides => {
				if (!subscriptions.get(subKey)?.[subscriptionId]) return;
				// Send isFetching: true before the request fires so subscribers can show loading state.
				// Prefer the cached result as the base (raw body, correct status). Fall back to the
				// subscription's own result; it carries the last completed status from its own fetch.
				const cachedEntry = cache.get(cacheId);
				const loadingBase = cachedEntry?.result ?? result;
				notifySubscribers(subKey, subscriptionId, { ...loadingBase, isFetching: true });
				return refetchForSubscriber(url, { ...userOptions, ...overrides }, subscriptionId);
			};

			if (refetchInterval)
				intervalId = setInterval(() => {
					result.invalidateCache();
					refetch();
				}, refetchInterval);

			const subscription = {
				[subscriptionId]: {
					onResponse: wrappedOnResponse,
					onSuccess: wrappedOnSuccess,
					onError: wrappedOnError,
					onFetching: wrappedOnFetching,
					unsubscribe,
					refetch,
					cacheId,
					apiId,
					url,
					publicOptions,
					lastResult: result,
				},
			};
			if (gcTimers.has(subKey)) {
				clearTimeout(gcTimers.get(subKey));
				gcTimers.delete(subKey);
			}
			if (!subscriptions.has(subKey)) subscriptions.set(subKey, subscription);
			else subscriptions.set(subKey, { ...subscriptions.get(subKey), ...subscription });
			if (effectiveScope) effectiveScope.addEventListener('abort', unsubscribe, { once: true });
			return { subscriptionId, unsubscribe, refetch };
		};

		// Register a subscription for any combination of the four reactive callbacks.
		const hasSubscriptionCallbacks = !!(onResponse || onSuccess || onError || onFetching);
		if (hasSubscriptionCallbacks) {
			const { subscriptionId, unsubscribe, refetch } = registerSubscription({
				onResponse,
				onSuccess,
				onError,
				onFetching,
			});
			result.subscriptionId = subscriptionId;
			result.unsubscribe = unsubscribe;
			result.refetch = refetch;
		}

		if (!enabled) return result;

		if (useCache && cache.has(cacheId)) {
			const cachedResult = cache.get(cacheId).result;
			if (staleWhileRevalidate) {
				// Notify all subscribers that a background revalidation is starting.
				notifySubscribers(subKey, null, { ...cachedResult, isFetching: true });
				if (!pending.has(cacheId)) {
					const revalidatePromise = execute({
						result,
						url,
						hydratedUrl,
						method,
						body: options.body,
						fetchOptions,
						onMutate,
						onSettled,
						urlParameters,
						searchParameters,
						retry,
						retryDelay,
						timeout,
						responseType,
						cacheId,
						subKey,
						apiId,
						useCache,
						invalidateAfter,
						invalidates,
						select,
						refetchInterval,
						notifyTarget: null,
						userOptions,
					});
					pending.set(cacheId, revalidatePromise);
					revalidatePromise.finally(() => pending.delete(cacheId));
				}
				return { ...applySelect(cachedResult), isFetching: true };
			}
			// Newly registered subscriber on a warm cache: notify immediately, skip loading state.
			notifySubscribers(subKey, null, cachedResult);
			return applySelect(cachedResult);
		}

		// Deduplicate concurrent requests. Applies when caching is active or deduplicate: true.
		// Skipped when a per-call subscriber is present (each subscriber needs its own request).
		if (trackPending && !hasSubscriptionCallbacks && pending.has(cacheId)) {
			return pending.get(cacheId).then(applySelect);
		}

		// New subscriber with no cached data; notify with loading state before the fetch fires.
		if (hasSubscriptionCallbacks) {
			notifySubscribers(subKey, result.subscriptionId, { ...result, status: 'loading', isFetching: true });
		}

		const resultPromise = execute({
			result,
			url,
			hydratedUrl,
			method,
			body: options.body,
			fetchOptions,
			onMutate,
			onSettled,
			urlParameters,
			searchParameters,
			retry,
			retryDelay,
			timeout,
			responseType,
			cacheId,
			subKey,
			apiId,
			useCache,
			invalidateAfter,
			invalidates,
			select,
			refetchInterval,
			notifyTarget: null,
			userOptions,
		});

		if (trackPending && !hasSubscriptionCallbacks) {
			pending.set(cacheId, resultPromise);
			resultPromise.finally(() => pending.delete(cacheId));
		}

		return resultPromise;
	};

	const GET = (url, options = {}) => request(url, { method: 'GET', ...options });
	const POST = (url, options = {}) => request(url, { method: 'POST', ...options });
	const PUT = (url, options = {}) => request(url, { method: 'PUT', ...options });
	const PATCH = (url, options = {}) => request(url, { method: 'PATCH', ...options });
	const DELETE = (url, options = {}) => request(url, { method: 'DELETE', ...options });

	return {
		cache: readOnly(cache),
		subscriptions: readOnly(subscriptions),
		request,
		resetRequest,
		clearCache,
		setCache,
		configure,
		GET,
		POST,
		PUT,
		PATCH,
		DELETE,
	};
};

export const {
	cache,
	subscriptions,
	request,
	resetRequest,
	clearCache,
	setCache,
	configure,
	GET,
	POST,
	PUT,
	PATCH,
	DELETE,
} = createClient();
