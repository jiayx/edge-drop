import type { ClientMessage, Message } from "@/room/types";

import type { RoomDom } from "./dom";
import type { Identity } from "./identity";
import type { RoomWebSocket } from "./ws";

export type SendableClientMessage = Extract<ClientMessage, { type: "msg:text" | "msg:file" }>;
export type LocalOutgoingStatus = "uploading" | "upload-failed" | "pending";
export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | ThemeMode;

export interface PendingOutgoingMessage {
  tempId: string;
  kind: "text" | "file";
  optimisticMessage: Message;
  payload?: SendableClientMessage;
  autoRetryCount: number;
  status: LocalOutgoingStatus;
  file?: File;
  uploadProgress?: number;
  errorMessage?: string;
  uploadAbortController?: AbortController;
}

export interface JoinResponse {
  roomKey: string;
  expiresAt: number;
  onlineCount: number;
  onlineUsers: import("@/room/types").UserRecord[];
  messages: Message[];
  hasMoreMessages: boolean;
  nextSeq: number;
}

export interface RoomPageState {
  lastSeq: number;
  oldestSeq: number;
  hasMore: boolean;
  loadingHistory: boolean;
  ws: RoomWebSocket | null;
  expiresAt: number;
  countdownInterval: ReturnType<typeof setInterval> | null;
  stickToBottom: boolean;
  bottomCorrectionFrame: number;
  bottomCorrectionPasses: number;
  isWsConnected: boolean;
  pendingOutgoingMessages: Map<string, PendingOutgoingMessage>;
}

export interface RoomPageContext {
  roomKey: string;
  maxFileSizeBytes: number;
  maxFileSizeLabel: string;
  identity: Identity;
  dom: RoomDom;
  state: RoomPageState;
}

export function createRoomPageState(): RoomPageState {
  return {
    lastSeq: 0,
    oldestSeq: 0,
    hasMore: true,
    loadingHistory: false,
    ws: null,
    expiresAt: 0,
    countdownInterval: null,
    stickToBottom: true,
    bottomCorrectionFrame: 0,
    bottomCorrectionPasses: 0,
    isWsConnected: false,
    pendingOutgoingMessages: new Map<string, PendingOutgoingMessage>(),
  };
}
