import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { adminApi } from '../src/routes/api/admin.ts';
import { validateRequired } from '../scripts/deploy-vars.mjs';

const routes = [
  ['GET', '/stats'], ['GET', '/rooms'], ['GET', '/rooms/123456'],
  ['POST', '/rooms/123456/config'],
];
function fixture(configuredToken) {
  const calls = [];
  const meta = { roomKey: '123456', expiresAt: Date.now() + 3600000, maxFileSizeMb: 100, onlineCount: 1, onlineUsers: [{ userId: 'synthetic-user' }] };
  const entry = { doId: 'synthetic-do-id', expiresAt: meta.expiresAt };
  const env = {
    ROOM_INDEX: { idFromName: id => { calls.push('index id'); return id; }, get: () => ({ fetch: async url => {
      calls.push(url);
      return Response.json(url.endsWith('/list') ? { '123456': entry } : entry);
    } }) },
    ROOMS: { idFromString: id => { calls.push('room id'); return id; }, get: () => ({ fetch: async (url, init) => {
      calls.push(url);
      if (url.endsWith('/config')) { Object.assign(meta, JSON.parse(init.body)); return Response.json({ ok: true }); }
      return Response.json(meta);
    } }) },
  };
  if (configuredToken !== undefined) env.ADMIN_AUTH_TOKEN = configuredToken;
  const app = new Hono().route('/api/v1', adminApi);
  return { calls, meta, request(method, path, token) {
    const headers = new Headers();
    if (token !== undefined) headers.set('X-Admin-Token', token);
    if (method === 'POST') headers.set('Content-Type', 'application/json');
    return app.request('http://local.invalid/api/v1/admin' + path, {
      method, headers, ...(method === 'POST' ? { body: JSON.stringify({ maxFileSizeMb: 999 }) } : {}),
    }, env);
  } };
}
for (const configured of [undefined, '', '   ', '\t', null, 123]) {
  test(`invalid admin configuration ${JSON.stringify(configured)} fails closed on every route`, async () => {
    for (const token of [undefined, '', '   ', 'wrong']) {
      const f = fixture(configured);
      for (const [method, path] of routes) {
        const res = await f.request(method, path, token);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: 'Service unavailable' });
      }
      assert.deepEqual(f.calls, [], 'must reject before accessing either namespace');
      assert.equal(f.meta.maxFileSizeMb, 100);
    }
  });
}
for (const token of [undefined, '', 'wrong', 'Synthetic-secret']) {
  test(`valid configuration rejects header ${JSON.stringify(token)} on every route`, async () => {
    const f = fixture('synthetic-secret');
    for (const [method, path] of routes) {
      const res = await f.request(method, path, token);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'Unauthorized' });
    }
    assert.deepEqual(f.calls, []);
    assert.equal(f.meta.maxFileSizeMb, 100);
  });
}
for (const token of ['synthetic-secret', 'synthetic secret']) {
  test(`exact valid token ${JSON.stringify(token)} preserves all admin operations`, async () => {
    const f = fixture(token);
    for (const [method, path] of routes) {
      const res = await f.request(method, path, token);
      assert.equal(res.status, 200);
      const data = await res.json();
      if (path === '/stats') assert.equal(data.totalRooms, 1);
      if (path === '/rooms') assert.equal(data.rooms[0].key, '123456');
      if (path === '/rooms/123456') assert.equal(data.onlineUsers[0].userId, 'synthetic-user');
      if (method === 'POST') assert.deepEqual(data, { ok: true });
    }
    assert.equal(f.meta.maxFileSizeMb, 999);
  });
}
test('configured token is never silently trimmed', async () => {
  const f = fixture(' synthetic-secret ');
  for (const [method, path] of routes) assert.equal((await f.request(method, path, 'synthetic-secret')).status, 401);
  assert.deepEqual(f.calls, []);
});
test('deployment rejects absent, inherited, non-string, empty, and whitespace-only required values', () => {
  for (const selected of [{}, Object.create({ ADMIN_AUTH_TOKEN: 'inherited' }), ...[undefined, null, 123, '', ' ', '\t\n'].map(value => ({ ADMIN_AUTH_TOKEN: value }))]) {
    assert.throws(() => validateRequired(selected, ['ADMIN_AUTH_TOKEN'], 'deploy vars'), /Missing or empty deploy vars: ADMIN_AUTH_TOKEN/);
  }
});
test('deployment preserves nonblank values verbatim and checks all required names', () => {
  const selected = { ADMIN_AUTH_TOKEN: ' synthetic-secret ', R2_ACCOUNT_ID: 'synthetic-id' };
  const before = { ...selected };
  validateRequired(selected, Object.keys(selected), 'deploy vars');
  assert.deepEqual(selected, before);
  assert.throws(() => validateRequired(selected, ['ADMIN_AUTH_TOKEN', 'R2_SECRET_ACCESS_KEY'], 'deploy vars'), /R2_SECRET_ACCESS_KEY/);
});
