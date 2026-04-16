const THEME_STORAGE_KEY = "edge-drop:theme";

export type ThemeMode = "light" | "dark";
export type ThemePreference = "system" | ThemeMode;

export function getStoredThemePreference(): ThemePreference {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return "system";
}

export function getAppliedTheme(
  themeViewport: MediaQueryList,
  preference: ThemePreference
): ThemeMode {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  return themeViewport.matches ? "dark" : "light";
}

export function applyThemePreference(themeViewport: MediaQueryList): ThemePreference {
  const preference = getStoredThemePreference();
  const theme = getAppliedTheme(themeViewport, preference);
  if (preference === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  return preference;
}
