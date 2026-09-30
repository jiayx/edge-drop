import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
// Reuse Wrangler's installed Workers emulator without adding a dependency.
const { Miniflare } = await import(require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }));
import assert from 'node:assert/strict';
const mf = new Miniflare({
  modules: true, scriptPath: fileURLToPath(new URL('../dist/client/drop/index.js', import.meta.url)),
  compatibilityDate: '2026-04-16', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { ROOMS: { className: 'RoomObject', useSQLite: true }, ROOM_INDEX: { className: 'RoomIndexObject', useSQLite: true } },
  ratelimits: { ROOM_JOIN_RATE_LIMIT: { simple: { limit: 10, period: 60 } } },
  bindings: { MAX_FILE_SIZE_MB: '100', ROOM_TTL_HOURS: '24', BLOCKED_MIME_TYPES: 'application/x-executable', ADMIN_AUTH_TOKEN: 'local-test-only' },
});
try {
 const req=(path, init={}, ip='192.0.2.1')=>mf.dispatchFetch('http://localhost'+path,{...init,headers:{'CF-Connecting-IP':ip,...init.headers}});
 const created=await req('/api/v1/rooms',{method:'POST'}); assert.equal(created.status,200);
 const {roomKey}=await created.json(); assert.match(roomKey,/^\d{6}$/);
 assert.equal((await req('/room/'+roomKey)).status,200);
 assert.equal((await req(`/api/v1/rooms/${roomKey}/join`,{method:'POST',body:JSON.stringify({userId:'test',displayName:'Test'})})).status,200);
 for(let i=0;i<25;i++) assert.equal((await req(`/api/v1/rooms/${roomKey}/messages?beforeSeq=999`)).status,200);
 const ws=await req(`/api/v1/ws/${roomKey}?userId=test&displayName=Test`,{headers:{Upgrade:'websocket'}}); assert.equal(ws.status,101); ws.webSocket.accept(); ws.webSocket.close(1000);
 const parallel=await Promise.all(Array.from({length:30},(_,i)=>req('/api/v1/rooms/'+String(i).padStart(6,'0'),{},'192.0.2.2')));
 assert.equal(parallel.filter(x=>x.status===429).length,20);
 assert.equal((await req(`/api/v1/ws/${roomKey}?userId=test`,{headers:{Upgrade:'websocket'}},'192.0.2.2')).status,429);
 assert.equal((await req('/api/v1/rooms',{method:'POST'},'192.0.2.2')).status,429);
 assert.equal((await req('/api/v1/admin/rooms')).status,401);
 console.log('PASS: real Durable Objects create/page/join/25 history requests/101 WebSocket/concurrent 10-of-30 gate/blocked WS/blocked creation/admin auth');
}finally{await mf.dispose();}
