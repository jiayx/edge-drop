import type { RoomIndexEntry } from "@/room/types";
import { isExpired } from "@/lib/expiry";
import { listRoomObjects, deleteObjects } from "@/lib/r2";

interface CleanupStats {
  scanned: number;
  cleaned: number;
  filesDeleted: number;
  errors: number;
}

export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const stats: CleanupStats = { scanned: 0, cleaned: 0, filesDeleted: 0, errors: 0 };

  try {
    const indexStub = env.ROOM_INDEX.get(env.ROOM_INDEX.idFromName("global"));
    const res = await indexStub.fetch("http://internal/list");
    const registry = await res.json<Record<string, RoomIndexEntry>>();

    const expiredKeys = Object.entries(registry)
      .filter(([, entry]) => isExpired(entry.expiresAt))
      .map(([key]) => key);

    stats.scanned = Object.keys(registry).length;

    const CONCURRENCY = 10;
    for (let i = 0; i < expiredKeys.length; i += CONCURRENCY) {
      const batch = expiredKeys.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map((key) => cleanupRoom(key, registry[key]!, env, stats))
      );
    }
  } catch (err) {
    console.error("Cleanup cron fatal error:", err);
    stats.errors++;
  }

  console.log(`[edge-drop] Cleanup complete: ${JSON.stringify(stats)}`);
}

async function cleanupRoom(
  roomKey: string,
  entry: RoomIndexEntry,
  env: Env,
  stats: CleanupStats
): Promise<void> {
  try {
    const roomStub = env.ROOMS.get(env.ROOMS.idFromString(entry.doId));

    // Mark DO as cleaning (409 means already in progress — skip)
    const expireRes = await roomStub.fetch("http://internal/expire", { method: "POST" });
    if (expireRes.status === 409) return;

    // Delete all R2 objects under this room's prefix
    const prefix = `rooms/${roomKey}/`;
    const keys = await listRoomObjects(env, prefix);
    if (keys.length > 0) {
      await deleteObjects(env, keys);
      stats.filesDeleted += keys.length;
    }

    // Purge DO storage entirely
    await roomStub.fetch("http://internal/purge", { method: "POST" });

    // Remove from index
    const indexStub = env.ROOM_INDEX.get(env.ROOM_INDEX.idFromName("global"));
    await indexStub.fetch(`http://internal/deregister/${roomKey}`, { method: "DELETE" });

    stats.cleaned++;
  } catch (err) {
    console.error(`Failed to clean room ${roomKey}:`, err);
    stats.errors++;
  }
}
