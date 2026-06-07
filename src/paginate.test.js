import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GET, POST, resetRequest } from './request';
import { paginate } from './paginate';

const makePageFetch = () =>
	mock(url => {
		const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
		return Promise.resolve({
			status: 200,
			headers: new Map([['content-type', 'application/json']]),
			json: () => Promise.resolve([{ page }]),
			text: () => Promise.resolve(''),
		});
	});

describe('paginate', () => {
	beforeEach(() => {
		resetRequest();
		global.fetch = makePageFetch();
	});

	afterEach(() => {
		mock.restore();
	});

	it('should load a page and notify subscribers', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const received = [];
		query.subscribe(pages => received.push(pages));

		await query.loadPage(1);

		expect(received.length).toBeGreaterThan(0);
		expect(received.at(-1)).toEqual([[{ page: 1 }]]);
	});

	it('should merge pages in order when multiple pages are loaded', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const received = [];
		query.subscribe(pages => received.push(pages));

		await query.loadPage(1);
		await query.loadPage(2);

		expect(received.at(-1)).toEqual([[{ page: 1 }], [{ page: 2 }]]);
	});

	it('should load pages in order regardless of loading order', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		await query.loadPage(2);
		await query.loadPage(1);

		const received = [];
		query.subscribe(pages => received.push(pages));

		expect(received[0]).toEqual([[{ page: 1 }], [{ page: 2 }]]);
	});

	it('should advance the high water mark and loadNext loads the following page', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		await query.loadPage(1);
		await query.loadNext();

		const received = [];
		query.subscribe(pages => received.push(pages));

		expect(received[0]).toEqual([[{ page: 1 }], [{ page: 2 }]]);
	});

	it('should not overwrite an earlier page when a later page loads', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const received = [];
		query.subscribe(pages => received.push(pages));

		await query.loadPage(1);
		await query.loadPage(2);

		// Page 1's slot must still contain page 1's data after page 2 broadcasts to the shared apiId
		expect(received.at(-1)[0]).toEqual([{ page: 1 }]);
		expect(received.at(-1)[1]).toEqual([{ page: 2 }]);
	});

	it('should not re-fetch a page that is already loaded', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		await query.loadPage(1);
		await query.loadPage(1);

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('should not fire a second request when loadPage is called concurrently for the same page', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const [r1, r2] = await Promise.all([query.loadPage(1), query.loadPage(1)]);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(r1).toBe(r2);
	});

	it('should call subscriber immediately with current pages when it subscribes after load', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		await query.loadPage(1);
		await query.loadPage(2);

		const received = [];
		query.subscribe(pages => received.push(pages));

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual([[{ page: 1 }], [{ page: 2 }]]);
	});

	it('should update a page and notify subscribers when cache is invalidated', async () => {
		let version = 0;
		global.fetch = mock(url => {
			version++;
			const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
			return Promise.resolve({
				status: 200,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve([{ page, version }]),
				text: () => Promise.resolve(''),
			});
		});

		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const received = [];
		query.subscribe(pages => received.push(pages));

		await query.loadPage(1);
		const initialVersion = received.at(-1)[0][0].version;

		await POST('/items', { body: {}, invalidates: ['items-page-1'] });
		await new Promise(resolve => setTimeout(resolve, 20));

		const updatedVersion = received.at(-1)[0][0].version;
		expect(updatedVersion).toBeGreaterThan(initialVersion);
	});

	it('should clean up subscriptions on destroy', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		const received = [];
		query.subscribe(pages => received.push(pages));
		await query.loadPage(1);

		query.destroy();
		const callsBeforeDestroy = received.length;

		await POST('/items', { body: {}, invalidates: ['items-page-1'] });
		await new Promise(resolve => setTimeout(resolve, 20));

		expect(received.length).toBe(callsBeforeDestroy);
	});

	it('should not advance highWaterMark when a page load fails', async () => {
		global.fetch = mock(() =>
			Promise.resolve({
				status: 500,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ error: 'fail' }),
				text: () => Promise.resolve(''),
			}),
		);

		const query = paginate(page =>
			GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
		);

		await query.loadPage(1);

		// highWaterMark stayed at 0, so loadNext retries page 1.
		// paginate auto-clears the failed cache entry; no resetRequest() needed.
		global.fetch = makePageFetch();
		await query.loadNext();

		const received = [];
		query.subscribe(pages => received.push(pages));
		expect(received[0]).toEqual([[{ page: 1 }]]);
	});

	it('should allow retrying a failed page', async () => {
		let attempt = 0;
		global.fetch = mock(url => {
			attempt++;
			const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
			if (attempt === 1) {
				return Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'fail' }),
					text: () => Promise.resolve(''),
				});
			}
			return Promise.resolve({
				status: 200,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve([{ page }]),
				text: () => Promise.resolve(''),
			});
		});

		const query = paginate(page =>
			GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
		);

		const first = await query.loadPage(1);
		expect(first.status).toBe('error');

		// paginate auto-clears the failed cache entry on retry; no resetRequest() needed.
		const retry = await query.loadPage(1);
		expect(retry.status).toBe('success');

		const received = [];
		query.subscribe(pages => received.push(pages));
		expect(received[0]).toEqual([[{ page: 1 }]]);
	});

	it('should not include failed pages in subscriber data', async () => {
		global.fetch = mock(() =>
			Promise.resolve({
				status: 500,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ error: 'fail' }),
				text: () => Promise.resolve(''),
			}),
		);

		const query = paginate(page =>
			GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
		);

		await query.loadPage(1);

		const received = [];
		query.subscribe(pages => received.push(pages));

		// subscribe fires immediately only if there's data; empty here
		expect(received).toHaveLength(0);
	});

	it('should propagate a refetch error to pageState after a page was already successful', async () => {
		// attempt 1: GET page 1 → 200, attempt 2: POST → 201 (triggers invalidation), attempt 3: GET page 1 refetch → 500
		let attempt = 0;
		global.fetch = mock(url => {
			attempt++;
			const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
			if (attempt === 1)
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve([{ page }]),
					text: () => Promise.resolve(''),
				});
			if (attempt === 2)
				return Promise.resolve({
					status: 201,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				});
			return Promise.resolve({
				status: 500,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ error: 'server error' }),
				text: () => Promise.resolve(''),
			});
		});

		const query = paginate(page =>
			GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
		);

		const received = [];
		query.subscribe((_, states) => received.push(states.map(s => s.status)));

		await query.loadPage(1);
		expect(received.at(-1)).toEqual(['success']);

		await POST('/items', { body: {}, invalidates: ['items-page-1'] });
		await new Promise(resolve => setTimeout(resolve, 20));

		expect(received.at(-1)).toEqual(['error']);
	});

	it('should keep stale page data visible after a refetch error', async () => {
		let attempt = 0;
		global.fetch = mock(url => {
			attempt++;
			const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
			if (attempt === 1)
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve([{ page, version: 1 }]),
					text: () => Promise.resolve(''),
				});
			if (attempt === 2)
				return Promise.resolve({
					status: 201,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				});
			return Promise.resolve({
				status: 500,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ error: 'server error' }),
				text: () => Promise.resolve(''),
			});
		});

		const query = paginate(page =>
			GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
		);

		await query.loadPage(1);

		await POST('/items', { body: {}, invalidates: ['items-page-1'] });
		await new Promise(resolve => setTimeout(resolve, 20));

		const received = [];
		query.subscribe(pages => received.push(pages));
		expect(received[0]).toEqual([[{ page: 1, version: 1 }]]);
	});

	it('should allow reloading pages after destroy', async () => {
		const query = paginate(page =>
			GET('/items', {
				apiId: 'items',
				cacheId: `items-page-${page}`,
				searchParameters: { page },
			}),
		);

		await query.loadPage(1);
		query.destroy();

		resetRequest();
		global.fetch = makePageFetch();

		await query.loadPage(1);

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	describe('pageStates and isLoading', () => {
		it('should notify subscriber with loading state before data arrives', async () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			const statuses = [];
			query.subscribe((_, states) => statuses.push(states.map(s => s.status)));

			await query.loadPage(1);

			expect(statuses[0]).toEqual(['loading']);
			expect(statuses.at(-1)).toEqual(['success']);
		});

		it('should report error status when a page load fails', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'fail' }),
					text: () => Promise.resolve(''),
				}),
			);

			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			const statuses = [];
			query.subscribe((_, states) => statuses.push(states.map(s => s.status)));

			await query.loadPage(1);

			expect(statuses.at(-1)).toEqual(['error']);
		});

		it('should include the error body in the error state', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'fail' }),
					text: () => Promise.resolve(''),
				}),
			);

			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			const received = [];
			query.subscribe((_, states) => received.push(states));

			await query.loadPage(1);

			const errorState = received.at(-1).find(s => s.status === 'error');
			expect(errorState.error).toEqual({ error: 'fail' });
		});

		it('isLoading should be true while a page is in flight and false once settled', async () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			const snapshots = [];
			query.subscribe(() => snapshots.push(query.isLoading));

			await query.loadPage(1);

			expect(snapshots[0]).toBe(true);
			expect(snapshots.at(-1)).toBe(false);
			expect(query.isLoading).toBe(false);
		});

		it('isLoading should be false before any page is loaded', () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			expect(query.isLoading).toBe(false);
		});

		it('states are delivered in page-number order regardless of load order', async () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			await query.loadPage(2);
			await query.loadPage(1);

			const received = [];
			query.subscribe((_, states) => received.push(states));

			const pages = received[0].map(s => s.page);
			expect(pages).toEqual([1, 2]);
		});

		it('error state has null error field on success', async () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			const received = [];
			query.subscribe((_, states) => received.push(states));

			await query.loadPage(1);

			const successState = received.at(-1).find(s => s.status === 'success');
			expect(successState.error).toBeNull();
		});
	});

	describe('hasNextPage', () => {
		it('should be undefined when getHasNextPage is not provided', async () => {
			const query = paginate(page =>
				GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
			);

			await query.loadPage(1);

			expect(query.hasNextPage).toBeUndefined();
		});

		it('should be undefined before any page is loaded', async () => {
			const query = paginate(
				page => GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
				{ getHasNextPage: lastPage => lastPage.length > 0 },
			);

			expect(query.hasNextPage).toBeUndefined();
		});

		it('should return true when the last page has items', async () => {
			const query = paginate(
				page => GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
				{ getHasNextPage: lastPage => lastPage.length > 0 },
			);

			await query.loadPage(1);

			expect(query.hasNextPage).toBe(true);
		});

		it('should return false when the last page is empty', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve([]),
					text: () => Promise.resolve(''),
				}),
			);

			const query = paginate(
				page => GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
				{ getHasNextPage: lastPage => lastPage.length > 0 },
			);

			await query.loadPage(1);

			expect(query.hasNextPage).toBe(false);
		});

		it('should update after loading a new page', async () => {
			let pageCount = 0;
			global.fetch = mock(() => {
				pageCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve(pageCount < 2 ? [{ page: pageCount }] : []),
					text: () => Promise.resolve(''),
				});
			});

			const query = paginate(
				page => GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
				{ getHasNextPage: lastPage => lastPage.length > 0 },
			);

			await query.loadPage(1);
			expect(query.hasNextPage).toBe(true);

			await query.loadPage(2);
			expect(query.hasNextPage).toBe(false);
		});

		it('should pass both lastPage and allPages to getHasNextPage', async () => {
			const calls = [];
			const query = paginate(
				page => GET('/items', { apiId: 'items', cacheId: `items-page-${page}`, searchParameters: { page } }),
				{
					getHasNextPage: (lastPage, allPages) => {
						calls.push({ lastPage, allPages });
						return true;
					},
				},
			);

			await query.loadPage(1);
			await query.loadPage(2);

			// Access hasNextPage to trigger getHasNextPage
			query.hasNextPage;

			const last = calls.at(-1);
			expect(last.lastPage).toEqual([{ page: 2 }]);
			expect(last.allPages).toEqual([[{ page: 1 }], [{ page: 2 }]]);
		});
	});
});
