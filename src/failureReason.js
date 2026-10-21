/**
 * Why a request failed, in words for a person: the server's `{ error }` or text, the network error's message, or the
 * status. A request resolves rather than throws, so a failure arrives looking like data; this reads it.
 * @example if (result.status === 'error') notify(`Save failed: ${failureReason(result)}`);
 * @param {object} result - A request's result
 * @returns {string} The reason, or '' for a result that didn't fail
 */
export const failureReason = result => {
	if (!result || result.status !== 'error') return '';

	const { body, response } = result;

	if (body instanceof Error) return body.message || 'The server could not be reached';
	if (typeof body === 'string' && body.trim()) return body.trim();
	if (typeof body?.error === 'string' && body.error) return body.error;

	return response?.status ? `HTTP ${response.status}` : 'The server could not be reached';
};
