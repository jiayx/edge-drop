export interface LobbyPageProps {
  error?: "unavailable";
}

export function LobbyPage(props: LobbyPageProps) {
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
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 1" />
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 2" />
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 3" />
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 4" />
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 5" />
          <input class="digit-input" type="tel" inputMode="numeric" maxLength={1} autoComplete="off" aria-label="Digit 6" />
        </div>

        <div
          id="error-banner"
          class="error-banner"
          style="display:none"
        >
          {props.error ? "Room is not available." : ""}
        </div>

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
