import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
	GET,
	POST,
	PATCH,
	DELETE,
	cache,
	subscriptions,
	setCache,
	clearCache,
	createClient,
	resetRequest,
} from './request';
import { hydrateUrl } from './hydrateUrl';

describe('request library', () => {
	beforeEach(() => {
		resetRequest();

		global.fetch = mock(() =>
			Promise.resolve({
				status: 200,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ data: 'test' }),
				text: () => Promise.resolve('test'),
			}),
		);
	});

	afterEach(() => {
		mock.restore();
	});

	describe('hydrateUrl', () => {
		it('should replace colon-prefixed parameters', () => {
			const url = hydrateUrl('/users/:id', { id: '123' });
			expect(url).toBe('/users/123');
		});

		it('should handle multiple parameters', () => {
			const url = hydrateUrl('/users/:userId/posts/:postId', {
				userId: '123',
				postId: '456',
			});
			expect(url).toBe('/users/123/posts/456');
		});

		it('should URI encode parameters', () => {
			const url = hydrateUrl('/search/:query', { query: 'hello world' });
			expect(url).toBe('/search/hello%20world');
		});

		it('should ignore extra parameters that have no matching token in the URL', () => {
			const url = hydrateUrl('/users/:id', { id: '123', age: 25 });
			expect(url).toBe('/users/123');
		});

		it('should work with no parameters', () => {
			const url = hydrateUrl('/users');
			expect(url).toBe('/users');
		});

		it('should throw when a required URL parameter is empty string', () => {
			expect(() => hydrateUrl('/users/:id/:name', { id: '123', name: '' })).toThrow(/unresolved URL parameters/);
		});

		it('should throw when a required URL parameter is null', () => {
			expect(() => hydrateUrl('/users/:id/:name', { id: '123', name: null })).toThrow(/unresolved URL parameters/);
		});

		it('should throw when a parameter key does not match any token', () => {
			expect(() => hydrateUrl('/users/:id', { userId: '123' })).toThrow(/unresolved URL parameters/);
		});
	});

	describe('basic HTTP methods', () => {
		it('should make GET request', async () => {
			const result = await GET('/users');

			expect(fetch).toHaveBeenCalledWith(
				'/users',
				expect.objectContaining({
					method: 'GET',
					body: null,
				}),
			);
			expect(result.status).toBe('success');
			expect(result.body).toEqual({ data: 'test' });
		});

		it('should make POST request with body', async () => {
			const body = { name: 'John' };
			const result = await POST('/users', { body });

			expect(fetch).toHaveBeenCalledWith(
				'/users',
				expect.objectContaining({
					method: 'POST',
					body: JSON.stringify(body),
				}),
			);
			expect(result.status).toBe('success');
		});

		it('should make DELETE request', async () => {
			await DELETE('/users/123');

			expect(fetch).toHaveBeenCalledWith(
				'/users/123',
				expect.objectContaining({
					method: 'DELETE',
					body: null,
				}),
			);
		});
	});

	describe('URL parameter handling', () => {
		it('should hydrate URL parameters', async () => {
			await GET('/users/:id', { urlParameters: { id: '123' } });

			expect(fetch).toHaveBeenCalledWith('/users/123', expect.any(Object));
		});

		it('should add search parameters', async () => {
			await GET('/users', { searchParameters: { page: 1, limit: 10 } });

			expect(fetch).toHaveBeenCalledWith('/users?page=1&limit=10', expect.any(Object));
		});

		it('should combine URL and search parameters', async () => {
			await GET('/users/:id/posts', {
				urlParameters: { id: '123' },
				searchParameters: { page: 1 },
			});

			expect(fetch).toHaveBeenCalledWith('/users/123/posts?page=1', expect.any(Object));
		});
	});

	describe('response handling', () => {
		it('should handle JSON response', async () => {
			const result = await GET('/users');

			expect(result.contentType).toBe('application/json');
			expect(result.body).toEqual({ data: 'test' });
		});

		it('should handle text response', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'text/plain']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve('plain text'),
				}),
			);

			const result = await GET('/users');

			expect(result.contentType).toBe('text/plain');
			expect(result.body).toBe('plain text');
		});

		it('should handle error status codes', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 404,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Not found' }),
					text: () => Promise.resolve(''),
				}),
			);

			const result = await GET('/users');

			expect(result.status).toBe('error');
			expect(result.body).toEqual({ error: 'Not found' });
		});

		it('should treat 299 as success and 300 as failure', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 299,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				}),
			);
			expect((await GET('/test-299')).status).toBe('success');

			global.fetch = mock(() =>
				Promise.resolve({
					status: 300,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				}),
			);
			expect((await GET('/test-300')).status).toBe('error');
		});
	});

	describe('caching', () => {
		it('should cache GET requests by default', async () => {
			await GET('/users');
			await GET('/users');

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(cache.size).toBe(1);
		});

		it('should not cache POST requests by default', async () => {
			await POST('/users', { body: { name: 'John' } });
			await POST('/users', { body: { name: 'John' } });

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should not cache POST requests with invalidates', async () => {
			await POST('/users', { body: { name: 'John' }, invalidates: [] });
			await POST('/users', { body: { name: 'John' }, invalidates: [] });

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should respect cache option', async () => {
			await GET('/users', { cache: false });
			await GET('/users', { cache: false });

			expect(fetch).toHaveBeenCalledTimes(2);
			expect(cache.size).toBe(0);
		});

		it('should use custom cacheId', async () => {
			await GET('/users', { cacheId: 'custom-cache' });

			expect(cache.has('custom-cache')).toBe(true);
		});

		it('should use function for cacheId', async () => {
			const cacheIdFn = mock(() => 'dynamic-cache');
			await GET('/users', { cacheId: cacheIdFn });

			expect(cacheIdFn).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					cacheId: cacheIdFn,
				}),
			);
			expect(cache.has('dynamic-cache')).toBe(true);
		});

		it('should expire cache after invalidateAfter time', async () => {
			await GET('/users', { invalidateAfter: 100 });

			expect(cache.size).toBe(1);

			await new Promise(resolve => setTimeout(resolve, 150));

			expect(cache.size).toBe(0);
		});

		it('should not expire cache when invalidateAfter is false', async () => {
			await GET('/users', { invalidateAfter: false });

			const cacheEntry = Array.from(cache.values())[0];
			expect(cacheEntry.timeout).toBeUndefined();
		});

		it('should expire cache on next tick when invalidateAfter is 0', async () => {
			await GET('/users', { invalidateAfter: 0 });

			expect(cache.size).toBe(1);

			await new Promise(resolve => setTimeout(resolve, 10));

			expect(cache.size).toBe(0);
		});

		it('should cache POST when cache: true is explicitly set', async () => {
			await POST('/users', { cache: true, body: { name: 'John' } });
			await POST('/users', { cache: true, body: { name: 'John' } });

			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it('should invalidate cache manually', async () => {
			const result = await GET('/users');

			expect(cache.size).toBe(1);

			result.invalidateCache();

			expect(cache.size).toBe(0);
		});

		it('should allow reading from cache', async () => {
			await GET('/users');
			expect(cache.size).toBe(1);
			expect(cache.has('GET/users')).toBe(true);
			expect(cache.get('GET/users')).toBeDefined();
			expect([...cache.keys()]).toEqual(['GET/users']);
		});

		it('should throw on direct cache mutation', async () => {
			await GET('/users');
			expect(() => cache.set('foo', {})).toThrow(TypeError);
			expect(() => cache.delete('GET/users')).toThrow(TypeError);
			expect(() => cache.clear()).toThrow(TypeError);
		});

		it('should throw on direct subscriptions mutation', async () => {
			await GET('/users', { apiId: 'users', onResponse: mock() });
			expect(() => subscriptions.set('foo', {})).toThrow(TypeError);
			expect(() => subscriptions.delete('users')).toThrow(TypeError);
			expect(() => subscriptions.clear()).toThrow(TypeError);
		});
	});

	describe('subscriptions', () => {
		it('should create subscription with onResponse', async () => {
			const onResponse = mock();
			const result = await GET('/users', { apiId: 'users', onResponse });

			expect(result.subscriptionId).toBeTruthy();
			expect(result.unsubscribe).toBeFunction();
			expect(subscriptions.has('users')).toBe(true);
			expect(onResponse).toHaveBeenCalled();
		});

		it('should call subscription on refetch', async () => {
			const onResponse = mock();
			const result = await GET('/users', { apiId: 'users', onResponse });

			const initialCalls = onResponse.mock.calls.length;

			await result.refetch();

			expect(onResponse.mock.calls.length).toBeGreaterThan(initialCalls);
		});

		it('should unsubscribe properly', async () => {
			const onResponse = mock();
			const result = await GET('/users', { apiId: 'users', onResponse });

			const callsBefore = onResponse.mock.calls.length;
			result.unsubscribe();

			await POST('/users', { body: { name: 'John' }, invalidates: ['users'] });

			expect(onResponse.mock.calls.length).toBe(callsBefore);
		});

		it('should handle multiple subscriptions to same apiId', async () => {
			const onResponse1 = mock();
			const onResponse2 = mock();

			await GET('/users', { apiId: 'users', onResponse: onResponse1 });
			await GET('/users', { apiId: 'users', onResponse: onResponse2 });

			const subscription = subscriptions.get('users');
			expect(Object.keys(subscription).length).toBe(2);
		});

		it('should use function for apiId', async () => {
			const apiIdFn = mock(() => 'dynamic-api');
			const onResponse = mock();

			await GET('/users', { apiId: apiIdFn, onResponse });

			expect(apiIdFn).toHaveBeenCalledWith(
				expect.objectContaining({
					method: 'GET',
					apiId: apiIdFn,
				}),
			);
			expect(subscriptions.has('dynamic-api')).toBe(true);
		});

		it('should pass overrides to the underlying request on refetch', async () => {
			const result = await GET('/users', { apiId: 'users' });

			await result.refetch({ searchParameters: { page: 2 } });

			expect(fetch).toHaveBeenLastCalledWith('/users?page=2', expect.any(Object));
		});

		it('should subscribe manually', async () => {
			const result = await GET('/users', { apiId: 'users' });
			const callback = mock();

			const { subscriptionId, unsubscribe } = result.subscribe(callback);

			expect(subscriptionId).toBeTruthy();
			expect(unsubscribe).toBeFunction();
			expect(subscriptions.get('users')[subscriptionId]).toBeDefined();
		});

		it('refetch is a no-op after unsubscribe; no callback, no network request', async () => {
			const onResponse = mock();
			const result = await GET('/users', { apiId: 'users', onResponse });

			result.unsubscribe();
			const fetchCallsBefore = fetch.mock.calls.length;
			const callbackCallsBefore = onResponse.mock.calls.length;

			await result.refetch();

			expect(fetch.mock.calls.length).toBe(fetchCallsBefore);
			expect(onResponse.mock.calls.length).toBe(callbackCallsBefore);
		});
	});

	describe('cache invalidation', () => {
		it('should invalidate cache on successful mutation', async () => {
			await GET('/users', { apiId: 'users' });
			expect(cache.size).toBe(1);

			await POST('/users', {
				body: { name: 'John' },
				invalidates: ['users'],
			});

			expect(cache.size).toBe(0);
		});

		it('should not invalidate cache on failed mutation', async () => {
			global.fetch = mock()
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'users' }),
					text: () => Promise.resolve(''),
				})
				.mockResolvedValueOnce({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Server error' }),
					text: () => Promise.resolve(''),
				});

			await GET('/users', { apiId: 'users' });
			expect(cache.size).toBe(1);

			await POST('/users', {
				body: { name: 'John' },
				invalidates: ['users'],
			});

			expect(cache.size).toBe(1);
		});

		it('should refetch subscriptions on invalidation', async () => {
			const onResponse = mock();

			await GET('/users', { apiId: 'users', onResponse });
			const initialCalls = onResponse.mock.calls.length;

			await POST('/users', {
				body: { name: 'John' },
				invalidates: ['users'],
			});

			expect(onResponse.mock.calls.length).toBeGreaterThan(initialCalls);
		});

		it('should handle array invalidation', async () => {
			await GET('/users', { apiId: 'users' });
			await GET('/posts', { apiId: 'posts' });
			expect(cache.size).toBe(2);

			await POST('/refresh', { invalidates: ['users', 'posts'] });

			expect(cache.size).toBe(0);
		});

		it('should match cacheId for invalidation', async () => {
			await GET('/users', { cacheId: 'custom-users' });
			expect(cache.size).toBe(1);

			await POST('/users', { invalidates: ['custom-users'] });

			expect(cache.size).toBe(0);
		});

		it('should clear all caches matching a wildcard prefix', async () => {
			await GET('/users', { cacheId: 'users-page-1' });
			await GET('/users', { cacheId: 'users-page-2' });
			await GET('/posts', { cacheId: 'posts-page-1' });
			expect(cache.size).toBe(3);

			await POST('/refresh', { invalidates: ['users-page-*'] });

			expect(cache.has('users-page-1')).toBe(false);
			expect(cache.has('users-page-2')).toBe(false);
			expect(cache.has('posts-page-1')).toBe(true);
		});

		it('should match a string invalidation key against an array apiId via includes', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: ['users', 'admin'], onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await POST('/refresh', { invalidates: ['users'] });

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it("subscriber fires before the mutation's await resolves", async () => {
			const order = [];
			await GET('/users', { apiId: 'users', onResponse: () => order.push('subscriber') });
			order.length = 0; // reset: only track what happens around the mutation

			await POST('/users', { body: {}, invalidates: ['users'] });
			order.push('after-await');

			expect(order).toEqual(['subscriber', 'after-await']);
		});

		it('should trigger subscriber refetch for prefix-matched entries', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: 'users', cacheId: 'users-page-1', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await POST('/refresh', { invalidates: ['users-page-*'] });

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it('should refetch subscriptions whose cache entry has TTL-expired', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: 'users', invalidateAfter: 50, onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await new Promise(resolve => setTimeout(resolve, 100));
			expect(cache.size).toBe(0);

			await POST('/users', { body: { name: 'John' }, invalidates: ['users'] });

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it('should match a TTL-expired subscription by cacheId', async () => {
			const onResponse = mock();
			await GET('/users', { cacheId: 'custom-users', invalidateAfter: 50, onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await new Promise(resolve => setTimeout(resolve, 100));
			expect(cache.size).toBe(0);

			await POST('/users', { invalidates: ['custom-users'] });

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});
	});

	describe('enabled option', () => {
		it('should not make request when enabled is false', async () => {
			const result = await GET('/users', { enabled: false });

			expect(fetch).not.toHaveBeenCalled();
			expect(result.status).toBe('idle');
			expect(result.body).toBe(null);
		});

		it('should notify a subscriber when its refetch is called on a disabled endpoint', async () => {
			const onResponse = mock();
			const result = await GET('/users', { apiId: 'users', enabled: false, onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await result.refetch();

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it('should register subscription even when enabled is false', async () => {
			const onResponse = mock();

			const result = await GET('/users', { apiId: 'users', enabled: false, onResponse });

			expect(fetch).not.toHaveBeenCalled();
			expect(subscriptions.has('users')).toBe(true);
			expect(result.subscriptionId).toBeTruthy();
		});

		it('should have null response when enabled is false', async () => {
			const result = await GET('/users', { enabled: false });

			expect(result.response).toBeNull();
		});
	});

	describe('fetch options', () => {
		it('should merge custom fetch options', async () => {
			const fetchOptions = {
				headers: { Authorization: 'Bearer token' },
				credentials: 'include',
			};

			await GET('/users', { fetchOptions });

			expect(fetch).toHaveBeenCalledWith(
				'/users',
				expect.objectContaining({
					credentials: 'include',
					headers: { Authorization: 'Bearer token' },
					method: 'GET',
					body: null,
				}),
			);
		});

		it('should allow overriding content-type', async () => {
			const fetchOptions = {
				headers: { 'Content-Type': 'text/plain' },
			};

			await GET('/users', { fetchOptions });

			expect(fetch).toHaveBeenCalledWith(
				'/users',
				expect.objectContaining({
					headers: { 'Content-Type': 'text/plain' },
				}),
			);
		});
	});

	describe('result object', () => {
		it('should return complete result object', async () => {
			const result = await GET('/users/:id', {
				urlParameters: { id: '123' },
				searchParameters: { include: 'posts' },
				apiId: 'user-123',
			});

			expect(result).toMatchObject({
				originalUrl: '/users/:id',
				url: '/users/123?include=posts',
				apiId: 'user-123',
				cacheId: 'GET/users/123?include=posts',
				status: 'success',
				contentType: 'application/json',
				body: { data: 'test' },
			});
		});

		it('should generate default apiId and cacheId', async () => {
			const result = await GET('/users');

			expect(result.apiId).toBe('GET/users');
			expect(result.cacheId).toBe('GET/users');
		});
	});

	describe('status field', () => {
		it('should be idle when enabled is false', async () => {
			const result = await GET('/users', { enabled: false });

			expect(result.status).toBe('idle');
		});

		it('should be success on a 2xx response', async () => {
			const result = await GET('/users');

			expect(result.status).toBe('success');
		});

		it('should be error on a non-2xx response', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 404,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Not found' }),
					text: () => Promise.resolve(''),
				}),
			);

			const result = await GET('/users');

			expect(result.status).toBe('error');
		});

		it('should be error on a network failure', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));

			const result = await GET('/users');

			expect(result.status).toBe('error');
		});

		it('should be error on abort', async () => {
			global.fetch = mock(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));

			const result = await GET('/users');

			expect(result.status).toBe('error');
		});

		it('subscriber receives status on every callback', async () => {
			const received = [];
			await GET('/users', { apiId: 'users', onResponse: r => received.push(r.status) });

			await POST('/users', { body: {}, invalidates: ['users'] });

			expect(received.every(s => s === 'success')).toBe(true);
		});
	});

	describe('isFetching field', () => {
		it('should be false on a normal completed request', async () => {
			const result = await GET('/users');

			expect(result.isFetching).toBe(false);
		});

		it('should be true on the stale result returned by staleWhileRevalidate', async () => {
			await GET('/data');

			const staleResult = await GET('/data', { staleWhileRevalidate: true });

			expect(staleResult.isFetching).toBe(true);
		});

		it('should be false when staleWhileRevalidate serves fresh data (no cache)', async () => {
			const result = await GET('/data', { staleWhileRevalidate: true });

			expect(result.isFetching).toBe(false);
			expect(result.status).toBe('success');
		});

		it('subscriber receives isFetching false when background revalidation completes', async () => {
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const received = [];
			await GET('/data', { apiId: 'data', staleWhileRevalidate: true, onResponse: r => received.push(r.isFetching) });

			await GET('/data', { apiId: 'data', staleWhileRevalidate: true });
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(received.every(f => f === false)).toBe(true);
		});
	});

	describe('edge cases', () => {
		it('should handle empty response body', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 204,
					headers: new Map(),
					json: () => Promise.reject(new Error('No content')),
					text: () => Promise.resolve(''),
				}),
			);

			const result = await GET('/users');

			expect(result.status).toBe('success');
			expect(result.body).toBe('');
		});

		it('should handle network errors', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));

			const result = await GET('/users');

			expect(result.status).toBe('error');
			expect(result.body).toBeInstanceOf(Error);
			expect(result.body.message).toBe('Network error');
		});
	});

	describe('complex scenarios', () => {
		it('should handle full CRUD workflow', async () => {
			const onResponse = mock();

			await GET('/users', { apiId: 'users', onResponse });
			const initialCalls = onResponse.mock.calls.length;

			await POST('/users', {
				body: { name: 'John' },
				invalidates: ['users'],
			});
			expect(onResponse.mock.calls.length).toBeGreaterThan(initialCalls);

			const afterCreate = onResponse.mock.calls.length;

			await PATCH('/users/:id', {
				urlParameters: { id: '123' },
				body: { name: 'Jane' },
				invalidates: ['users'],
			});
			expect(onResponse.mock.calls.length).toBeGreaterThan(afterCreate);

			const afterUpdate = onResponse.mock.calls.length;

			await DELETE('/users/:id', {
				urlParameters: { id: '123' },
				invalidates: ['users'],
			});
			expect(onResponse.mock.calls.length).toBeGreaterThan(afterUpdate);
		});

		it('should handle different cache and subscription keys', async () => {
			const onResponse = mock();

			await GET('/users/page1', {
				apiId: 'users',
				cacheId: 'users-page-1',
				onResponse,
			});

			await GET('/users/page2', {
				apiId: 'users',
				cacheId: 'users-page-2',
			});

			expect(cache.size).toBe(2);
			expect(subscriptions.has('users')).toBe(true);

			const initialCalls = onResponse.mock.calls.length;

			const postResult = await POST('/users', {
				body: { name: 'John' },
				invalidates: ['users-page-1'],
			});

			expect(postResult.status).toBe('success');

			expect(onResponse.mock.calls.length).toBeGreaterThan(initialCalls);

			expect(cache.has('users-page-1')).toBe(true);
			expect(cache.has('users-page-2')).toBe(true);
			expect(cache.size).toBe(2);
		});
	});

	describe('per-subscriber refetch isolation', () => {
		it('each subscriber refetches its own URL when invalidation fires', async () => {
			const fetchedUrls = [];
			global.fetch = mock(url => {
				fetchedUrls.push(url);
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ url }),
					text: () => Promise.resolve(''),
				});
			});

			await GET('/users/1', { apiId: 'users', onResponse: mock() });
			await GET('/users/2', { apiId: 'users', onResponse: mock() });

			fetchedUrls.length = 0;

			await POST('/users', { body: {}, invalidates: ['users'] });

			expect(fetchedUrls).toContain('/users/1');
			expect(fetchedUrls).toContain('/users/2');
		});

		it('each subscriber refetches exactly once even when multiple cache entries share an apiId', async () => {
			const fetchedUrls = [];
			global.fetch = mock(url => {
				fetchedUrls.push(url);
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ url }),
					text: () => Promise.resolve(''),
				});
			});

			await GET('/users/1', { apiId: 'users', cacheId: 'users-1', onResponse: mock() });
			await GET('/users/2', { apiId: 'users', cacheId: 'users-2', onResponse: mock() });

			fetchedUrls.length = 0;

			// Invalidates both cache entries by apiId; without the fix each subscriber fires twice
			await POST('/users', { body: {}, invalidates: ['users'] });

			const url1Hits = fetchedUrls.filter(u => u === '/users/1').length;
			const url2Hits = fetchedUrls.filter(u => u === '/users/2').length;
			expect(url1Hits).toBe(1);
			expect(url2Hits).toBe(1);
		});

		it('when a subscription refetch fires only that subscriber onResponse is called', async () => {
			const cb1 = mock();
			const cb2 = mock();

			const result1 = await GET('/users', { apiId: 'users', onResponse: cb1 });
			await GET('/users', { apiId: 'users', onResponse: cb2 });

			const cb2CallsBefore = cb2.mock.calls.length;

			await result1.refetch();

			expect(cb2.mock.calls.length).toBe(cb2CallsBefore);
		});
	});

	describe('array apiId', () => {
		it('should notify subscribers when invalidating by matching array', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: ['users', 'admin'], onResponse });
			const callsBefore = onResponse.mock.calls.length;

			await POST('/admin', { body: {}, invalidates: [['users', 'admin']] });

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it('should share subscription group across separate array instances with the same values', async () => {
			const cb1 = mock();
			const cb2 = mock();

			await GET('/users', { apiId: ['users', 'admin'], onResponse: cb1 });
			await GET('/posts', { apiId: ['users', 'admin'], onResponse: cb2 });

			const cb2Before = cb2.mock.calls.length;

			await POST('/admin', { body: {}, invalidates: [['users', 'admin']] });

			expect(cb1.mock.calls.length).toBeGreaterThan(1);
			expect(cb2.mock.calls.length).toBeGreaterThan(cb2Before);
		});

		it('should not cross-notify array apiId groups with different values', async () => {
			const cb1 = mock();
			const cb2 = mock();

			await GET('/users', { apiId: ['users', 'admin'], onResponse: cb1 });
			await GET('/posts', { apiId: ['posts'], onResponse: cb2 });

			const cb2Before = cb2.mock.calls.length;

			await POST('/admin', { body: {}, invalidates: [['users', 'admin']] });

			expect(cb2.mock.calls.length).toBe(cb2Before);
		});

		it('should treat arrays with the same values in different orders as the same group', async () => {
			const cb1 = mock();
			const cb2 = mock();

			await GET('/users', { apiId: ['users', 'admin'], onResponse: cb1 });
			await GET('/posts', { apiId: ['admin', 'users'], onResponse: cb2 });

			const cb2Before = cb2.mock.calls.length;

			await POST('/admin', { body: {}, invalidates: [['users', 'admin']] });

			expect(cb1.mock.calls.length).toBeGreaterThan(1);
			expect(cb2.mock.calls.length).toBeGreaterThan(cb2Before);
		});
	});

	describe('Content-Type header', () => {
		it('should not send Content-Type on GET requests', async () => {
			await GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers).not.toHaveProperty('Content-Type');
		});

		it('should send Content-Type: application/json on mutations with a body', async () => {
			await POST('/users', { body: { name: 'John' } });

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers['Content-Type']).toBe('application/json');
		});

		it('should not send Content-Type on mutations without a body', async () => {
			await DELETE('/users/123');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers).not.toHaveProperty('Content-Type');
		});

		it('should allow overriding Content-Type on mutations', async () => {
			await POST('/upload', {
				body: 'raw',
				fetchOptions: { headers: { 'Content-Type': 'text/plain' } },
			});

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers['Content-Type']).toBe('text/plain');
		});
	});

	describe('in-flight deduplication', () => {
		it('should deduplicate concurrent requests to the same endpoint', async () => {
			let resolve;
			global.fetch = mock(
				() =>
					new Promise(r => {
						resolve = r;
					}),
			);

			const p1 = GET('/users');
			const p2 = GET('/users');

			resolve({
				status: 200,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ data: 'test' }),
				text: () => Promise.resolve(''),
			});

			const [r1, r2] = await Promise.all([p1, p2]);

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(r1).toBe(r2);
		});

		it('should not deduplicate when cache is disabled', async () => {
			await Promise.all([GET('/users', { cache: false }), GET('/users', { cache: false })]);

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should not deduplicate when onResponse is provided', async () => {
			await Promise.all([GET('/users', { onResponse: mock() }), GET('/users', { onResponse: mock() })]);

			expect(fetch).toHaveBeenCalledTimes(2);
		});
	});

	describe('deduplicate option', () => {
		it('should deduplicate concurrent mutations when deduplicate is true', async () => {
			let resolve;
			global.fetch = mock(
				() =>
					new Promise(r => {
						resolve = r;
					}),
			);

			const p1 = POST('/users', { body: { name: 'Alice' }, deduplicate: true });
			const p2 = POST('/users', { body: { name: 'Alice' }, deduplicate: true });

			resolve({
				status: 201,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ id: 1 }),
				text: () => Promise.resolve(''),
			});

			const [r1, r2] = await Promise.all([p1, p2]);

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(r1).toBe(r2);
		});

		it('should not deduplicate sequential mutations even with deduplicate true', async () => {
			await POST('/users', { body: { name: 'Alice' }, deduplicate: true });
			await POST('/users', { body: { name: 'Alice' }, deduplicate: true });

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should not deduplicate concurrent mutations without deduplicate', async () => {
			await Promise.all([POST('/users', { body: { name: 'Alice' } }), POST('/users', { body: { name: 'Alice' } })]);

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should not deduplicate when onResponse is provided', async () => {
			await Promise.all([
				POST('/users', { body: {}, deduplicate: true, onResponse: mock() }),
				POST('/users', { body: {}, deduplicate: true, onResponse: mock() }),
			]);

			expect(fetch).toHaveBeenCalledTimes(2);
		});
	});

	describe('retry', () => {
		it('should retry on network error and succeed', async () => {
			global.fetch = mock()
				.mockRejectedValueOnce(new Error('Network error'))
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'test' }),
					text: () => Promise.resolve(''),
				});

			const result = await GET('/users', { retry: 2, retryDelay: 0 });

			expect(fetch).toHaveBeenCalledTimes(3);
			expect(result.status).toBe('success');
		});

		it('should fail after exhausting retries', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));

			const result = await GET('/users', { retry: 2, retryDelay: 0 });

			expect(fetch).toHaveBeenCalledTimes(3);
			expect(result.status).toBe('error');
			expect(result.body).toBeInstanceOf(Error);
		});

		it('should call onSettled when all retries are exhausted', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));

			const onSettled = mock();
			const context = { snapshot: 'previous' };

			await POST('/users', {
				body: { name: 'John' },
				retry: 1,
				retryDelay: 0,
				onMutate: () => context,
				onSettled,
			});

			expect(fetch).toHaveBeenCalledTimes(2);
			expect(onSettled).toHaveBeenCalledTimes(1);
			expect(onSettled.mock.calls[0][0].status).toBe('error');
			expect(onSettled.mock.calls[0][1]).toBe(context);
		});

		it('should not retry on HTTP error responses', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Server error' }),
					text: () => Promise.resolve(''),
				}),
			);

			const result = await GET('/users', { retry: 2, retryDelay: 0 });

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('error');
		});

		it('should accept retryDelay as a function', async () => {
			global.fetch = mock()
				.mockRejectedValueOnce(new Error('Network error'))
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'test' }),
					text: () => Promise.resolve(''),
				});

			const delayFn = mock(() => 0);
			const result = await GET('/users', { retry: 1, retryDelay: delayFn });

			expect(delayFn).toHaveBeenCalledWith(1);
			expect(result.status).toBe('success');
		});

		it('should pass incrementing attempt numbers to retryDelay', async () => {
			global.fetch = mock()
				.mockRejectedValueOnce(new Error('fail'))
				.mockRejectedValueOnce(new Error('fail'))
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'test' }),
					text: () => Promise.resolve(''),
				});

			const delayFn = mock(() => 0);
			await GET('/users', { retry: 2, retryDelay: delayFn });

			expect(delayFn.mock.calls[0][0]).toBe(1);
			expect(delayFn.mock.calls[1][0]).toBe(2);
		});
	});

	describe('select', () => {
		it('should transform the body on the return value', async () => {
			const result = await GET('/users', { select: data => data.data });
			expect(result.body).toBe('test');
		});

		it('should transform the body delivered to onResponse', async () => {
			const received = [];
			await GET('/users', {
				apiId: 'users',
				select: data => data.data,
				onResponse: r => received.push(r.body),
			});
			expect(received.at(-1)).toBe('test');
		});

		it('should not store the transformed body in cache; raw body is cached', async () => {
			await GET('/users', { select: data => data.data });
			const entry = Array.from(cache.values())[0];
			expect(entry.result.body).toEqual({ data: 'test' });
		});

		it('should apply select on a cache hit', async () => {
			await GET('/users');
			const result = await GET('/users', { select: data => data.data });
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(result.body).toBe('test');
		});

		it('each subscriber applies its own select independently', async () => {
			const received1 = [];
			const received2 = [];

			await GET('/users', {
				apiId: 'users',
				select: data => data.data,
				onResponse: r => received1.push(r.body),
			});
			await GET('/users', {
				apiId: 'users',
				select: () => 'custom',
				onResponse: r => received2.push(r.body),
			});

			await POST('/users', { body: {}, invalidates: ['users'] });
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(received1.at(-1)).toBe('test');
			expect(received2.at(-1)).toBe('custom');
		});

		it('should apply select to onSuccess', async () => {
			const received = [];
			await GET('/users', {
				select: data => data.data,
				onSuccess: r => received.push(r.body),
			});
			expect(received.at(-1)).toBe('test');
		});

		it('should apply select to onSettled on success', async () => {
			const received = [];
			await GET('/users', {
				select: data => data.data,
				onSettled: r => received.push(r.body),
			});
			expect(received.at(-1)).toBe('test');
		});

		it('should not apply select to onError; error bodies pass through raw', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'boom' }),
					text: () => Promise.resolve(''),
				}),
			);
			const received = [];
			await GET('/users', {
				select: data => data.users, // would produce undefined if called on { error: 'boom' }
				onError: r => received.push(r.body),
			});
			expect(received.at(-1)).toEqual({ error: 'boom' });
		});

		it('should not apply select to the return value on error', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'boom' }),
					text: () => Promise.resolve(''),
				}),
			);
			const result = await GET('/users', { select: data => data.users });
			expect(result.status).toBe('error');
			expect(result.body).toEqual({ error: 'boom' });
		});

		it('should not apply select when result is a network error', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));
			const received = [];
			await GET('/users', {
				select: data => data.users,
				onError: r => received.push(r.body),
			});
			expect(received.at(-1)).toBeInstanceOf(Error);
		});

		it('should apply select on a staleWhileRevalidate cache hit', async () => {
			await GET('/data');
			const result = await GET('/data', { select: data => data.data, staleWhileRevalidate: true });
			expect(result.body).toBe('test');
			expect(result.isFetching).toBe(true);
		});
	});

	describe('setCache', () => {
		it('should update cached body and notify subscribers', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			setCache('GET/users', [{ id: 1, name: 'Optimistic User' }]);

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
			const lastResult = onResponse.mock.calls.at(-1)[0];
			expect(lastResult.body).toEqual([{ id: 1, name: 'Optimistic User' }]);
		});

		it('should accept an updater function with the current body', async () => {
			await GET('/users');

			setCache('GET/users', body => ({ ...body, optimistic: true }));

			const entry = cache.get('GET/users');
			expect(entry.result.body).toMatchObject({ data: 'test', optimistic: true });
		});

		it('should be a no-op for unknown cacheIds', () => {
			expect(() => setCache('nonexistent', {})).not.toThrow();
			expect(cache.size).toBe(0);
		});

		it('should reflect the updated body on subsequent cache hits', async () => {
			await GET('/users');
			setCache('GET/users', { optimistic: true });

			const result = await GET('/users');
			expect(result.body).toEqual({ optimistic: true });
		});
	});

	describe('staleWhileRevalidate', () => {
		it('should return stale data immediately then push fresh data to subscribers', async () => {
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const received = [];
			await GET('/data', { apiId: 'data', staleWhileRevalidate: true, onResponse: r => received.push(r.body) });

			expect(received).toEqual([{ version: 1 }]);

			const result = await GET('/data', { apiId: 'data', staleWhileRevalidate: true });

			expect(result.body).toEqual({ version: 1 });

			await new Promise(resolve => setTimeout(resolve, 20));

			expect(fetch).toHaveBeenCalledTimes(2);
			expect(received).toContainEqual({ version: 2 });
		});

		it('should not start a second background revalidation while one is in flight', async () => {
			await GET('/data');

			await Promise.all([
				GET('/data', { staleWhileRevalidate: true }),
				GET('/data', { staleWhileRevalidate: true }),
				GET('/data', { staleWhileRevalidate: true }),
			]);

			await new Promise(resolve => setTimeout(resolve, 20));

			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('should return isFetching true on all concurrent stale hits, not only the one that starts revalidation', async () => {
			await GET('/data');

			const [r1, r2, r3] = await Promise.all([
				GET('/data', { staleWhileRevalidate: true }),
				GET('/data', { staleWhileRevalidate: true }),
				GET('/data', { staleWhileRevalidate: true }),
			]);

			expect(r1.isFetching).toBe(true);
			expect(r2.isFetching).toBe(true);
			expect(r3.isFetching).toBe(true);
		});

		it('should fetch normally when the cache is empty', async () => {
			const result = await GET('/data', { staleWhileRevalidate: true });

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('success');
		});

		it('should push fresh data to all active subscribers on background revalidation', async () => {
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const received1 = [],
				received2 = [];
			await GET('/data', { apiId: 'data', staleWhileRevalidate: true, onResponse: r => received1.push(r.body) });
			await GET('/data', { apiId: 'data', staleWhileRevalidate: true, onResponse: r => received2.push(r.body) });

			await GET('/data', { apiId: 'data', staleWhileRevalidate: true });
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(received1).toContainEqual({ version: 2 });
			expect(received2).toContainEqual({ version: 2 });
		});

		it('should not revalidate when staleWhileRevalidate is false', async () => {
			await GET('/data');
			await GET('/data');

			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it('should return idle result when enabled is false even if cache is warm and staleWhileRevalidate is true', async () => {
			await GET('/data');

			const result = await GET('/data', { enabled: false, staleWhileRevalidate: true });

			expect(result.status).toBe('idle');
			expect(result.isFetching).toBe(false);
			expect(fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe('configure', () => {
		it('should apply default invalidateAfter across requests', async () => {
			const client = createClient();
			client.configure({ invalidateAfter: 100 });

			await client.GET('/users');
			expect(client.cache.size).toBe(1);

			await new Promise(resolve => setTimeout(resolve, 150));
			expect(client.cache.size).toBe(0);
		});

		it('should apply default retry', async () => {
			const client = createClient();
			client.configure({ retry: 1, retryDelay: 0 });

			global.fetch = mock()
				.mockRejectedValueOnce(new Error('fail'))
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'test' }),
					text: () => Promise.resolve(''),
				});

			const result = await client.GET('/users');
			expect(fetch).toHaveBeenCalledTimes(2);
			expect(result.status).toBe('success');
		});

		it('should merge global fetchOptions headers into every request', async () => {
			const client = createClient();
			client.configure({ fetchOptions: { headers: { Authorization: 'Bearer token' } } });

			await client.GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers.Authorization).toBe('Bearer token');
		});

		it('should allow per-call headers to override global headers', async () => {
			const client = createClient();
			client.configure({ fetchOptions: { headers: { Authorization: 'Bearer global' } } });

			await client.GET('/users', { fetchOptions: { headers: { Authorization: 'Bearer call' } } });

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers.Authorization).toBe('Bearer call');
		});

		it('should merge per-call headers with global headers', async () => {
			const client = createClient();
			client.configure({ fetchOptions: { headers: { Authorization: 'Bearer token', 'X-Global': 'yes' } } });

			await client.GET('/users', { fetchOptions: { headers: { 'X-Custom': 'custom' } } });

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers.Authorization).toBe('Bearer token');
			expect(fetchArgs.headers['X-Global']).toBe('yes');
			expect(fetchArgs.headers['X-Custom']).toBe('custom');
		});
	});

	describe('onSuccess and onError', () => {
		it('should call onSuccess on a successful response', async () => {
			const onSuccess = mock();
			await POST('/users', { body: { name: 'John' }, onSuccess });
			expect(onSuccess).toHaveBeenCalledTimes(1);
			expect(onSuccess.mock.calls[0][0].status).toBe('success');
		});

		it('should not call onError on a successful response', async () => {
			const onError = mock();
			await POST('/users', { body: { name: 'John' }, onError });
			expect(onError).not.toHaveBeenCalled();
		});

		it('should call onError on a failed response', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 400,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Bad request' }),
					text: () => Promise.resolve(''),
				}),
			);

			const onError = mock();
			await POST('/users', { body: { name: 'John' }, onError });
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError.mock.calls[0][0].status).toBe('error');
		});

		it('should not call onSuccess on a failed response', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 400,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Bad request' }),
					text: () => Promise.resolve(''),
				}),
			);

			const onSuccess = mock();
			await POST('/users', { body: { name: 'John' }, onSuccess });
			expect(onSuccess).not.toHaveBeenCalled();
		});

		it('should allow seeding cache from mutation response without a round-trip refetch', async () => {
			let fetchCount = 0;
			global.fetch = mock(() => {
				fetchCount++;
				if (fetchCount === 1)
					return Promise.resolve({
						status: 200,
						headers: new Map([['content-type', 'application/json']]),
						json: () => Promise.resolve([{ id: 0 }]),
						text: () => Promise.resolve(''),
					});
				return Promise.resolve({
					status: 201,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ id: 1, name: 'John' }),
					text: () => Promise.resolve(''),
				});
			});

			const received = [];
			await GET('/users', { apiId: 'users', onResponse: r => received.push(r.body) });

			await POST('/users', {
				body: { name: 'John' },
				onSuccess: result => setCache('GET/users', old => [...old, result.body]),
			});

			expect(fetch).toHaveBeenCalledTimes(2);
			expect(received.at(-1)).toEqual([{ id: 0 }, { id: 1, name: 'John' }]);
		});
	});

	describe('onMutate and onSettled', () => {
		it('should call onMutate before the fetch', async () => {
			const order = [];
			global.fetch = mock(() => {
				order.push('fetch');
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				});
			});

			await POST('/users', {
				body: { name: 'John' },
				onMutate: () => {
					order.push('onMutate');
				},
			});

			expect(order).toEqual(['onMutate', 'fetch']);
		});

		it('should pass request inputs to onMutate', async () => {
			let received;

			await POST('/users/:id', {
				urlParameters: { id: '42' },
				searchParameters: { v: '2' },
				body: { name: 'John' },
				onMutate: inputs => {
					received = inputs;
				},
			});

			expect(received).toMatchObject({
				url: '/users/:id',
				method: 'POST',
				body: { name: 'John' },
				urlParameters: { id: '42' },
				searchParameters: { v: '2' },
			});
		});

		it('should pass onMutate return value as context to onSettled on error', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Server error' }),
					text: () => Promise.resolve(''),
				}),
			);

			const receivedContexts = [];
			await POST('/users', {
				body: { name: 'John' },
				onMutate: () => ({ snapshot: 'previous-state' }),
				onSettled: (result, context) => {
					if (result.status === 'error') receivedContexts.push(context);
				},
			});

			expect(receivedContexts).toEqual([{ snapshot: 'previous-state' }]);
		});

		it('should call onSettled on success with context', async () => {
			const onSettled = mock();
			const context = { snapshot: 'previous-state' };

			await POST('/users', {
				body: { name: 'John' },
				onMutate: () => context,
				onSettled,
			});

			expect(onSettled).toHaveBeenCalledTimes(1);
			expect(onSettled.mock.calls[0][0].status).toBe('success');
			expect(onSettled.mock.calls[0][1]).toBe(context);
		});

		it('should call onSettled on error with context', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Server error' }),
					text: () => Promise.resolve(''),
				}),
			);

			const onSettled = mock();
			const context = { snapshot: 'previous-state' };

			await POST('/users', {
				body: { name: 'John' },
				onMutate: () => context,
				onSettled,
			});

			expect(onSettled).toHaveBeenCalledTimes(1);
			expect(onSettled.mock.calls[0][0].status).toBe('error');
			expect(onSettled.mock.calls[0][1]).toBe(context);
		});

		it('should call onSettled with context on abort', async () => {
			const controller = new AbortController();
			global.fetch = mock(
				(url, options) =>
					new Promise((_, reject) => {
						options.signal?.addEventListener('abort', () => {
							reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
						});
					}),
			);

			const receivedContexts = [];
			const pending = POST('/users', {
				body: { name: 'John' },
				fetchOptions: { signal: controller.signal },
				onMutate: () => ({ snapshot: 'previous-state' }),
				onSettled: (result, context) => receivedContexts.push(context),
			});

			await new Promise(resolve => setTimeout(resolve, 0));
			controller.abort();
			await pending;

			expect(receivedContexts).toEqual([{ snapshot: 'previous-state' }]);
		});

		it('should not apply select to onSettled on network error; error bodies pass through raw', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));
			const received = [];
			await GET('/users', {
				select: data => data.users, // would produce undefined if called on an Error
				onSettled: r => received.push(r.body),
			});
			expect(received.at(-1)).toBeInstanceOf(Error);
		});

		it('should support optimistic update with rollback on error', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve([{ id: 1, name: 'Alice' }]),
					text: () => Promise.resolve(''),
				}),
			);

			const received = [];
			await GET('/users', { apiId: 'users', onResponse: r => received.push(r.body) });

			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'Server error' }),
					text: () => Promise.resolve(''),
				}),
			);

			await POST('/users', {
				body: { name: 'Bob' },
				onMutate: ({ body }) => {
					const previous = received.at(-1);
					setCache('GET/users', old => [...old, { id: 2, name: body.name }]);
					return { previous };
				},
				onSettled: (result, context) => {
					if (result.status === 'error') setCache('GET/users', context.previous);
				},
			});

			expect(received.at(-1)).toEqual([{ id: 1, name: 'Alice' }]);
		});
	});

	describe('createClient', () => {
		it('should create independent client instances', () => {
			const client1 = createClient();
			const client2 = createClient();

			expect(client1.cache).not.toBe(client2.cache);
			expect(client1.subscriptions).not.toBe(client2.subscriptions);
		});

		it('should not share cache between instances', async () => {
			const client1 = createClient();
			const client2 = createClient();

			await client1.GET('/users');

			expect(client1.cache.size).toBe(1);
			expect(client2.cache.size).toBe(0);
		});

		it('should not share subscriptions between instances', async () => {
			const client1 = createClient();
			const client2 = createClient();
			const onResponse = mock();

			await client1.GET('/users', { apiId: 'users', onResponse });

			expect(client1.subscriptions.has('users')).toBe(true);
			expect(client2.subscriptions.has('users')).toBe(false);
		});

		it('should clear in-flight pending requests so a subsequent GET re-fetches', async () => {
			const client = createClient();
			let resolveFirst;
			global.fetch = mock(
				() =>
					new Promise(r => {
						resolveFirst = r;
					}),
			);

			const slowGet = client.GET('/users');
			client.resetRequest();

			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'fresh' }),
					text: () => Promise.resolve(''),
				}),
			);

			const freshResult = await client.GET('/users');
			expect(freshResult.body).toEqual({ data: 'fresh' });
			expect(fetch).toHaveBeenCalledTimes(1);

			resolveFirst({
				status: 200,
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({ data: 'stale' }),
				text: () => Promise.resolve(''),
			});
			await slowGet;
		});

		it('should reset only its own state', async () => {
			const client1 = createClient();
			const client2 = createClient();

			await client1.GET('/users');
			await client2.GET('/users');

			client1.resetRequest();

			expect(client1.cache.size).toBe(0);
			expect(client2.cache.size).toBe(1);
		});
	});

	describe('request cancellation', () => {
		it('should abort in-flight requests when resetRequest is called', async () => {
			let capturedSignal;
			global.fetch = mock((url, options) => {
				capturedSignal = options.signal;
				return new Promise((_, reject) => {
					options.signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
					});
				});
			});

			const getPromise = GET('/users');
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(capturedSignal).toBeDefined();
			expect(capturedSignal.aborted).toBe(false);

			resetRequest();

			expect(capturedSignal.aborted).toBe(true);

			const result = await getPromise;
			expect(result.status).toBe('error');
			expect(result.body?.name).toBe('AbortError');
		});

		it('should abort all concurrent in-flight requests sharing the same cacheId', async () => {
			const signals = [];
			global.fetch = mock((url, options) => {
				signals.push(options.signal);
				return new Promise((_, reject) => {
					options.signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			});

			// cache: false bypasses dedup so two concurrent requests reach execute() with the same cacheId
			GET('/users', { cache: false });
			GET('/users', { cache: false });
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(signals).toHaveLength(2);

			resetRequest();

			expect(signals[0].aborted).toBe(true);
			expect(signals[1].aborted).toBe(true);
		});

		it('should not abort requests from other clients on resetRequest', async () => {
			const client1 = createClient();
			const client2 = createClient();

			let signal1, signal2;
			global.fetch = mock((url, options) => {
				if (!signal1) signal1 = options.signal;
				else signal2 = options.signal;
				return new Promise((_, reject) => {
					options.signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			});

			client1.GET('/users');
			client2.GET('/posts');
			await new Promise(resolve => setTimeout(resolve, 0));

			client1.resetRequest();

			expect(signal1.aborted).toBe(true);
			expect(signal2.aborted).toBe(false);

			client2.resetRequest();
		});

		it('should not retry on AbortError', async () => {
			global.fetch = mock(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));

			const result = await GET('/users', { retry: 3, retryDelay: 0 });

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(result.status).toBe('error');
		});

		it('should forward a user-provided signal abort to the internal controller', async () => {
			const userController = new AbortController();
			let capturedSignal;
			global.fetch = mock((url, options) => {
				capturedSignal = options.signal;
				return new Promise((_, reject) => {
					options.signal?.addEventListener('abort', () => {
						reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
					});
				});
			});

			GET('/users', { fetchOptions: { signal: userController.signal } });
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(capturedSignal.aborted).toBe(false);
			userController.abort();
			expect(capturedSignal.aborted).toBe(true);
		});
	});

	describe('refetchOnWindowFocus / refetchOnReconnect', () => {
		beforeEach(() => {
			globalThis.window = new EventTarget();
			globalThis.document = Object.assign(new EventTarget(), { hidden: false });
		});

		afterEach(() => {
			delete globalThis.window;
			delete globalThis.document;
		});

		it('should refetch active subscriptions when window gains focus', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should refetch active subscriptions when document becomes visible', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.document.dispatchEvent(new Event('visibilitychange'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should not refetch when document becomes hidden', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });

			globalThis.document.hidden = true;
			const callsBefore = onResponse.mock.calls.length;

			globalThis.document.dispatchEvent(new Event('visibilitychange'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBe(callsBefore);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should refetch active subscriptions when coming back online', async () => {
			const client = createClient();
			client.configure({ refetchOnReconnect: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('online'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);
			client.configure({ refetchOnReconnect: false });
		});

		it('should stop refetching after refetchOnWindowFocus is disabled', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });

			client.configure({ refetchOnWindowFocus: false });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBe(callsBefore);
		});

		it('should not throw when focus fires with no active subscriptions', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			expect(() => globalThis.window.dispatchEvent(new Event('focus'))).not.toThrow();
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should force a fresh fetch on focus even when cache is warm', async () => {
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse });
			expect(fetch).toHaveBeenCalledTimes(1);

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(fetch).toHaveBeenCalledTimes(2);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should fire only one network request per cacheId when multiple subscribers share the same URL', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const cb1 = mock();
			const cb2 = mock();
			await client.GET('/users', { apiId: 'users', onResponse: cb1 });
			await client.GET('/users', { apiId: 'users', onResponse: cb2 });

			const fetchCallsBefore = fetch.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(fetch.mock.calls.length).toBe(fetchCallsBefore + 1);
			expect(cb1.mock.calls.length).toBeGreaterThan(0);
			expect(cb2.mock.calls.length).toBeGreaterThan(0);

			client.configure({ refetchOnWindowFocus: false });
		});

		it('should remove focus listener on resetRequest so new subscriptions are not triggered by focus', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			client.resetRequest();

			// Re-subscribe after reset; without re-enabling refetchOnWindowFocus
			const onResponse2 = mock();
			await client.GET('/users', { apiId: 'users', onResponse: onResponse2 });
			const callsAfterSubscribe = onResponse2.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse2.mock.calls.length).toBe(callsAfterSubscribe);
		});

		it('should remove online listener on resetRequest', async () => {
			const client = createClient();
			client.configure({ refetchOnReconnect: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			client.resetRequest();

			const onResponse2 = mock();
			await client.GET('/users', { apiId: 'users', onResponse: onResponse2 });
			const callsAfterSubscribe = onResponse2.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('online'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse2.mock.calls.length).toBe(callsAfterSubscribe);
		});

		it('should refetch each unique URL when subscribers share an apiId but fetch different URLs', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const fetchedUrls = [];
			global.fetch = mock(url => {
				fetchedUrls.push(url);
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ url }),
					text: () => Promise.resolve(''),
				});
			});

			await client.GET('/users', {
				apiId: 'users',
				cacheId: 'users-page-1',
				searchParameters: { page: 1 },
				onResponse: mock(),
			});
			await client.GET('/users', {
				apiId: 'users',
				cacheId: 'users-page-2',
				searchParameters: { page: 2 },
				onResponse: mock(),
			});
			fetchedUrls.length = 0;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(fetchedUrls).toContain('/users?page=1');
			expect(fetchedUrls).toContain('/users?page=2');

			client.configure({ refetchOnWindowFocus: false });
		});

		it('should fire only one request per cacheId when multiple subscribers share a URL and cache is expired', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const cb1 = mock();
			const cb2 = mock();
			await client.GET('/users', { apiId: 'users', invalidateAfter: 50, onResponse: cb1 });
			await client.GET('/users', { apiId: 'users', invalidateAfter: 50, onResponse: cb2 });

			await new Promise(resolve => setTimeout(resolve, 80));
			expect(client.cache.size).toBe(0);

			const fetchCallsBefore = fetch.mock.calls.length;
			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(fetch.mock.calls.length).toBe(fetchCallsBefore + 1);
			expect(cb1.mock.calls.length).toBeGreaterThan(0);
			expect(cb2.mock.calls.length).toBeGreaterThan(0);

			client.configure({ refetchOnWindowFocus: false });
		});

		it('should refetch a subscriber whose cache entry has expired (TTL path)', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', {
				apiId: 'users',
				invalidateAfter: 50,
				onResponse,
			});

			// Wait for the cache TTL to expire; subscription should survive
			await new Promise(resolve => setTimeout(resolve, 80));
			expect(client.cache.size).toBe(0);
			expect(client.subscriptions.has('users')).toBe(true);

			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore);

			client.configure({ refetchOnWindowFocus: false });
		});
	});

	describe('refetchInterval', () => {
		it('should hit the network on every tick even when cache is warm', async () => {
			const client = createClient();
			let fetchCount = 0;
			global.fetch = mock(() => {
				fetchCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: fetchCount }),
					text: () => Promise.resolve(''),
				});
			});

			const result = await client.GET('/data', {
				apiId: 'data',
				invalidateAfter: false,
				refetchInterval: 30,
				onResponse: () => {},
			});

			await new Promise(resolve => setTimeout(resolve, 100));
			result.unsubscribe();

			expect(fetchCount).toBeGreaterThan(1);
		});

		it('should stop hitting the network after unsubscribe', async () => {
			const client = createClient();
			let fetchCount = 0;
			global.fetch = mock(() => {
				fetchCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: fetchCount }),
					text: () => Promise.resolve(''),
				});
			});

			const result = await client.GET('/data', {
				apiId: 'data',
				refetchInterval: 30,
				onResponse: () => {},
			});

			await new Promise(resolve => setTimeout(resolve, 60));
			result.unsubscribe();
			const countAfterUnsub = fetchCount;

			await new Promise(resolve => setTimeout(resolve, 80));
			expect(fetchCount).toBe(countAfterUnsub);
		});

		it('should refetch all subscriptions on a global configure interval', async () => {
			const client = createClient();
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const received = [];
			await client.GET('/data', { apiId: 'data', onResponse: r => received.push(r.body.version) });

			client.configure({ refetchInterval: 30 });
			await new Promise(resolve => setTimeout(resolve, 100));
			client.configure({ refetchInterval: false });

			expect(received.length).toBeGreaterThan(1);
		});

		it('should stop global interval on resetRequest', async () => {
			const client = createClient();
			let callCount = 0;
			global.fetch = mock(() => {
				callCount++;
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ version: callCount }),
					text: () => Promise.resolve(''),
				});
			});

			const received = [];
			await client.GET('/data', { apiId: 'data', onResponse: r => received.push(r.body.version) });
			client.configure({ refetchInterval: 30 });
			await new Promise(resolve => setTimeout(resolve, 50));
			client.resetRequest();
			const countAfterReset = received.length;

			await new Promise(resolve => setTimeout(resolve, 80));
			expect(received.length).toBe(countAfterReset);
		});
	});

	describe('refetchOnWindowFocusMinInterval', () => {
		beforeEach(() => {
			globalThis.window = new EventTarget();
			globalThis.document = Object.assign(new EventTarget(), { hidden: false });
		});

		afterEach(() => {
			delete globalThis.window;
			delete globalThis.document;
		});

		it('should throttle focus refetches within the min interval', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true, refetchOnWindowFocusMinInterval: 500 });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));
			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBe(callsBefore + 1);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should allow a focus refetch after the min interval has passed', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true, refetchOnWindowFocusMinInterval: 30 });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 50));
			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsBefore + 1);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should throttle visibilitychange the same as focus', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true, refetchOnWindowFocusMinInterval: 500 });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			const callsBefore = onResponse.mock.calls.length;

			globalThis.document.dispatchEvent(new Event('visibilitychange'));
			await new Promise(resolve => setTimeout(resolve, 10));
			globalThis.document.dispatchEvent(new Event('visibilitychange'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBe(callsBefore + 1);
			client.configure({ refetchOnWindowFocus: false });
		});

		it('should not throttle reconnect even when focus throttle is active', async () => {
			const client = createClient();
			client.configure({
				refetchOnWindowFocus: true,
				refetchOnReconnect: true,
				refetchOnWindowFocusMinInterval: 500,
			});

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });

			// First focus: sets lastWindowRefetch
			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));
			const callsAfterFocus = onResponse.mock.calls.length;

			// Reconnect fires within the throttle window; should NOT be throttled
			globalThis.window.dispatchEvent(new Event('online'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBeGreaterThan(callsAfterFocus);
			client.configure({ refetchOnWindowFocus: false, refetchOnReconnect: false });
		});

		it('should respect min interval set after listeners are attached', async () => {
			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });

			// Set the min interval after listeners are already attached
			client.configure({ refetchOnWindowFocusMinInterval: 500 });

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));
			const callsAfterFirst = onResponse.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse.mock.calls.length).toBe(callsAfterFirst);
			client.configure({ refetchOnWindowFocus: false });
		});
	});

	describe('gcTime', () => {
		it('should remove cache entries after all subscribers unsubscribe', async () => {
			const client = createClient();
			client.configure({ gcTime: 50 });

			const result = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			expect(client.cache.size).toBe(1);

			result.unsubscribe();
			expect(client.cache.size).toBe(1);

			await new Promise(resolve => setTimeout(resolve, 80));
			expect(client.cache.size).toBe(0);
		});

		it('should cancel GC when a new subscriber arrives before the timer fires', async () => {
			const client = createClient();
			client.configure({ gcTime: 80 });

			const result = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			result.unsubscribe();

			await new Promise(resolve => setTimeout(resolve, 20));
			await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });

			await new Promise(resolve => setTimeout(resolve, 100));
			expect(client.cache.size).toBe(1);
		});

		it('should keep cache warm within the default gcTime window after unsubscribe', async () => {
			const client = createClient();

			const result = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			result.unsubscribe();

			// Default gcTime is 5 minutes; cache is still warm immediately after unsubscribe
			expect(client.cache.size).toBe(1);
		});

		it('should clear pending GC timers on resetRequest', async () => {
			const client = createClient();
			client.configure({ gcTime: 200 });

			const result = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			result.unsubscribe();

			client.resetRequest();
			expect(client.cache.size).toBe(0);
		});

		it('should not schedule GC when only one of multiple subscribers unsubscribes', async () => {
			const client = createClient();
			client.configure({ gcTime: 50 });

			const r1 = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });

			r1.unsubscribe();
			await new Promise(resolve => setTimeout(resolve, 80));

			expect(client.cache.size).toBe(1);
		});

		it('should GC all cache entries sharing the same apiId', async () => {
			const client = createClient();
			client.configure({ gcTime: 50 });

			const r1 = await client.GET('/users/page1', {
				apiId: 'users',
				cacheId: 'users-p1',
				invalidateAfter: false,
				onResponse: mock(),
			});
			const r2 = await client.GET('/users/page2', {
				apiId: 'users',
				cacheId: 'users-p2',
				invalidateAfter: false,
				onResponse: mock(),
			});
			expect(client.cache.size).toBe(2);

			r1.unsubscribe();
			r2.unsubscribe();

			await new Promise(resolve => setTimeout(resolve, 80));
			expect(client.cache.size).toBe(0);
		});
	});

	describe('beforeRequest / afterRequest hooks', () => {
		it('should call beforeRequest before the fetch fires', async () => {
			const order = [];
			global.fetch = mock(() => {
				order.push('fetch');
				return Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				});
			});

			const client = createClient();
			client.configure({ beforeRequest: () => order.push('beforeRequest') });
			await client.GET('/users');

			expect(order).toEqual(['beforeRequest', 'fetch']);
		});

		it('should call afterRequest after a successful request', async () => {
			const client = createClient();
			const afterRequest = mock();
			client.configure({ afterRequest });
			await client.GET('/users');

			expect(afterRequest).toHaveBeenCalledTimes(1);
			expect(afterRequest.mock.calls[0][0].result.status).toBe('success');
		});

		it('should call afterRequest after an HTTP error', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'fail' }),
					text: () => Promise.resolve(''),
				}),
			);

			const client = createClient();
			const afterRequest = mock();
			client.configure({ afterRequest });
			await client.GET('/users');

			expect(afterRequest).toHaveBeenCalledTimes(1);
			expect(afterRequest.mock.calls[0][0].result.status).toBe('error');
		});

		it('should call afterRequest after a network error', async () => {
			global.fetch = mock(() => Promise.reject(new Error('Network error')));

			const client = createClient();
			const afterRequest = mock();
			client.configure({ afterRequest });
			await client.GET('/users');

			expect(afterRequest).toHaveBeenCalledTimes(1);
			expect(afterRequest.mock.calls[0][0].result.status).toBe('error');
		});

		it('should call afterRequest after abort', async () => {
			global.fetch = mock(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));

			const client = createClient();
			const afterRequest = mock();
			client.configure({ afterRequest });
			await client.GET('/users');

			expect(afterRequest).toHaveBeenCalledTimes(1);
		});

		it('should receive url and method in beforeRequest', async () => {
			const client = createClient();
			const received = [];
			client.configure({ beforeRequest: ctx => received.push(ctx) });
			await client.POST('/users', { body: { name: 'Alice' } });

			expect(received[0].url).toBe('/users');
			expect(received[0].method).toBe('POST');
		});

		it('should not call beforeRequest on a cache hit', async () => {
			const client = createClient();
			const beforeRequest = mock();
			client.configure({ beforeRequest });

			await client.GET('/users');
			await client.GET('/users');

			expect(beforeRequest).toHaveBeenCalledTimes(1);
		});

		it('should merge headers returned by beforeRequest into the fetch call', async () => {
			const client = createClient();
			client.configure({
				beforeRequest: () => ({ headers: { 'X-Correlation-Id': 'abc123' } }),
			});

			await client.GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers['X-Correlation-Id']).toBe('abc123');
		});

		it('should add beforeRequest headers without clobbering existing headers', async () => {
			const client = createClient();
			client.configure({
				fetchOptions: { headers: { Authorization: 'Bearer token' } },
				beforeRequest: () => ({ headers: { 'X-Correlation-Id': 'abc' } }),
			});

			await client.GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers.Authorization).toBe('Bearer token');
			expect(fetchArgs.headers['X-Correlation-Id']).toBe('abc');
		});

		it('should allow beforeRequest to override other fetchOptions', async () => {
			const client = createClient();
			client.configure({
				beforeRequest: () => ({ credentials: 'include' }),
			});

			await client.GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.credentials).toBe('include');
		});

		it('should support async beforeRequest', async () => {
			const client = createClient();
			client.configure({
				beforeRequest: async () => ({ headers: { 'X-Token': 'dynamic' } }),
			});

			await client.GET('/users');

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers['X-Token']).toBe('dynamic');
		});

		it('beforeRequest headers should override global and per-call fetchOptions headers', async () => {
			const client = createClient();
			client.configure({
				fetchOptions: { headers: { Authorization: 'Bearer global' } },
				beforeRequest: () => ({ headers: { Authorization: 'Bearer dynamic' } }),
			});

			await client.GET('/users', { fetchOptions: { headers: { Authorization: 'Bearer per-call' } } });

			const [, fetchArgs] = fetch.mock.calls[0];
			expect(fetchArgs.headers.Authorization).toBe('Bearer dynamic');
		});
	});

	describe('responseType', () => {
		it('should return text for text/plain by default (auto)', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'text/plain']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve('hello'),
				}),
			);

			const result = await GET('/file');
			expect(result.body).toBe('hello');
		});

		it('should return blob for binary content types by default (auto)', async () => {
			const blob = new Blob(['binary'], { type: 'application/octet-stream' });
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/octet-stream']]),
					blob: () => Promise.resolve(blob),
					text: () => Promise.resolve('corrupted'),
					json: () => Promise.reject(new Error('not json')),
				}),
			);

			const result = await GET('/file');
			expect(result.body).toBeInstanceOf(Blob);
		});

		it('should return blob for image content types by default (auto)', async () => {
			const blob = new Blob([], { type: 'image/png' });
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'image/png']]),
					blob: () => Promise.resolve(blob),
					text: () => Promise.resolve(''),
					json: () => Promise.reject(new Error('not json')),
				}),
			);

			const result = await GET('/avatar.png');
			expect(result.body).toBeInstanceOf(Blob);
		});

		it('should use blob() when responseType is blob', async () => {
			const blob = new Blob(['data'], { type: 'application/json' });
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					blob: () => Promise.resolve(blob),
					json: () => Promise.resolve({ data: 'parsed' }),
					text: () => Promise.resolve(''),
				}),
			);

			const result = await GET('/export', { responseType: 'blob' });
			expect(result.body).toBeInstanceOf(Blob);
		});

		it('should use arrayBuffer() when responseType is arrayBuffer', async () => {
			const buf = new ArrayBuffer(4);
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/octet-stream']]),
					arrayBuffer: () => Promise.resolve(buf),
					blob: () => Promise.resolve(new Blob()),
					text: () => Promise.resolve(''),
					json: () => Promise.reject(new Error('not json')),
				}),
			);

			const result = await GET('/binary', { responseType: 'arrayBuffer' });
			expect(result.body).toBeInstanceOf(ArrayBuffer);
		});

		it('should force text even for json content type when responseType is text', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					text: () => Promise.resolve('{"raw":"string"}'),
					json: () => Promise.resolve({ raw: 'string' }),
				}),
			);

			const result = await GET('/data', { responseType: 'text' });
			expect(result.body).toBe('{"raw":"string"}');
		});

		it('should force json even for non-json content type when responseType is json', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map([['content-type', 'text/plain']]),
					json: () => Promise.resolve({ parsed: true }),
					text: () => Promise.resolve('{"parsed":true}'),
				}),
			);

			const result = await GET('/data', { responseType: 'json' });
			expect(result.body).toEqual({ parsed: true });
		});

		it('should return text when content-type is absent (auto)', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 200,
					headers: new Map(),
					text: () => Promise.resolve('plain'),
					json: () => Promise.reject(new Error('no content type')),
					blob: () => Promise.reject(new Error('no content type')),
				}),
			);

			const result = await GET('/data');
			expect(result.body).toBe('plain');
		});
	});

	describe('clearCache', () => {
		it('should clear all cache entries', async () => {
			await GET('/users');
			await GET('/posts');
			expect(cache.size).toBe(2);

			clearCache();

			expect(cache.size).toBe(0);
		});

		it('should preserve subscriptions', async () => {
			const onResponse = mock();
			await GET('/users', { apiId: 'users', onResponse });
			expect(subscriptions.has('users')).toBe(true);

			clearCache();

			expect(subscriptions.has('users')).toBe(true);
		});

		it('should not affect another client instance', async () => {
			const client1 = createClient();
			const client2 = createClient();

			await client1.GET('/users');
			await client2.GET('/users');

			client1.clearCache();

			expect(client1.cache.size).toBe(0);
			expect(client2.cache.size).toBe(1);
		});

		it('should preserve event listeners; focus still triggers refetch after clearCache', async () => {
			globalThis.window = new EventTarget();
			globalThis.document = Object.assign(new EventTarget(), { hidden: false });

			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const onResponse = mock();
			await client.GET('/users', { apiId: 'users', onResponse });
			client.clearCache();

			const onResponse2 = mock();
			await client.GET('/users', { apiId: 'users', onResponse: onResponse2 });
			const callsBefore = onResponse2.mock.calls.length;

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onResponse2.mock.calls.length).toBeGreaterThan(callsBefore);

			client.configure({ refetchOnWindowFocus: false });
			delete globalThis.window;
			delete globalThis.document;
		});

		it('should cancel TTL timers for cleared entries', async () => {
			await GET('/users', { invalidateAfter: 100 });
			expect(cache.size).toBe(1);

			clearCache();
			expect(cache.size).toBe(0);

			await new Promise(resolve => setTimeout(resolve, 150));
			// No error from a fired timeout trying to delete an already-gone entry
			expect(cache.size).toBe(0);
		});

		it('should cancel pending GC timers; a stale GC timer must not delete entries added after the clear', async () => {
			const client = createClient();
			client.configure({ gcTime: 50 });

			// Subscribe, then unsubscribe; starts a GC timer for this subKey.
			const result = await client.GET('/users', { apiId: 'users', invalidateAfter: false, onResponse: mock() });
			result.unsubscribe();

			// Clear the cache before the GC timer fires.
			client.clearCache();

			// Repopulate the cache with a new request.
			await client.GET('/users', { invalidateAfter: false });
			expect(client.cache.size).toBe(1);

			// The stale GC timer would have fired here if clearCache didn't cancel it.
			await new Promise(resolve => setTimeout(resolve, 100));

			// Entry must still be present; the stale timer was cancelled.
			expect(client.cache.size).toBe(1);
		});
	});

	describe('scope (AbortSignal auto-cleanup)', () => {
		it('should auto-unsubscribe when the scope signal fires', async () => {
			const controller = new AbortController();
			const onResponse = mock();

			await GET('/users', { apiId: 'users', scope: controller.signal, onResponse });
			expect(subscriptions.has('users')).toBe(true);

			controller.abort();

			expect(subscriptions.has('users')).toBe(false);
		});

		it('should not receive further callbacks after scope fires', async () => {
			const controller = new AbortController();
			const onResponse = mock();

			await GET('/users', { apiId: 'users', scope: controller.signal, onResponse });
			controller.abort();
			const callsBefore = onResponse.mock.calls.length;

			await POST('/users', { body: {}, invalidates: ['users'] });

			expect(onResponse.mock.calls.length).toBe(callsBefore);
		});

		it('should only clean up the scoped subscriber; others on the same apiId remain active', async () => {
			const controller = new AbortController();
			const scoped = mock();
			const persistent = mock();

			await GET('/users', { apiId: 'users', scope: controller.signal, onResponse: scoped });
			await GET('/users', { apiId: 'users', onResponse: persistent });

			controller.abort();

			const persistentCallsBefore = persistent.mock.calls.length;
			await POST('/users', { body: {}, invalidates: ['users'] });

			expect(persistent.mock.calls.length).toBeGreaterThan(persistentCallsBefore);
			expect(subscriptions.has('users')).toBe(true);
		});

		it('should auto-unsubscribe a manual result.subscribe() call when scope is passed', async () => {
			const controller = new AbortController();
			const result = await GET('/users', { apiId: 'users' });
			const callback = mock();

			result.subscribe(callback, controller.signal);
			expect(subscriptions.has('users')).toBe(true);

			controller.abort();
			expect(subscriptions.has('users')).toBe(false);
		});
	});

	describe('result.options', () => {
		it('should not include lifecycle callbacks', async () => {
			const result = await GET('/users', {
				apiId: 'users',
				onResponse: mock(),
				onSuccess: mock(),
				onError: mock(),
				onMutate: mock(),
				onSettled: mock(),
			});

			expect(result.options.onResponse).toBeUndefined();
			expect(result.options.onSuccess).toBeUndefined();
			expect(result.options.onError).toBeUndefined();
			expect(result.options.onMutate).toBeUndefined();
			expect(result.options.onSettled).toBeUndefined();
		});

		it('should not include scope', async () => {
			const controller = new AbortController();
			const result = await GET('/users', { scope: controller.signal });

			expect(result.options.scope).toBeUndefined();
			controller.abort();
		});

		it('should still include non-private options', async () => {
			const result = await GET('/users', {
				apiId: 'my-api',
				invalidateAfter: 30000,
				searchParameters: { page: 1 },
			});

			expect(result.options.apiId).toBe('my-api');
			expect(result.options.invalidateAfter).toBe(30000);
			expect(result.options.searchParameters).toEqual({ page: 1 });
		});
	});

	describe('status: loading + isFetching in subscribers', () => {
		it('onFetching fires with status: loading on initial fetch', async () => {
			const fetching = mock();
			await GET('/users', { apiId: 'users', onFetching: fetching });

			expect(fetching).toHaveBeenCalled();
			const r = fetching.mock.calls[0][0];
			expect(r.status).toBe('loading');
			expect(r.isFetching).toBe(true);
		});

		it('onFetching fires with stale data and isFetching: true when invalidation triggers a refetch', async () => {
			const received = [];
			await GET('/users', {
				apiId: 'users',
				onFetching: r => received.push({ status: r.status, isFetching: r.isFetching }),
			});

			received.length = 0; // reset after initial loading notification

			await POST('/users', { body: {}, invalidates: ['users'] });
			await new Promise(resolve => setTimeout(resolve, 10));

			const fetchingCall = received.find(r => r.isFetching);
			expect(fetchingCall).toBeDefined();
			expect(fetchingCall.status).toBe('success'); // stale data still present
		});

		it('onSuccess fires reactively on successful responses', async () => {
			const onSuccess = mock();
			await GET('/users', { apiId: 'users', onSuccess });

			expect(onSuccess).toHaveBeenCalled();
			expect(onSuccess.mock.calls[0][0].status).toBe('success');

			const callsBefore = onSuccess.mock.calls.length;
			await POST('/users', { body: {}, invalidates: ['users'] });
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onSuccess.mock.calls.length).toBeGreaterThan(callsBefore);
		});

		it('onError fires reactively on error responses', async () => {
			global.fetch = mock()
				.mockResolvedValueOnce({
					status: 200,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ data: 'ok' }),
					text: () => Promise.resolve(''),
				})
				.mockResolvedValueOnce({
					status: 201,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({}),
					text: () => Promise.resolve(''),
				})
				.mockResolvedValueOnce({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'boom' }),
					text: () => Promise.resolve(''),
				});

			const onError = mock();
			await GET('/users', { apiId: 'users', onError });

			expect(onError).not.toHaveBeenCalled(); // first fetch succeeded

			// POST succeeds (201) which triggers invalidation, then the subscriber refetch returns 500
			await POST('/users', { body: {}, invalidates: ['users'] });
			await new Promise(resolve => setTimeout(resolve, 10));

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0][0].status).toBe('error');
		});

		it('onSuccess and onError do not receive context; use onSettled for rollback', async () => {
			global.fetch = mock(() =>
				Promise.resolve({
					status: 500,
					headers: new Map([['content-type', 'application/json']]),
					json: () => Promise.resolve({ error: 'boom' }),
					text: () => Promise.resolve(''),
				}),
			);

			const onError = mock();
			await POST('/users', {
				body: {},
				onMutate: () => ({ snapshot: 'prev' }),
				onError,
			});

			expect(onError).toHaveBeenCalled();
			expect(onError.mock.calls[0][1]).toBeUndefined(); // no context argument
		});

		it('onResponse, onSuccess, and onFetching can all be registered together', async () => {
			const onFetching = mock();
			const onSuccess = mock();
			const onResponse = mock();

			await GET('/users', { apiId: 'users', onFetching, onSuccess, onResponse });

			// loading notification fires first
			expect(onFetching).toHaveBeenCalledTimes(1);
			expect(onFetching.mock.calls[0][0].status).toBe('loading');

			// completion fires to both onResponse and onSuccess
			expect(onResponse).toHaveBeenCalled();
			expect(onResponse.mock.calls.at(-1)[0].status).toBe('success');
			expect(onSuccess).toHaveBeenCalled();
		});

		it('non-cached subscriptions auto-unsubscribe after the first notification', async () => {
			const onSuccess = mock();
			const result = await POST('/users', { body: { name: 'Alice' }, onSuccess });

			// Subscription was created, fired, and cleaned up in one shot
			expect(onSuccess).toHaveBeenCalledTimes(1);
			expect(subscriptions.has(result.apiId)).toBe(false);
		});

		it('non-cached subscription cleanup does not affect other subscribers on the same apiId', async () => {
			const getCallback = mock();
			await GET('/users', { apiId: 'users', onSuccess: getCallback });

			const postCallback = mock();
			await POST('/users', { apiId: 'users', body: {}, onSuccess: postCallback });

			// The POST subscription was cleaned up; the GET subscription remains
			expect(postCallback).toHaveBeenCalledTimes(1);
			expect(getCallback).toHaveBeenCalled();
			expect(subscriptions.has('users')).toBe(true); // GET subscriber still active
		});

		it('refetchInterval prevents auto-unsubscribe on non-cached requests', async () => {
			const client = createClient();
			const onSuccess = mock();
			const result = await client.GET('/items', {
				cache: false,
				apiId: 'items',
				refetchInterval: 5000,
				onSuccess,
			});

			expect(onSuccess).toHaveBeenCalled();
			expect(client.subscriptions.has('items')).toBe(true); // not cleaned up
			result.unsubscribe();
		});

		it('all four callbacks share a single subscriptionId', async () => {
			const result = await GET('/users', {
				apiId: 'users',
				onFetching: mock(),
				onResponse: mock(),
				onSuccess: mock(),
				onError: mock(),
			});

			expect(result.subscriptionId).toBeTruthy();
			expect(Object.keys(subscriptions.get('users'))).toHaveLength(1);
		});

		it('isFetching is true in refetchAllSubscriptions broadcast before the result lands', async () => {
			globalThis.window = new EventTarget();
			globalThis.document = Object.assign(new EventTarget(), { hidden: false });

			const client = createClient();
			client.configure({ refetchOnWindowFocus: true });

			const received = [];
			await client.GET('/users', { apiId: 'users', onFetching: r => received.push(r.isFetching) });
			received.length = 0; // reset after initial

			globalThis.window.dispatchEvent(new Event('focus'));
			await new Promise(resolve => setTimeout(resolve, 20));

			expect(received).toContain(true);

			client.configure({ refetchOnWindowFocus: false });
			delete globalThis.window;
			delete globalThis.document;
		});
	});

	describe('timeout', () => {
		// Rejects with the signal's reason; the same behavior real fetch uses.
		// Timeout aborts carry TimeoutError; resetRequest aborts carry AbortError.
		const makeHangingFetch = () =>
			mock(
				(url, options) =>
					new Promise((_, reject) => {
						options.signal?.addEventListener('abort', () => {
							reject(options.signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
						});
					}),
			);

		it('should abort the request when timeout elapses and expose TimeoutError', async () => {
			global.fetch = makeHangingFetch();

			const result = await GET('/users', { timeout: 50 });

			expect(result.status).toBe('error');
			expect(result.body?.name).toBe('TimeoutError');
		});

		it('should succeed when the response arrives before the timeout', async () => {
			const result = await GET('/users', { timeout: 5000 });

			expect(result.status).toBe('success');
		});

		it('should not retry after a timeout', async () => {
			global.fetch = makeHangingFetch();

			await GET('/users', { timeout: 30, retry: 3, retryDelay: 0 });

			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it('should apply the global configure timeout to every request', async () => {
			const client = createClient();
			client.configure({ timeout: 50 });
			global.fetch = makeHangingFetch();

			const result = await client.GET('/users');

			expect(result.status).toBe('error');
			client.configure({ timeout: undefined });
		});

		it('timeout: false on a call disables the global timeout for that call', async () => {
			const client = createClient();
			client.configure({ timeout: 30 });

			// fetch resolves after 80ms; would time out under the 30ms global, but timeout: false opts out
			global.fetch = mock(
				() =>
					new Promise(resolve =>
						setTimeout(
							() =>
								resolve({
									status: 200,
									headers: new Map([['content-type', 'application/json']]),
									json: () => Promise.resolve({ data: 'late' }),
									text: () => Promise.resolve(''),
								}),
							80,
						),
					),
			);

			const result = await client.GET('/users', { timeout: false });

			expect(result.status).toBe('success');
			client.configure({ timeout: undefined });
		});

		it('global timeout fires when no per-call override is set', async () => {
			const client = createClient();
			client.configure({ timeout: 30 });
			global.fetch = makeHangingFetch();

			const result = await client.GET('/users');

			expect(result.status).toBe('error');
			expect(result.body?.name).toBe('TimeoutError');
			client.configure({ timeout: undefined });
		});
	});
});
