export interface AdminPageProps {
  token?: string;
}

export function AdminPage(props: AdminPageProps) {
  return (
    <div id="admin-page" data-token={props.token ?? ""}>
      <div id="auth-section" class="admin-auth-section">
        <div class="admin-auth-card">
          <h2>Admin Authentication</h2>
          <p>Please enter your admin token to access the dashboard.</p>
          <input
            id="auth-token-input"
            type="password"
            class="admin-auth-input"
            placeholder="Enter admin token..."
          />
          <button id="auth-submit-btn" class="btn btn-primary" style="width:100%">
            Login
          </button>
          <div id="auth-error" class="error-banner" style="display:none;margin-top:1rem">
            Invalid token
          </div>
        </div>
      </div>

      <div id="dashboard-shell" class="admin-layout" style="display:none">
        <aside class="admin-sidebar">
          <div class="admin-logo">
            Edge <span>Drop</span>
            <div class="admin-badge">Admin</div>
          </div>

          <nav class="admin-nav">
            <a href="#overview" class="admin-nav-item active" data-section="overview">
              <span class="admin-nav-icon">📊</span>
              <span>Overview</span>
            </a>
            <a href="#rooms" class="admin-nav-item" data-section="rooms">
              <span class="admin-nav-icon">🏠</span>
              <span>Rooms</span>
            </a>
            <a href="#settings" class="admin-nav-item" data-section="settings">
              <span class="admin-nav-icon">⚙️</span>
              <span>Settings</span>
            </a>
          </nav>

          <div class="admin-sidebar-footer">
            <a href="/" class="btn btn-secondary" style="width:100%;text-align:center;text-decoration:none">
              ← Back to Home
            </a>
          </div>
        </aside>

        <main class="admin-main">
          <header class="admin-header">
            <h1 class="admin-title">Dashboard</h1>
            <div class="admin-header-actions">
              <button id="refresh-btn" class="btn btn-secondary" title="Refresh data">
                🔄 Refresh
              </button>
              <button id="theme-toggle-btn" class="btn btn-secondary">
                Theme
              </button>
            </div>
          </header>

          <div id="dashboard-content" class="admin-content">
            <section id="section-overview" class="admin-section">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-icon" style="background:var(--accent-dim);color:var(--accent)">🏠</div>
                <div class="stat-content">
                  <div class="stat-value" id="stat-total-rooms">-</div>
                  <div class="stat-label">Total Rooms</div>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon" style="background:rgba(76,175,127,0.15);color:var(--success)">●</div>
                <div class="stat-content">
                  <div class="stat-value" id="stat-active-rooms">-</div>
                  <div class="stat-label">Active Rooms</div>
                </div>
              </div>
              <div class="stat-card">
                <div class="stat-icon" style="background:var(--danger-soft);color:var(--danger)">⚠</div>
                <div class="stat-content">
                  <div class="stat-value" id="stat-expired-rooms">-</div>
                  <div class="stat-label">Expired Rooms</div>
                </div>
              </div>
            </div>

            <div class="admin-card">
              <h3>System Status</h3>
              <div class="system-info">
                <div class="system-info-item">
                  <span class="system-info-label">Server Time</span>
                  <span class="system-info-value" id="server-time">-</span>
                </div>
                <div class="system-info-item">
                  <span class="system-info-label">Last Updated</span>
                  <span class="system-info-value" id="last-updated">-</span>
                </div>
              </div>
            </div>
            </section>

            <section id="section-rooms" class="admin-section" style="display:none">
              <div class="admin-card">
                <div class="rooms-header">
                  <h3>Room Management</h3>
                  <div class="rooms-filters">
                    <select id="room-filter" class="admin-select">
                      <option value="all">All Rooms</option>
                      <option value="active">Active</option>
                      <option value="expired">Expired</option>
                    </select>
                    <input
                      type="text"
                      id="room-search"
                      class="admin-input"
                      placeholder="Search room key..."
                    />
                  </div>
                </div>

                <div class="rooms-table-container">
                  <table class="rooms-table">
                    <thead>
                      <tr>
                        <th>Room Key</th>
                        <th>Status</th>
                        <th>Online</th>
                        <th>Expires At</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody id="rooms-tbody">
                      <tr>
                        <td colSpan={5} class="rooms-empty">Loading...</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section id="section-settings" class="admin-section" style="display:none">
              <div class="admin-card">
                <h3>Admin Settings</h3>
                <div class="settings-list">
                  <div class="setting-item">
                    <div class="setting-info">
                      <div class="setting-name">Session</div>
                      <div class="setting-desc">Clear local admin token and logout</div>
                    </div>
                    <button id="logout-btn" class="btn btn-secondary">
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div id="room-detail-drawer" class="drawer-overlay" style="display:none">
            <div class="drawer-backdrop" id="drawer-backdrop"></div>
            <div class="drawer-panel">
              <div class="drawer-header">
                <h2>Room Details</h2>
                <button id="drawer-close" class="btn btn-secondary" style="padding:0.4rem 0.6rem;font-size:0.8rem">
                  ✕ Close
                </button>
              </div>

              <div class="drawer-content">
                <div class="drawer-section">
                  <h3>Basic Info</h3>
                  <div class="room-info-grid">
                    <div class="room-info-item">
                      <span class="room-info-label">Room Key</span>
                      <code id="detail-room-key" class="room-key">-</code>
                    </div>
                    <div class="room-info-item">
                      <span class="room-info-label">Status</span>
                      <span id="detail-room-status" class="status-badge">-</span>
                    </div>
                    <div class="room-info-item">
                      <span class="room-info-label">Created At</span>
                      <span id="detail-created-at">-</span>
                    </div>
                    <div class="room-info-item">
                      <span class="room-info-label">Expires At</span>
                      <span id="detail-expires-at">-</span>
                    </div>
                    <div class="room-info-item">
                      <span class="room-info-label">Online Count</span>
                      <span id="detail-online-count">-</span>
                    </div>
                  </div>
                </div>

                <div class="drawer-section">
                  <h3>Configuration</h3>
                  <div class="config-form">
                    <div class="config-item">
                      <label class="config-label">Max File Size (MB)</label>
                      <input
                        id="config-max-file-size"
                        type="number"
                        class="admin-input"
                        min={1}
                      />
                    </div>
                    <button id="config-save-btn" class="btn btn-primary" style="margin-top:0.5rem">
                      Save Changes
                    </button>
                    <div id="config-save-error" class="error-banner" style="display:none;margin-top:0.5rem">
                      Failed to save configuration
                    </div>
                  </div>
                </div>

                <div class="drawer-section">
                  <h3>Users</h3>
                  <div id="detail-users-list" class="users-list">
                    <p class="text-dim">Loading...</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
