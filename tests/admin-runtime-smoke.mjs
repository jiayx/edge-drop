import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { Miniflare } = await import(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));
const routes = [['GET', '/stats'], ['GET', '/rooms'], ['GET', '/rooms/123456'], ['POST', '/rooms/123456/config']];
// Invalid configurations deliberately omit storage bindings: rejection must happen first.
for (const configuredToken of [undefined, '', '   ']) {
  const mf = new Miniflare({
    modules: true, scriptPath: fileURLToPath(new URL('../dist/client/drop/index.js', import.meta.url)),
    compatibilityDate: '2026-04-16', compatibilityFlags: ['nodejs_compat'],
    bindings: configuredToken === undefined ? {} : { ADMIN_AUTH_TOKEN: configuredToken },
  });
  try {
    for (const token of [undefined, '', 'wrong']) {
      for (const [method, path] of routes) {
        const headers = token === undefined ? {} : { 'X-Admin-Token': token };
        const res = await mf.dispatchFetch('http://localhost/api/v1/admin' + path, { method, headers });
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: 'Service unavailable' });
      }
    }
  } finally { await mf.dispose(); }
}
const mf = new Miniflare({
  modules: true, scriptPath: fileURLToPath(new URL('../dist/client/drop/index.js', import.meta.url)),
  compatibilityDate: '2026-04-16', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { ROOMS: { className: 'RoomObject', useSQLite: true }, ROOM_INDEX: { className: 'RoomIndexObject', useSQLite: true } },
  ratelimits: { ROOM_JOIN_RATE_LIMIT: { simple: { limit: 10, period: 60 } } },
  bindings: { ADMIN_AUTH_TOKEN: 'synthetic-secret', MAX_FILE_SIZE_MB: '100', ROOM_TTL_HOURS: '24' },
});
try {
  const created = await mf.dispatchFetch('http://localhost/api/v1/rooms', { method: 'POST', body: '{}', headers: { 'CF-Connecting-IP': '192.0.2.10' } });
  assert.equal(created.status, 200);
  const { roomKey } = await created.json();
  for (const token of [undefined, '', 'wrong', 'synthetic-secret']) {
    for (const [method, suffix] of routes) {
      const path = suffix.replace('123456', roomKey);
      const headers = { 'Content-Type': 'application/json', ...(token === undefined ? {} : { 'X-Admin-Token': token }) };
      const res = await mf.dispatchFetch('http://localhost/api/v1/admin' + path, { method, headers, credentials: 'omit', ...(method === 'POST' ? { body: JSON.stringify({ maxFileSizeMb: 999 }) } : {}) });
      assert.equal(res.status, token === 'synthetic-secret' ? 200 : 401);
    }
  }
  const detail = await mf.dispatchFetch('http://localhost/api/v1/admin/rooms/' + roomKey, { headers: { 'X-Admin-Token': 'synthetic-secret' } });
  assert.equal((await detail.json()).maxFileSizeMb, 999);
  console.log('PASS: built Worker admin auth: 36 misconfigured requests fail closed without storage; 16 configured-token route checks; real DO authorized config persistence');
} finally { await mf.dispose(); }
