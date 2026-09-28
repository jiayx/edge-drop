export function LobbyPage() {
  return (
    <div id="lobby-page" class="lobby">
      <div class="lobby-card">
        <div class="logo">
          Edge <span>Drop</span>
        </div>

        <div>
          <h2>Enter room key</h2>
        </div>

        <div class="digit-row">
          {Array.from({ length: 6 }, (_, index) => (
            <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label={`Digit ${index + 1}`} />
          ))}
        </div>

        <div
          id="error-banner"
          class="error-banner"
          style="display:none"
        />

        <div class="lobby-actions">
          <button id="join-btn" class="btn btn-primary">Join Room</button>
          <button id="create-btn" class="btn btn-secondary">Create New Room</button>
        </div>

        <p style="font-size:0.75rem;line-height:1.7;color:var(--text-dim);text-align:center">
          Temporary rooms for sharing text and files instantly.
          <br />
          Rooms auto-expire after 24 hours. No registration required.
        </p>
      </div>
    </div>
  );
}
