import type { UserRecord } from "@/room/types";
import { escHtml } from "@/client/utils";

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
let roomsList: RoomEntry[] = [];
let currentRoomDetail: RoomDetail | null = null;
const adminRoot = document.getElementById("admin-page");

// DOM Elements
const authSection = document.querySelector<HTMLDivElement>("#auth-section");
const dashboardShell = document.querySelector<HTMLDivElement>("#dashboard-shell");
const tokenInput = document.querySelector<HTMLInputElement>("#auth-token-input");
const authSubmitBtn = document.querySelector<HTMLButtonElement>("#auth-submit-btn");
const authError = document.querySelector<HTMLDivElement>("#auth-error");
const refreshBtn = document.querySelector<HTMLButtonElement>("#refresh-btn");
const logoutBtn = document.querySelector<HTMLButtonElement>("#logout-btn");
const themeToggleBtn = document.querySelector<HTMLButtonElement>("#theme-toggle-btn");

// Stats elements
const statTotalRooms = document.querySelector<HTMLDivElement>("#stat-total-rooms");
const statActiveRooms = document.querySelector<HTMLDivElement>("#stat-active-rooms");
const statExpiredRooms = document.querySelector<HTMLDivElement>("#stat-expired-rooms");
const serverTimeEl = document.querySelector<HTMLSpanElement>("#server-time");
const lastUpdatedEl = document.querySelector<HTMLSpanElement>("#last-updated");

// Navigation
const navItems = document.querySelectorAll<HTMLElement>(".admin-nav-item");
const sections = document.querySelectorAll<HTMLElement>(".admin-section");

// Rooms section
const roomFilter = document.getElementById("room-filter") as HTMLSelectElement | null;
const roomSearch = document.querySelector<HTMLInputElement>("#room-search");
const roomsTbody = document.querySelector<HTMLTableSectionElement>("#rooms-tbody");

// Room detail drawer
const roomDetailDrawer = document.querySelector<HTMLDivElement>("#room-detail-drawer");
const drawerClose = document.querySelector<HTMLButtonElement>("#drawer-close");
const detailRoomKey = document.getElementById("detail-room-key");
const detailRoomStatus = document.getElementById("detail-room-status");
const detailCreatedAt = document.getElementById("detail-created-at");
const detailExpiresAt = document.getElementById("detail-expires-at");
const detailOnlineCount = document.getElementById("detail-online-count");
const detailUsersList = document.querySelector<HTMLDivElement>("#detail-users-list");
const configMaxFileSize = document.querySelector<HTMLInputElement>("#config-max-file-size");
const configSaveBtn = document.querySelector<HTMLButtonElement>("#config-save-btn");
const configSaveError = document.querySelector<HTMLDivElement>("#config-save-error");

function init(): void {
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
  tokenInput?.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.isComposing || e.key === "Process") && e.key !== "Escape") return;
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
    const response = await fetch("/api/v1/admin/stats", {
      headers: { "X-Admin-Token": token },
    });

    if (response.ok) {
      currentToken = token;
      sessionStorage.setItem("admin_token", token);
      showDashboard();
      updateStatsDisplay(await response.json() as StatsData);
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
    const response = await fetch("/api/v1/admin/stats", {
      headers: { "X-Admin-Token": currentToken },
    });

    if (response.ok) {
      const data = await response.json() as StatsData;
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
    const response = await fetch("/api/v1/admin/rooms", {
      headers: { "X-Admin-Token": currentToken },
    });

    if (response.ok) {
      const data = await response.json() as { rooms: RoomEntry[] };
      roomsList = data.rooms;
      renderRoomsTable();
    } else if (response.status === 401) {
      handleLogout();
    } else {
      throw new Error(`Failed to load rooms: ${response.status}`);
    }
  } catch (err) {
    console.error("Failed to load rooms:", err);
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
        <tr class="room-row" data-room-key="${room.key}" tabindex="0" role="button">
          <td><code class="room-key">${room.key}</code></td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${room.onlineCount}</td>
          <td>${expiresAt}</td>
          <td>
            <button class="btn btn-secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem">
              Details
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  roomsTbody.querySelectorAll(".room-row").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row instanceof HTMLElement ? row.dataset.roomKey : undefined;
      if (key) openRoomDetail(key);
    });

    row.addEventListener("keydown", (event) => {
      if (!(event instanceof KeyboardEvent) || event.target !== row) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      const key = row instanceof HTMLElement ? row.dataset.roomKey : undefined;
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
            <div class="user-avatar" style="background:var(--accent-dim);color:var(--accent)">${escHtml(initial)}</div>
            <div class="user-info">
              <div class="user-name">${escHtml(user.displayName)}</div>
              <div class="user-meta">ID: ${escHtml(user.userId.slice(0, 8))}...</div>
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
