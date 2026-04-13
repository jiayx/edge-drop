export type MessageType = "text" | "image" | "audio" | "file" | "system";
export type RoomStatus = "active" | "expired" | "cleaning";

export interface RoomMeta {
  roomKey: string;
  createdAt: number;
  expiresAt: number;
  r2Prefix: string;
  status: RoomStatus;
}

export interface UserRecord {
  userId: string;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
}

export interface Message {
  id: string;
  seq: number;
  type: MessageType;
  senderId: string;
  senderName: string;
  content: string;
  fileName?: string;
  fileMime?: string;
  fileSizeBytes?: number;
  createdAt: number;
}

// WebSocket message shapes — client → server
export interface WsMsgText {
  type: "msg:text";
  content: string;
  tempId: string;
}

export interface WsMsgFile {
  type: "msg:file";
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  tempId: string;
}

export interface WsUserRename {
  type: "user:rename";
  newName: string;
}

export interface WsHistoryRequest {
  type: "history:request";
  fromSeq: number;
  limit: number;
}

export type ClientMessage = WsMsgText | WsMsgFile | WsUserRename | WsHistoryRequest;

// WebSocket message shapes — server → client
export interface SvMsgBroadcast {
  type: "msg:text" | "msg:file" | "msg:system";
  message: Message;
}

export interface SvMsgAck {
  type: "msg:ack";
  tempId: string;
  seq: number;
  id: string;
}

export interface SvUserEvent {
  type: "user:join" | "user:leave";
  userId: string;
  displayName?: string;
  onlineCount: number;
  onlineUsers: UserRecord[];
}

export interface SvUserRename {
  type: "user:rename";
  userId: string;
  newName: string;
}

export interface SvPresence {
  type: "room:presence";
  users: UserRecord[];
  onlineCount: number;
}

export interface SvRoomExtended {
  type: "room:extended";
  expiresAt: number;
}

export interface SvRoomExpiring {
  type: "room:expiring";
  minutesLeft: number;
}

export interface SvRoomExpired {
  type: "room:expired";
}

export interface SvHistoryResponse {
  type: "history:response";
  messages: Message[];
  hasMore: boolean;
  nextSeq: number;
}

export interface SvError {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | SvMsgBroadcast
  | SvMsgAck
  | SvUserEvent
  | SvUserRename
  | SvPresence
  | SvRoomExtended
  | SvRoomExpiring
  | SvRoomExpired
  | SvHistoryResponse
  | SvError;

// Room index registry entry
export interface RoomIndexEntry {
  doId: string;
  expiresAt: number;
}
