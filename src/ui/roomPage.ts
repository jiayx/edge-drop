export function renderRoomPage(): string {
  return `
    <div id="room-page" class="room-layout">
      <header class="room-header">
        <div id="room-key" class="room-key-display" title="Click to copy"></div>
        <div id="countdown" class="countdown"></div>
        <span class="header-gap"></span>
        <a href="/" class="btn btn-secondary" style="font-size:0.8rem;padding:0.4rem 0.8rem;text-decoration:none">← Home</a>
        <button id="extend-btn" class="btn btn-secondary" style="font-size:0.8rem;padding:0.4rem 0.8rem">+24h</button>
      </header>

      <aside class="sidebar">
        <div class="self-name-section">
          <div class="self-name-label">Your name</div>
          <span id="self-name" class="self-name"></span>
          <input id="self-name-input" class="self-name-input" type="text" maxlength="32" placeholder="New name...">
        </div>

        <div class="sidebar-section">
          <h3>Online <span id="online-count" class="online-badge">0</span></h3>
          <div id="user-list" class="user-list"></div>
        </div>
      </aside>

      <main class="messages-area" id="message-list">
        <div id="top-loader"></div>
      </main>

      <div class="reconnect-banner" id="reconnect-banner">Reconnecting...</div>

      <div class="upload-progress" id="upload-progress"></div>

      <footer class="input-bar">
        <button id="attach-btn" class="btn btn-secondary" title="Attach file" style="align-self:stretch;padding:0 0.8rem;font-size:1.1rem">📎</button>
        <textarea
          id="message-input"
          class="message-input"
          rows="1"
          placeholder="Type a message... (Enter to send)"
        ></textarea>
        <button id="send-btn" class="btn btn-primary" style="align-self:stretch;padding:0 1rem">Send</button>
        <input id="file-picker" type="file" multiple style="display:none" accept="image/*,audio/*,video/*,text/*,application/pdf,application/zip,application/json,.doc,.docx,.xls,.xlsx,.ppt,.pptx">
      </footer>
    </div>
  `;
}
