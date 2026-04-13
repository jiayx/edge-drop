const ROOM_PATH_RE = /^\/room\/(\d{6})$/;

export type AppRoute =
  | { name: "lobby" }
  | { name: "room"; roomKey: string };

export function parseAppRoute(pathname: string): AppRoute | null {
  if (pathname === "/") {
    return { name: "lobby" };
  }

  const roomMatch = pathname.match(ROOM_PATH_RE);
  if (roomMatch && roomMatch[1]) {
    return { name: "room", roomKey: roomMatch[1] };
  }

  return null;
}

export function roomPath(roomKey: string): string {
  return `/room/${roomKey}`;
}

export function lobbyPath(params?: URLSearchParams | string): string {
  if (!params) return "/";

  const search = typeof params === "string" ? params : params.toString();
  return search ? `/?${search}` : "/";
}
