import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resetRequest, resource } from './request';

const respond = (status, body) =>
	Promise.resolve({
		status,
		ok: status < 400,
		headers: new Map([['content-type', 'application/json']]),
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	});

describe('resource', () => {
	let calls;

	beforeEach(() => {
		resetRequest();
		calls = [];
		global.fetch = mock((url, init) => {
			calls.push(`${init?.method ?? 'GET'} ${url}`);

			return respond(200, { id: '1' });
		});
	});

	afterEach(() => mock.restore());

	it('makes the five requests at the collection and its records', async () => {
		const games = resource('/api/games');

		await games.list();
		await games.read('1');
		await games.create({ body: { name: 'Chess' } });
		await games.update('1', { body: { name: 'Go' } });
		await games.delete('1');

		expect(calls).toEqual([
			'GET /api/games',
			'GET /api/games/1',
			'POST /api/games',
			'PATCH /api/games/1',
			'DELETE /api/games/1',
		]);
	});

	it('a write refetches the list and the record subscribed to', async () => {
		const games = resource('/api/games');
		const listed = mock();
		const read = mock();

		await games.list({ onSuccess: listed });
		await games.read('1', { onSuccess: read });
		await games.update('1', { body: { name: 'Go' } });
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(listed).toHaveBeenCalledTimes(2);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("a call's own options win over the defaults", async () => {
		const pains = resource('/pains', { invalidateAfter: false });
		const remedies = mock();

		await resource('/remedies').list({ onSuccess: remedies });
		await pains.delete('1', { invalidates: ['pains', 'remedies'] });
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(remedies).toHaveBeenCalledTimes(2);
	});
});
