import "./assets/css/app.css";
import { parseAppRoute } from "./router";
import { renderLobbyPage } from "./ui/lobbyPage";
import { renderRoomPage } from "./ui/roomPage";

const route = parseAppRoute(location.pathname);
const app = document.getElementById("app");

if (!app) {
  throw new Error("Missing #app container");
}

if (route?.name === "room") {
  app.innerHTML = renderRoomPage();
  document.title = `Room ${route.roomKey} — Edge Drop`;
  void import("./assets/js/room");
} else if (route?.name === "lobby") {
  app.innerHTML = renderLobbyPage();
  if (new URLSearchParams(location.search).has("expired")) {
    const banner = document.getElementById("error-banner");
    if (banner) {
      banner.textContent = "Room has expired or does not exist.";
      banner.style.display = "block";
    }
  }
  void import("./assets/js/lobby");
} else {
  window.location.replace("/");
}
