export function renderLobbyPage(): string {
  return `
    <div id="lobby-page" class="lobby">
      <div class="lobby-card">
        <div class="logo">Edge <span>Drop</span></div>

        <div>
          <h2>Enter room key</h2>
        </div>

        <div class="digit-row">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 1">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 2">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 3">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 4">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 5">
          <input class="digit-input" type="tel" inputmode="numeric" maxlength="1" autocomplete="off" aria-label="Digit 6">
        </div>

        <div id="error-banner" class="error-banner"></div>

        <div class="lobby-actions">
          <button id="join-btn" class="btn btn-primary">Join Room</button>
          <button id="create-btn" class="btn btn-secondary">Create New Room</button>
        </div>

        <p style="font-size:0.75rem;color:var(--text-dim);text-align:center">
          Rooms auto-expire after 24 hours. No registration required.
        </p>
      </div>
    </div>
  `;
}
