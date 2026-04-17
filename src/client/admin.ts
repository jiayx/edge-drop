// Admin dashboard client-side logic

interface StatsData {
  totalRooms: number;
  activeRooms: number;
  expiredRooms: number;
  timestamp: number;
}

interface RoomEntry {
  key: string;
  doId: string;
  expiresAt: number;
  isActive: boolean;
  onlineCount: number;
}

interface UserRecord {
  userId: string;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
}

interface RoomDetail {
  key: string;
  doId: string;
  roomKey: string;
  createdAt: number;
  expiresAt: number;
  maxFileSizeMb: number;
  status: string;
  onlineCount: number;
  onlineUsers: UserRecord[];
}

let currentToken = "";
let currentStats: StatsData | null = null;
let roomsList: RoomEntry[] = [];
let currentRoomDetail: RoomDetail | null = null;
const adminRoot = document.getElementById("admin-page");

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function asDiv(el: HTMLElement | null): HTMLDivElement | null {
  return el instanceof HTMLDivElement ? el : null;
}

function asInput(el: HTMLElement | null): HTMLInputElement | null {
  return el instanceof HTMLInputElement ? el : null;
}

function asButton(el: HTMLElement | null): HTMLButtonElement | null {
  return el instanceof HTMLButtonElement ? el : null;
}

function asSpan(el: HTMLElement | null): HTMLSpanElement | null {
  return el instanceof HTMLSpanElement ? el : null;
}

function asSelect(el: HTMLElement | null): HTMLSelectElement | null {
  return el instanceof HTMLSelectElement ? el : null;
}

function asTBody(el: HTMLElement | null): HTMLTableSectionElement | null {
  return el instanceof HTMLTableSectionElement ? el : null;
}

// DOM Elements
const authSection = asDiv(byId("auth-section"));
const dashboardShell = asDiv(byId("dashboard-shell"));
const dashboardContent = asDiv(byId("dashboard-content"));
const tokenInput = asInput(byId("auth-token-input"));
const authSubmitBtn = asButton(byId("auth-submit-btn"));
const authError = asDiv(byId("auth-error"));
const refreshBtn = asButton(byId("refresh-btn"));
const logoutBtn = asButton(byId("logout-btn"));
const themeToggleBtn = asButton(byId("theme-toggle-btn"));

// Stats elements
const statTotalRooms = asDiv(byId("stat-total-rooms"));
const statActiveRooms = asDiv(byId("stat-active-rooms"));
const statExpiredRooms = asDiv(byId("stat-expired-rooms"));
const serverTimeEl = asSpan(byId("server-time"));
const lastUpdatedEl = asSpan(byId("last-updated"));

// Navigation
const navItems = document.querySelectorAll<HTMLElement>(".admin-nav-item");
const sections = document.querySelectorAll<HTMLElement>(".admin-section");

// Rooms section
const roomFilter = asSelect(byId("room-filter"));
const roomSearch = asInput(byId("room-search"));
const roomsTbody = asTBody(byId("rooms-tbody"));

// Room detail drawer
const roomDetailDrawer = asDiv(byId("room-detail-drawer"));
const drawerBackdrop = asDiv(byId("drawer-backdrop"));
const drawerClose = asButton(byId("drawer-close"));
const detailRoomKey = byId("detail-room-key");
const detailRoomStatus = byId("detail-room-status");
const detailCreatedAt = byId("detail-created-at");
const detailExpiresAt = byId("detail-expires-at");
const detailOnlineCount = byId("detail-online-count");
const detailUsersList = asDiv(byId("detail-users-list"));
const configMaxFileSize = asInput(byId("config-max-file-size"));
const configSaveBtn = asButton(byId("config-save-btn"));
const configSaveError = asDiv(byId("config-save-error"));

function init(): void {
  if (!adminRoot) return;

  // Check for stored token
  const storedToken = sessionStorage.getItem("admin_token");
  if (storedToken) {
    currentToken = storedToken;
    showDashboard();
    loadStats();
    loadRooms();
  }

  // Event listeners
  authSubmitBtn?.addEventListener("click", handleAuth);
  tokenInput?.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleAuth();
  });

  refreshBtn?.addEventListener("click", () => {
    loadStats();
    loadRooms();
  });

  logoutBtn?.addEventListener("click", handleLogout);
  themeToggleBtn?.addEventListener("click", toggleTheme);

  // Navigation
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      if (section) showSection(section);

      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");
    });
  });

  // Room filters
  roomFilter?.addEventListener("change", renderRoomsTable);
  roomSearch?.addEventListener("input", renderRoomsTable);

  // Room detail drawer
  drawerClose?.addEventListener("click", closeRoomDetail);
  configSaveBtn?.addEventListener("click", saveRoomConfig);
}

async function handleAuth(): Promise<void> {
  if (!tokenInput || !authSubmitBtn) return;

  const token = tokenInput.value.trim();
  if (!token) return;

  authSubmitBtn.disabled = true;
  if (authError) authError.style.display = "none";

  try {
    // Test the token by making a stats request
    const response = await fetch("/api/v1/stats", {
      headers: { "X-Stats-Token": token },
    });

    if (response.ok) {
      currentToken = token;
      sessionStorage.setItem("admin_token", token);
      showDashboard();
      await loadStats();
      await loadRooms();
    } else {
      if (authError) authError.style.display = "block";
    }
  } catch (err) {
    console.error("Auth error:", err);
    if (authError) authError.style.display = "block";
  } finally {
    if (authSubmitBtn) authSubmitBtn.disabled = false;
  }
}

function showDashboard(): void {
  if (authSection) authSection.style.display = "none";
  if (dashboardShell) dashboardShell.style.display = "grid";
  if (dashboardContent) dashboardContent.style.display = "block";
}

function showSection(sectionId: string): void {
  sections.forEach((section) => {
    section.style.display = "none";
  });

  const targetSection = document.getElementById(`section-${sectionId}`);
  if (targetSection) {
    targetSection.style.display = "block";
  }

  // Update title
  const titleEl = document.querySelector<HTMLElement>(".admin-title");
  if (titleEl) {
    const titles: Record<string, string> = {
      overview: "Dashboard",
      rooms: "Room Management",
      settings: "Settings",
    };
    titleEl.textContent = titles[sectionId] || "Dashboard";
  }
}

async function loadStats(): Promise<void> {
  if (!currentToken) return;

  try {
    const response = await fetch("/api/v1/stats", {
      headers: { "X-Stats-Token": currentToken },
    });

    if (response.ok) {
      const data = await response.json() as StatsData;
      currentStats = data;
      updateStatsDisplay(data);
    } else if (response.status === 401) {
      handleLogout();
    }
  } catch (err) {
    console.error("Failed to load stats:", err);
  }
}

function updateStatsDisplay(data: StatsData): void {
  if (statTotalRooms) statTotalRooms.textContent = data.totalRooms.toString();
  if (statActiveRooms) statActiveRooms.textContent = data.activeRooms.toString();
  if (statExpiredRooms) statExpiredRooms.textContent = data.expiredRooms.toString();

  if (serverTimeEl) serverTimeEl.textContent = new Date(data.timestamp).toLocaleString();
  if (lastUpdatedEl) lastUpdatedEl.textContent = new Date().toLocaleTimeString();
}

async function loadRooms(): Promise<void> {
  if (!currentToken) return;

  try {
    // Use the internal list endpoint
    const response = await fetch("/api/v1/admin/rooms", {
      headers: { "X-Admin-Token": currentToken },
    });

    if (response.ok) {
      const data = await response.json() as { rooms: RoomEntry[] };
      roomsList = data.rooms || [];
      renderRoomsTable();
    } else if (response.status === 404) {
      // API not available, use stats only
      roomsList = [];
      renderRoomsTable();
    }
  } catch (err) {
    console.error("Failed to load rooms:", err);
    // Fallback: empty list
    roomsList = [];
    renderRoomsTable();
  }
}

function renderRoomsTable(): void {
  if (!roomsTbody) return;
  const filter = roomFilter?.value || "all";
  const search = roomSearch?.value.trim().toLowerCase() || "";

  let filtered = roomsList;

  if (filter === "active") {
    filtered = filtered.filter((r) => r.isActive);
  } else if (filter === "expired") {
    filtered = filtered.filter((r) => !r.isActive);
  }

  if (search) {
    filtered = filtered.filter((r) => r.key.includes(search));
  }

  if (filtered.length === 0) {
    roomsTbody.innerHTML = `
      <tr>
        <td colSpan="5" class="rooms-empty">No rooms found</td>
      </tr>
    `;
    return;
  }

  roomsTbody.innerHTML = filtered
    .map((room) => {
      const expiresAt = new Date(room.expiresAt).toLocaleString();
      const statusClass = room.isActive ? "status-active" : "status-expired";
      const statusText = room.isActive ? "Active" : "Expired";

      return `
        <tr>
          <td><code class="room-key">${room.key}</code></td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${room.onlineCount}</td>
          <td>${expiresAt}</td>
          <td>
            <button class="btn btn-secondary btn-details" data-room-key="${room.key}" style="font-size:0.75rem;padding:0.3rem 0.6rem">
              Details
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  // Attach event listeners to detail buttons
  roomsTbody.querySelectorAll(".btn-details").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn instanceof HTMLElement ? btn.dataset.roomKey : undefined;
      if (key) openRoomDetail(key);
    });
  });
}

async function openRoomDetail(roomKey: string): Promise<void> {
  if (!currentToken || !roomDetailDrawer) return;

  try {
    const response = await fetch(`/api/v1/admin/rooms/${roomKey}`, {
      headers: { "X-Admin-Token": currentToken },
    });

    if (response.ok) {
      const detail = await response.json() as RoomDetail;
      currentRoomDetail = detail;
      renderRoomDetail(detail);
      roomDetailDrawer.style.display = "block";
    } else if (response.status === 401) {
      handleLogout();
    } else {
      console.error("Failed to load room detail:", response.status);
    }
  } catch (err) {
    console.error("Error loading room detail:", err);
  }
}

function renderRoomDetail(detail: RoomDetail): void {
  if (!detailRoomKey || !detailRoomStatus || !detailCreatedAt || !detailExpiresAt || !detailOnlineCount || !detailUsersList || !configMaxFileSize) {
    return;
  }

  detailRoomKey.textContent = detail.roomKey;

  const isActive = detail.expiresAt > Date.now();
  detailRoomStatus.className = `status-badge ${isActive ? "status-active" : "status-expired"}`;
  detailRoomStatus.textContent = isActive ? "Active" : "Expired";

  detailCreatedAt.textContent = new Date(detail.createdAt).toLocaleString();
  detailExpiresAt.textContent = new Date(detail.expiresAt).toLocaleString();
  detailOnlineCount.textContent = String(detail.onlineCount ?? 0);

  // Config - use value from backend (stored in room meta)
  configMaxFileSize.value = String(detail.maxFileSizeMb);
  if (configSaveError) configSaveError.style.display = "none";

  // Users list
  const users = detail.onlineUsers || [];
  if (users.length === 0) {
    detailUsersList.innerHTML = '<p class="text-dim">No online users</p>';
  } else {
    detailUsersList.innerHTML = users
      .map((user) => {
        const initial = user.displayName.charAt(0).toUpperCase();
        return `
          <div class="user-item">
            <div class="user-avatar" style="background:var(--accent-dim);color:var(--accent)">${initial}</div>
            <div class="user-info">
              <div class="user-name">${user.displayName}</div>
              <div class="user-meta">ID: ${user.userId.slice(0, 8)}...</div>
            </div>
          </div>
        `;
      })
      .join("");
  }
}

function closeRoomDetail(): void {
  if (roomDetailDrawer) roomDetailDrawer.style.display = "none";
  currentRoomDetail = null;
}

async function saveRoomConfig(): Promise<void> {
  if (!currentToken || !currentRoomDetail || !configMaxFileSize || !configSaveBtn) return;

  const maxFileSizeMb = parseInt(configMaxFileSize.value, 10);
  if (isNaN(maxFileSizeMb) || maxFileSizeMb < 1) {
    if (configSaveError) {
      configSaveError.textContent = "Invalid file size (must be at least 1 MB)";
      configSaveError.style.display = "block";
    }
    return;
  }

  configSaveBtn.disabled = true;
  if (configSaveError) configSaveError.style.display = "none";

  try {
    const response = await fetch(`/api/v1/admin/rooms/${currentRoomDetail.roomKey}/config`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": currentToken,
      },
      body: JSON.stringify({ maxFileSizeMb }),
    });

    if (response.ok) {
      // Refresh the detail view
      await openRoomDetail(currentRoomDetail.roomKey);
    } else if (response.status === 401) {
      handleLogout();
    } else {
      if (configSaveError) {
        configSaveError.textContent = "Failed to save configuration";
        configSaveError.style.display = "block";
      }
    }
  } catch (err) {
    console.error("Error saving config:", err);
    if (configSaveError) {
      configSaveError.textContent = "Network error";
      configSaveError.style.display = "block";
    }
  } finally {
    configSaveBtn.disabled = false;
  }
}

function handleLogout(): void {
  currentToken = "";
  sessionStorage.removeItem("admin_token");
  if (authSection) authSection.style.display = "flex";
  if (dashboardShell) dashboardShell.style.display = "none";
  if (dashboardContent) dashboardContent.style.display = "block";
  if (tokenInput) tokenInput.value = "";
}

function toggleTheme(): void {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  localStorage.setItem("theme", newTheme);
}

if (adminRoot) {
  document.addEventListener("DOMContentLoaded", init);
}
