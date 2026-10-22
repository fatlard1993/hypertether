import { describe, it, expect } from 'bun:test';
import { failureReason } from './failureReason';

describe('failureReason', () => {
	it("gives the server's reason, the network's, or the status", () => {
		expect(failureReason({ status: 'error', body: { error: 'name is required' }, response: { status: 400 } })).toBe(
			'name is required',
		);
		expect(failureReason({ status: 'error', body: { message: 'Room is full' }, response: { status: 409 } })).toBe(
			'Room is full',
		);
		expect(failureReason({ status: 'error', body: { error: 'Bad id', message: 'Room is full' } })).toBe('Bad id');
		expect(failureReason({ status: 'error', body: { message: '' }, response: { status: 500 } })).toBe('HTTP 500');
		expect(failureReason({ status: 'error', body: 'Not allowed\n', response: { status: 403 } })).toBe('Not allowed');
		expect(failureReason({ status: 'error', body: new TypeError('Failed to fetch') })).toBe('Failed to fetch');
		expect(failureReason({ status: 'error', body: {}, response: { status: 502 } })).toBe('HTTP 502');
		expect(failureReason({ status: 'error', body: null })).toBe('The server could not be reached');
	});

	it('is empty for a result that did not fail', () => {
		expect(failureReason({ status: 'success', body: { error: 'a field named error' } })).toBe('');
		expect(failureReason(undefined)).toBe('');
	});
});
