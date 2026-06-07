/**
 * Aggregates paginated requests into a single reactive stream.
 *
 * Takes a `pageGetter`: a function that receives a page number and returns a
 * `Promise<RequestResult>` (typically a `GET` call). The paginator tracks each
 * loaded page, merges their data into an ordered array, and notifies subscribers
 * whenever any page's data changes, including after cache invalidation.
 *
 * @param {Function} pageGetter - `(page: number) => Promise<RequestResult>`
 * @param {object} [options]
 * @param {Function} [options.getHasNextPage] - `(lastPage, allPages) => boolean`. When provided,
 *   `query.hasNextPage` returns the result of calling this with the most recently loaded page's
 *   body and the full pages array. Returns `undefined` when not provided or before any page loads.
 * @returns {{ loadPage, loadNext, subscribe, destroy, hasNextPage: boolean|undefined, isLoading: boolean }}
 *
 * @example
 * const query = paginate(
 *   page => GET('/users', {
 *     apiId: 'users',
 *     cacheId: `users-page-${page}`,
 *     searchParameters: { page, limit: 20 },
 *   }),
 *   { getHasNextPage: lastPage => lastPage.length > 0 },
 * );
 *
 * query.subscribe((pages, states) => {
 *   const loading = states.some(s => s.status === 'loading');
 *   renderList(pages.flat(), { loading });
 * });
 * await query.loadPage(1);
 * await query.loadNext(); // loads page 2
 * console.log(query.hasNextPage); // false if last page was empty
 * console.log(query.isLoading);   // false once all pending loads settle
 *
 * // Cache invalidation cascades automatically:
 * await POST('/users', { body: newUser, invalidates: ['users-page-*'] });
 * // → query's subscriber fires with fresh data for each reloaded page
 */
export const paginate = (pageGetter, { getHasNextPage } = {}) => {
	const pageData = new Map();
	const pageState = new Map();
	const subscribers = new Set();
	let highWaterMark = 0; // 0 = no pages loaded; pages are 1-indexed

	const getPages = () => [...pageData.entries()].sort(([a], [b]) => a - b).map(([, data]) => data);

	const getPageStates = () =>
		[...pageState.entries()]
			.sort(([a], [b]) => a - b)
			.map(([page, { status, error }]) => ({ page, status, error: error ?? null }));

	const notify = () => {
		const pages = getPages();
		const states = getPageStates();
		subscribers.forEach(cb => cb(pages, states));
	};

	const loadPage = page => {
		const existing = pageState.get(page);
		if (existing?.status === 'success') return Promise.resolve(existing.result);
		// Deduplicate concurrent calls: return the same in-flight promise instead of firing again.
		if (existing?.status === 'loading') return existing.promise;

		if (existing) {
			existing.unsubscribe?.();
			existing.result?.invalidateCache?.();
		}

		const state = { status: 'loading', error: null, unsubscribe: () => {}, result: null, promise: null };
		pageState.set(page, state);
		notify();

		const promise = (async () => {
			const result = await pageGetter(page);

			if (result.status === 'success') {
				pageData.set(page, result.body);
			}

			// Subscriptions on a shared apiId receive broadcasts from every request under that apiId.
			// Without this guard, loading page 2 would overwrite page 1's slot with page 2's data.
			const expectedCacheId = result.cacheId;
			const { unsubscribe } = result.subscribe(r => {
				if (r.cacheId !== expectedCacheId) return;
				if (r.status === 'success') pageData.set(page, r.body);
				pageState.set(page, { ...pageState.get(page), status: r.status, error: r.status === 'error' ? r.body : null });
				notify();
			});

			pageState.set(page, {
				result,
				unsubscribe,
				status: result.status,
				error: result.status === 'success' ? null : result.body,
			});

			if (result.status === 'success') highWaterMark = Math.max(highWaterMark, page);
			notify();
			return result;
		})();

		// Store synchronously before any await can yield; concurrent callers will find this promise.
		state.promise = promise;

		return promise;
	};

	const loadNext = () => loadPage(highWaterMark + 1);

	const subscribe = callback => {
		subscribers.add(callback);
		if (pageData.size > 0) notify();
		return { unsubscribe: () => subscribers.delete(callback) };
	};

	const destroy = () => {
		pageState.forEach(({ unsubscribe }) => unsubscribe?.());
		pageState.clear();
		pageData.clear();
		subscribers.clear();
		highWaterMark = 0;
	};

	return {
		loadPage,
		loadNext,
		subscribe,
		destroy,
		get hasNextPage() {
			if (!getHasNextPage || highWaterMark === 0) return undefined;
			const lastPage = pageData.get(highWaterMark);
			return lastPage !== undefined ? getHasNextPage(lastPage, getPages()) : undefined;
		},
		get isLoading() {
			return [...pageState.values()].some(s => s.status === 'loading');
		},
	};
};
