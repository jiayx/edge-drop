// ws.ts — WebSocket client with exponential backoff auto-reconnect
import type { ServerMessage, ClientMessage } from "@/room/types";

export interface RoomWebSocketOptions {
  roomKey: string;
  userId: string;
  displayName: string;
  fromSeq: number;
  onMessage: (msg: ServerMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class RoomWebSocket {
  private roomKey: string;
  private userId: string;
  private displayName: string;
  private fromSeq: number;
  private onMessage: (msg: ServerMessage) => void;
  private onOpen?: () => void;
  private onClose?: () => void;
  private ws: WebSocket | null = null;
  private retryDelay = 1000;
  private readonly maxDelay = 30000;
  private closed = false;

  constructor(opts: RoomWebSocketOptions) {
    this.roomKey = opts.roomKey;
    this.userId = opts.userId;
    this.displayName = opts.displayName;
    this.fromSeq = opts.fromSeq;
    this.onMessage = opts.onMessage;
    this.onOpen = opts.onOpen;
    this.onClose = opts.onClose;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url =
      `${proto}://${location.host}/api/v1/ws/${this.roomKey}` +
      `?userId=${encodeURIComponent(this.userId)}` +
      `&displayName=${encodeURIComponent(this.displayName)}` +
      `&fromSeq=${this.fromSeq}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.retryDelay = 1000;
      this.onOpen?.();
    };

    this.ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as ServerMessage;
        this.onMessage(msg);
      } catch { /* ignore malformed frames */ }
    };

    this.ws.onclose = () => {
      this.onClose?.();
      if (!this.closed) {
        setTimeout(() => this.connect(), this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, this.maxDelay);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  updateFromSeq(seq: number): void {
    this.fromSeq = seq;
  }
}
