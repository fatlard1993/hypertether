/**
 * Hydrates a URL string by replacing colon-prefixed parameters with encoded values
 * @param {string} url - URL with colon-prefixed variables (e.g., "/users/:id")
 * @param {object} [parameters] - Key-value pairs matching URL variables
 * @returns {string} URL with parameters replaced and URI-encoded
 * @example
 * hydrateUrl("/users/:id", { id: "123" }) // "/users/123"
 */
export const hydrateUrl = (url, parameters = {}) => {
	let hydratedUrl = url;

	Object.entries(parameters)
		.filter(([, value]) => value != null && String(value).length > 0)
		.map(([key, value]) => [key, String(value)])
		.forEach(([key, value]) => {
			hydratedUrl = hydratedUrl.replaceAll(`:${key}`, encodeURIComponent(value));
		});

	const unresolved = hydratedUrl.match(/:[a-zA-Z_][a-zA-Z0-9_]*/g);
	if (unresolved) throw new Error(`hydrateUrl: unresolved URL parameters: ${unresolved.join(', ')}`);

	return hydratedUrl;
};
