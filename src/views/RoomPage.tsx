import { Icon } from "@/lib/icons";

export interface RoomPageProps {
  roomKey: string;
  maxFileSizeMb: number;
}

export function RoomPage(props: RoomPageProps) {
  return (
    <div
      id="room-page"
      class="room-layout"
      data-room-key={props.roomKey}
      data-max-file-size-mb={String(props.maxFileSizeMb)}
    >
      <header class="room-header">
        <div class="room-share-anchor">
          <button id="room-key" class="room-key-display" type="button" title="Hover to share room, click to copy room key">
            {props.roomKey}
          </button>
          <div id="room-share-popover" class="room-share-popover" aria-hidden="true">
            <span class="room-share-arrow" aria-hidden="true"></span>
            <img
              id="room-share-qr"
              class="room-share-qr"
              alt={`QR code for room ${props.roomKey}`}
              loading="lazy"
              width="176"
              height="176"
            />
            <div id="room-share-hint" class="room-share-hint">Scan to open this room</div>
            <button
              id="copy-room-link-btn"
              class="btn btn-secondary share-copy-btn"
              type="button"
            >
              Copy link
            </button>
          </div>
        </div>
        <div id="countdown" class="countdown"></div>
        <span class="header-gap"></span>
        <a href="/" class="btn btn-secondary home-link-btn" style="font-size:0.8rem;padding:0.4rem 0.8rem;text-decoration:none">
          <Icon name="home" />
          <span>Home</span>
        </a>
        <button id="extend-btn" class="btn btn-secondary" style="font-size:0.8rem;padding:0.4rem 0.8rem">
          +24h
        </button>
        <button id="theme-toggle-btn" class="btn btn-secondary icon-btn" title="Theme: System. Click to switch." aria-label="Switch theme">
          <Icon name="monitor" />
        </button>
      </header>

      <aside class="sidebar">
        <div class="self-name-section">
          <div class="self-name-label">Your name</div>
          <span id="self-name" class="self-name"></span>
          <input id="self-name-input" class="self-name-input" type="text" maxLength={32} placeholder="New name..." />
        </div>

        <div class="sidebar-section">
          <div class="sidebar-presence-header">
            <span class="sidebar-label">Online</span>
            <span id="online-count" class="online-badge">0</span>
          </div>
          <div id="user-list" class="user-list"></div>
        </div>
      </aside>

      <section class="mobile-presence">
        <div class="mobile-presence-header">
          <span class="mobile-online-label">Online</span>
          <span id="mobile-online-count" class="mobile-online-badge">0</span>
          <span class="mobile-presence-divider" aria-hidden="true"></span>
          <div id="mobile-user-list" class="mobile-user-list"></div>
        </div>
      </section>

      <main class="messages-area" id="message-list">
        <div id="top-loader"></div>
      </main>

      <div class="reconnect-banner" id="reconnect-banner">Reconnecting...</div>

      <div id="file-drop-overlay" class="file-drop-overlay" aria-hidden="true">
        <div class="file-drop-overlay-card">
          <div class="file-drop-overlay-title">Drop files to send</div>
          <div class="file-drop-overlay-subtitle">Images, documents, audio, video, and more</div>
        </div>
      </div>

      <div id="paste-confirm-modal" class="paste-confirm-modal" style="display:none">
        <div id="paste-confirm-backdrop" class="paste-confirm-backdrop"></div>
        <div class="paste-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="paste-confirm-title">
          <div class="paste-confirm-header">
            <h2 id="paste-confirm-title" class="paste-confirm-title">Send pasted file?</h2>
          </div>
          <div class="paste-confirm-body">
            <div id="paste-confirm-preview" class="paste-confirm-preview" style="display:none"></div>
            <div id="paste-confirm-summary" class="paste-confirm-summary"></div>
          </div>
          <div class="paste-confirm-actions">
            <button id="paste-confirm-cancel" class="btn btn-secondary" type="button">Cancel</button>
            <button id="paste-confirm-send" class="btn btn-primary" type="button">Send</button>
          </div>
        </div>
      </div>

      <footer class="input-bar">
        <button
          id="attach-btn"
          class="btn btn-secondary attach-btn"
          title="Attach file"
          aria-label="Attach file"
        >
          <Icon name="paperclip" />
        </button>
        <div id="composer-wrap" class="composer-wrap">
          <textarea
            id="message-input"
            class="message-input"
            rows={1}
            placeholder="Type a message... (Enter to send)"
          ></textarea>
          <div id="mention-menu" class="mention-menu" role="listbox" aria-label="Mention room users"></div>
        </div>
        <button id="send-btn" class="btn btn-primary" style="align-self:stretch;padding:0 1rem">
          Send
        </button>
        <input
          id="file-picker"
          type="file"
          multiple
          style="display:none"
          accept="image/*,audio/*,video/*,text/*,application/pdf,application/json,application/zip,application/epub+zip,text/markdown,text/csv,application/rtf,.epub,.md,.csv,.rtf,.7z,.rar,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.heic,.heif"
        />
      </footer>
    </div>
  );
}
