import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { RoomIndexObject } from '../src/room/durable/RoomIndexObject.ts';
import { roomApi } from '../src/routes/api/rooms.ts';
import { fileApi } from '../src/routes/api/files.ts';
import { websocketApi } from '../src/routes/api/websocket.ts';
import { pageRoutes } from '../src/routes/pages.tsx';
import { isValidRoomKey, generateRoomKey } from '../src/lib/roomKey.ts';

class Storage {
  values = new Map();
  alarm = null;
  pending = Promise.resolve();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(time) { this.alarm = time; }
  async transaction(fn) {
    const result = this.pending.then(() => fn(this));
    this.pending = result.catch(() => {});
    return result;
  }
}
function probe(object, key) {
  return object.fetch(new Request(`http://internal/probe/${key}`, { method: 'POST' }));
}
function fixture() {
  const objects = new Map();
  const calls = [];
  let live = false;
  const env = {
    ROOM_INDEX: {
      idFromName: (name) => name,
      get: (name) => {
        if (name === 'global') return { fetch: async (url) => {
          calls.push(url);
          return live ? Response.json({ doId: 'room', expiresAt: Date.now() + 3600000 }) : new Response(null, { status: 404 });
        } };
        if (!objects.has(name)) objects.set(name, new RoomIndexObject({ storage: new Storage() }));
        return { fetch: (url, init) => objects.get(name).fetch(new Request(url, init)) };
      },
    },
    ROOMS: { idFromString: (id) => id, get: () => ({ fetch: async (url) => {
      calls.push(url);
      if (url.includes('/messages')) return Response.json({ messages: [], hasMore: false, nextSeq: 0 });
      if (url.includes('/ws')) return new Response('forwarded websocket');
      if (url.includes('/extend')) return Response.json({ ok: true, expiresAt: Date.now() + 3600000 });
      return Response.json({ maxFileSizeMb: 100, onlineCount: 0, onlineUsers: [] });
    } }) },
    ROOM_JOIN_RATE_LIMIT: { limit: async () => ({ success: false }) },
    MAX_FILE_SIZE_MB: '100', ROOM_TTL_HOURS: '24', BLOCKED_MIME_TYPES: 'application/x-executable',
  };
  const app = new Hono();
  app.route('/', pageRoutes).route('/api/v1', roomApi).route('/api/v1', fileApi).route('/api/v1', websocketApi);
  const request = (url, init = {}, ip = '192.0.2.1') => app.request(url, {
    ...init, headers: { 'CF-Connecting-IP': ip, ...init.headers },
  }, env);
  return { request, calls, objects, env, setLive: () => { live = true; } };
}

test('ten distinct keys, repeated admission, atomic parallel limit, and restart persistence', async () => {
  const storage = new Storage();
  const object = new RoomIndexObject({ storage });
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => probe(object, String(i).padStart(6, '0'))));
  assert.equal(results.filter((res) => res.status === 204).length, 10);
  assert.equal(results.filter((res) => res.status === 429).length, 20);
  assert.equal((await probe(new RoomIndexObject({ storage }), '000030')).status, 429);
  assert.equal((await probe(object, '000000')).status, 204);
  assert.equal(storage.values.get('probes').length, 10);
  assert.equal((await probe(object, 'invalid')).status, 400);
});

test('rolling expiry, Retry-After, non-sliding repeated access, and alarm cleanup', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 100000 });
  const storage = new Storage();
  const object = new RoomIndexObject({ storage });
  await probe(object, '000000');
  t.mock.timers.tick(1000);
  for (let i = 1; i < 10; i++) await probe(object, String(i).padStart(6, '0'));
  const blocked = await probe(object, '999999');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '59');
  await probe(object, '000000');
  assert.equal(storage.values.get('probes')[0].expiresAt, 160000);
  t.mock.timers.tick(59000);
  assert.equal((await probe(object, '999999')).status, 204);
  assert.equal(storage.values.get('probes').length, 10);
  await object.alarm();
  assert.equal(storage.alarm, 161000);
  t.mock.timers.tick(60000);
  await object.alarm();
  assert.equal(storage.values.has('probes'), false);
});

const paths = (key) => [
  [`/room/${key}`],
  [`/api/v1/rooms/${key}`],
  [`/api/v1/rooms/${key}/join`, { method: 'POST', body: '{}' }],
  [`/api/v1/rooms/${key}/messages?beforeSeq=999`],
  [`/api/v1/rooms/${key}/extend`, { method: 'POST' }],
  [`/api/v1/rooms/${key}/files`, { method: 'POST' }],
  [`/api/v1/rooms/${key}/files/anything`],
  [`/api/v1/rooms/${key}/files/anything`, { method: 'DELETE' }],
  [`/api/v1/ws/${key}`, { headers: { Upgrade: 'websocket' } }],
];

test('all public discovery routes share a budget before lookup, including live rooms', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    const options = paths(String(i).padStart(6, '0'))[i % 9];
    assert.notEqual((await f.request(...options)).status, 429);
  }
  f.setLive();
  f.calls.length = 0;
  for (const options of paths('999999')) {
    const res = await f.request(...options);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('Retry-After')) > 0);
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await f.request('/api/v1/rooms/999999', {}, '192.0.2.2')).status, 200);
});

test('legitimate join, many history requests and reconnects reuse one admission', async () => {
  const f = fixture(); f.setLive();
  assert.equal((await f.request('/api/v1/rooms/123456')).status, 200);
  assert.equal((await f.request('/room/123456')).status, 200);
  for (let i = 0; i < 25; i++) {
    assert.equal((await f.request('/api/v1/rooms/123456/join', { method: 'POST', body: '{}' })).status, 200);
    assert.equal((await f.request('/api/v1/rooms/123456/messages?beforeSeq=999')).status, 200);
    assert.equal((await f.request('/api/v1/ws/123456', { headers: { Upgrade: 'websocket' } })).status, 200);
    // Invalid object key still reaches ordinary file validation, not a rate limit.
    assert.equal((await f.request('/api/v1/rooms/123456/files/anything', { headers: { Range: 'bytes=0-10' } })).status, 403);
  }
  assert.equal(f.objects.size, 1);
});

test('invalid formats and non-upgrades do not allocate probe objects', async () => {
  const f = fixture();
  for (const options of paths('invalid')) assert.ok([302, 400].includes((await f.request(...options)).status));
  assert.equal((await f.request('/api/v1/ws/123456')).status, 426);
  assert.equal(f.objects.size, 0);
  assert.equal(f.calls.length, 0);
});

test('forwarded/client identity headers cannot reset a budget; absent IP shares fallback', async () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) await f.request(`/api/v1/rooms/${String(i).padStart(6, '0')}`);
  assert.equal((await f.request('/api/v1/rooms/999999', { headers: { 'X-Forwarded-For': '192.0.2.99', 'X-Real-IP': '192.0.2.99' } })).status, 429);
  for (let i = 0; i < 10; i++) await f.request(`/api/v1/rooms/${String(i).padStart(6, '0')}`, {}, '');
  assert.equal((await f.request('/api/v1/rooms/999999', {}, '')).status, 429);
});

test('creation uses a separate native limiter and leaves codes unchanged', async () => {
  const f = fixture(); let key;
  f.env.ROOM_JOIN_RATE_LIMIT.limit = async (args) => { key = args.key; return { success: false }; };
  assert.equal((await f.request('/api/v1/rooms', { method: 'POST' })).status, 429);
  assert.equal(key, 'create:192.0.2.1');
  assert.equal(f.objects.size, 0);
  for (let i = 0; i < 100; i++) assert.ok(isValidRoomKey(generateRoomKey()));
  assert.ok(isValidRoomKey('000001'));
});


test('exhausted discovery budget rejects creation before allocating a room', async (t) => {
  const f = fixture();
  f.env.ROOM_JOIN_RATE_LIMIT.limit = async () => ({ success: true });
  t.mock.method(crypto, 'getRandomValues', (bytes) => bytes.fill(9));
  for (let i = 0; i < 10; i++) await f.request(`/api/v1/rooms/${String(i).padStart(6, '0')}`);
  // The fixture intentionally has no newUniqueId: reaching allocation would fail.
  assert.equal((await f.request('/api/v1/rooms', { method: 'POST' })).status, 429);
});
