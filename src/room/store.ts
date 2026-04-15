import type { RoomIndexEntry } from "@/room/types";

export function getRoomIndexStub(env: Env): DurableObjectStub {
  return env.ROOM_INDEX.get(env.ROOM_INDEX.idFromName("global"));
}

export async function lookupRoom(env: Env, key: string): Promise<RoomIndexEntry | null> {
  const stub = getRoomIndexStub(env);
  const res = await stub.fetch(`http://internal/lookup/${key}`);
  if (res.status === 404) return null;
  return res.json<RoomIndexEntry>();
}

export function getRoomStub(env: Env, doId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromString(doId));
}
