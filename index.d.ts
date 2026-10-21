export interface RequestContext {
	url: string;
	method: string;
	options: RequestOptions;
}

export interface GlobalConfig {
	invalidateAfter?: number | false;
	gcTime?: number;
	retry?: number;
	retryDelay?: number | ((attempt: number) => number);
	/** Default request timeout in ms. Per-call `timeout` (including `false` to opt out) takes precedence. */
	timeout?: number;
	staleWhileRevalidate?: boolean;
	fetchOptions?: RequestInit;
	refetchOnWindowFocus?: boolean;
	refetchOnWindowFocusMinInterval?: number;
	refetchOnReconnect?: boolean;
	refetchInterval?: number | false;
	/** Called once before the first fetch attempt. Return a `RequestInit` (or a Promise that resolves to one) to merge additional fetch options; headers are deep-merged, other keys override. Use for dynamic auth headers, correlation IDs, logging, or tracing. */
	beforeRequest?: (context: RequestContext) => RequestInit | void | Promise<RequestInit | void>;
	/** Called once when a request concludes (success, HTTP error, network error, or abort). Use for logging, metrics, or global error handling. */
	afterRequest?: (context: { result: RequestResult }) => void;
}

export interface MutateInputs {
	url: string;
	method: string;
	body: unknown;
	urlParameters?: Record<string, string | number | null | undefined>;
	searchParameters?: Record<string, string | number | boolean | null | undefined>;
}

export interface RequestOptions<T = unknown, Context = unknown> {
	apiId?: string | string[] | ((options: RequestOptions<T, Context>) => string | string[]);
	cacheId?: string | ((options: RequestOptions<T, Context>) => string);
	invalidates?: (string | string[])[];
	invalidateAfter?: number | false;
	cache?: boolean;
	deduplicate?: boolean;
	staleWhileRevalidate?: boolean;
	enabled?: boolean;
	refetchInterval?: number | false;
	/** Transform the response body before delivering to callbacks and the return value. The cache always stores the raw body; select is applied per-call at delivery time. */
	select?: (body: unknown) => T;
	/** Called when a fetch starts; fires with `isFetching: true`. Body is stale data (`T`) if a prior fetch succeeded, `null` on first load. Creates a subscription. */
	onFetching?: (result: Omit<RequestResult<T>, 'body'> & { body: T | null }) => void;
	/** Called when any fetch completes (success or error). Creates a subscription. */
	onResponse?: (result: RequestResult<T>) => void;
	/** Called when a fetch completes with a 2xx response. Creates a subscription. */
	onSuccess?: (result: RequestResult<T>) => void;
	/** Called when a fetch completes with an error or non-2xx response. `body` is always the raw error response; `select` is never applied to error bodies. Creates a subscription. */
	onError?: (result: Omit<RequestResult<T>, 'body'> & { body: unknown }) => void;
	onMutate?: (inputs: MutateInputs) => Context | Promise<Context>;
	/** Called after every completed request (success or error). Receives `(result, context)` where `context` is the return value of `onMutate`. Does not create a subscription. */
	onSettled?: (result: RequestResult<T>, context: Context) => void;
	urlParameters?: Record<string, string | number | null | undefined>;
	searchParameters?: Record<string, string | number | boolean | null | undefined>;
	body?: unknown;
	fetchOptions?: RequestInit;
	method?: string;
	retry?: number;
	retryDelay?: number | ((attempt: number) => number);
	/** Abort after this many ms if no response has arrived. `false` disables any global timeout set via `configure` for this call. Applies to the whole call including retries. */
	timeout?: number | false;
	/** How to parse the response body. `'auto'` uses Content-Type: json for application/json or +json types, text for text/*, blob for everything else. Explicit values override content-type detection. */
	responseType?: 'auto' | 'json' | 'text' | 'blob' | 'arrayBuffer';
	/** When provided, subscriptions created by this call auto-unsubscribe when the signal fires. Pass the signal of an AbortController tied to a component's lifetime for automatic cleanup. */
	scope?: AbortSignal;
}

export interface Subscription<T = unknown> {
	subscriptionId: string;
	unsubscribe: () => void;
	refetch: (overrides?: Partial<RequestOptions<T>>) => Promise<RequestResult<T> | void>;
}

/** `result.options`: the request options with lifecycle callbacks and `scope` stripped. */
export type PublicRequestOptions<T = unknown, Context = unknown> = Omit<
	RequestOptions<T, Context>,
	'onResponse' | 'onSuccess' | 'onError' | 'onFetching' | 'onMutate' | 'onSettled' | 'scope'
>;

export interface RequestResult<T = unknown> {
	originalUrl: string;
	url: string;
	options: PublicRequestOptions<T>;
	apiId: string | string[];
	cacheId: string;
	subscriptionId: string | null;
	unsubscribe: () => void;
	response: Response | null;
	/** `'idle'` when disabled, `'loading'` during initial fetch, `'success'` on 2xx, `'error'` on non-2xx or network failure. */
	status: 'idle' | 'loading' | 'success' | 'error';
	/** `true` when a fetch is in flight. Subscribers receive `isFetching: true` when a background refetch starts and `false` when it completes. */
	isFetching: boolean;
	contentType: string | null;
	body: T;
	invalidateCache: () => void;
	refetch: (overrides?: Partial<RequestOptions<T>>) => Promise<RequestResult<T> | void>;
	subscribe: (callback: (result: RequestResult<T>) => void, scope?: AbortSignal) => Subscription<T>;
}

export interface PaginateOptions<T = unknown> {
	/** Called with the most recently loaded page's body and the full pages array. Return `true` if more pages exist. */
	getHasNextPage?: (lastPage: T, allPages: T[]) => boolean;
}

export interface PageState {
	page: number;
	status: 'loading' | 'success' | 'error';
	error: unknown | null;
}

export interface PaginateHandle<T = unknown> {
	loadPage: (page: number) => Promise<RequestResult<T>>;
	loadNext: () => Promise<RequestResult<T>>;
	subscribe: (callback: (pages: T[], states: PageState[]) => void) => { unsubscribe: () => void };
	destroy: () => void;
	/** `true` / `false` as returned by `getHasNextPage`. `undefined` when not provided or before any page loads. */
	hasNextPage: boolean | undefined;
	/** `true` while any page is in-flight. */
	readonly isLoading: boolean;
}

export interface ResourceOptions<T = unknown, Context = unknown> extends RequestOptions<T, Context> {
	/** The reads' subscription group; a record's is `[apiId, id]`. Defaults to the path's last segment. */
	apiId?: string;
	/** What every write invalidates. Defaults to `[apiId]`. */
	invalidates?: (string | string[])[];
}

export interface Resource {
	list: <T = unknown, Context = unknown>(options?: RequestOptions<T, Context>) => Promise<RequestResult<T>>;
	read: <T = unknown, Context = unknown>(
		id: string | number,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	create: <T = unknown, Context = unknown>(options?: RequestOptions<T, Context>) => Promise<RequestResult<T>>;
	update: <T = unknown, Context = unknown>(
		id: string | number,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	delete: <T = unknown, Context = unknown>(
		id: string | number,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
}

export interface Client {
	cache: ReadonlyMap<string, unknown>;
	subscriptions: ReadonlyMap<string, Record<string, unknown>>;
	request: <T = unknown, Context = unknown>(
		url: string,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	resetRequest: () => void;
	/** Clears all cached data and TTL timers. Subscriptions and event listeners remain intact. Use for a soft data reset that preserves the reactive wiring. */
	clearCache: () => void;
	setCache: <T = unknown>(cacheId: string, updater: T | ((body: T) => T)) => void;
	configure: (overrides: Partial<GlobalConfig>) => void;
	GET: <T = unknown, Context = unknown>(url: string, options?: RequestOptions<T, Context>) => Promise<RequestResult<T>>;
	POST: <T = unknown, Context = unknown>(
		url: string,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	PUT: <T = unknown, Context = unknown>(url: string, options?: RequestOptions<T, Context>) => Promise<RequestResult<T>>;
	PATCH: <T = unknown, Context = unknown>(
		url: string,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	DELETE: <T = unknown, Context = unknown>(
		url: string,
		options?: RequestOptions<T, Context>,
	) => Promise<RequestResult<T>>;
	/** The five requests for a REST collection at `path`: list, read, create, update (PATCH), delete. */
	resource: (path: string, options?: ResourceOptions) => Resource;
}

export declare function createClient(): Client;

export declare function hydrateUrl(
	url: string,
	parameters?: Record<string, string | number | null | undefined>,
): string;

export declare function paginate<T = unknown>(
	pageGetter: (page: number) => Promise<RequestResult<T>>,
	options?: PaginateOptions<T>,
): PaginateHandle<T>;

export declare const cache: ReadonlyMap<string, unknown>;
export declare const subscriptions: ReadonlyMap<string, Record<string, unknown>>;
export declare function request<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
export declare function resetRequest(): void;
/** Clears all cached data and TTL timers. Subscriptions and event listeners remain intact. Use for a soft data reset that preserves the reactive wiring. */
export declare function clearCache(): void;
export declare function setCache<T = unknown>(cacheId: string, updater: T | ((body: T) => T)): void;
export declare function configure(overrides: Partial<GlobalConfig>): void;
export declare function GET<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
export declare function POST<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
export declare function PUT<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
export declare function PATCH<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
export declare function DELETE<T = unknown, Context = unknown>(
	url: string,
	options?: RequestOptions<T, Context>,
): Promise<RequestResult<T>>;
/** The five requests for a REST collection at `path`: list, read, create, update (PATCH), delete. */
export declare function resource(path: string, options?: ResourceOptions): Resource;
/** Why a request failed, in words for a person; '' for a result that didn't fail. */
export declare function failureReason(result: RequestResult | undefined): string;
