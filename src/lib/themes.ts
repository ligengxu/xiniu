export interface ThemeConfig {
  id: string;
  name: string;
  label: string;
  colors: {
    background: string;
    foreground: string;
    accent: string;
    accentHover: string;
    border: string;
    surface: string;
    surfaceElevated: string;
    surfaceHover: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    success: string;
    error: string;
    warning: string;
    userBubble: string;
    userBubbleText: string;
    aiBubble: string;
    aiBubbleBorder: string;
  };
}

export const THEMES: ThemeConfig[] = [
  {
    id: "space-black",
    name: "深空黑",
    label: "Space Black",
    colors: {
      background: "#09090b",
      foreground: "#fafafa",
      accent: "#10b981",
      accentHover: "#34d399",
      border: "#27272a",
      surface: "#18181b",
      surfaceElevated: "#27272a",
      surfaceHover: "#3f3f46",
      textPrimary: "#fafafa",
      textSecondary: "#a1a1aa",
      textMuted: "#71717a",
      success: "#10b981",
      error: "#ef4444",
      warning: "#f59e0b",
      userBubble: "#10b981",
      userBubbleText: "#ffffff",
      aiBubble: "#27272a",
      aiBubbleBorder: "#3f3f4640",
    },
  },
  {
    id: "moonlight",
    name: "月光白",
    label: "Moonlight",
    colors: {
      background: "#f8f9fa",
      foreground: "#1a1a2e",
      accent: "#4f46e5",
      accentHover: "#6366f1",
      border: "#e2e8f0",
      surface: "#ffffff",
      surfaceElevated: "#f1f5f9",
      surfaceHover: "#e2e8f0",
      textPrimary: "#1e293b",
      textSecondary: "#64748b",
      textMuted: "#94a3b8",
      success: "#22c55e",
      error: "#ef4444",
      warning: "#f59e0b",
      userBubble: "#4f46e5",
      userBubbleText: "#ffffff",
      aiBubble: "#f1f5f9",
      aiBubbleBorder: "#e2e8f050",
    },
  },
  {
    id: "china-red",
    name: "中国红",
    label: "China Red",
    colors: {
      background: "#0f0a0a",
      foreground: "#faf5f0",
      accent: "#dc2626",
      accentHover: "#ef4444",
      border: "#3b2020",
      surface: "#1a1010",
      surfaceElevated: "#2d1a1a",
      surfaceHover: "#3b2020",
      textPrimary: "#faf5f0",
      textSecondary: "#c9a96e",
      textMuted: "#8b7355",
      success: "#22c55e",
      error: "#dc2626",
      warning: "#f59e0b",
      userBubble: "#dc2626",
      userBubbleText: "#ffffff",
      aiBubble: "#2d1a1a",
      aiBubbleBorder: "#3b202040",
    },
  },
  {
    id: "tech-blue",
    name: "科技蓝",
    label: "Tech Blue",
    colors: {
      background: "#0a0e1a",
      foreground: "#e0e7ff",
      accent: "#3b82f6",
      accentHover: "#60a5fa",
      border: "#1e2a4a",
      surface: "#0f1629",
      surfaceElevated: "#1a2744",
      surfaceHover: "#1e2a4a",
      textPrimary: "#e0e7ff",
      textSecondary: "#93a3c0",
      textMuted: "#5b6b8a",
      success: "#22c55e",
      error: "#ef4444",
      warning: "#f59e0b",
      userBubble: "#3b82f6",
      userBubbleText: "#ffffff",
      aiBubble: "#1a2744",
      aiBubbleBorder: "#1e2a4a40",
    },
  },
  {
    id: "forest",
    name: "森林绿",
    label: "Forest",
    colors: {
      background: "#0a110e",
      foreground: "#e0f5ec",
      accent: "#22c55e",
      accentHover: "#4ade80",
      border: "#1a3328",
      surface: "#0f1a14",
      surfaceElevated: "#1a3328",
      surfaceHover: "#234435",
      textPrimary: "#e0f5ec",
      textSecondary: "#8bc4a8",
      textMuted: "#5a8f73",
      success: "#22c55e",
      error: "#ef4444",
      warning: "#f59e0b",
      userBubble: "#22c55e",
      userBubbleText: "#ffffff",
      aiBubble: "#1a3328",
      aiBubbleBorder: "#1a332840",
    },
  },
  {
    id: "lavender",
    name: "薰衣草",
    label: "Lavender",
    colors: {
      background: "#f5f3ff",
      foreground: "#2e1065",
      accent: "#8b5cf6",
      accentHover: "#a78bfa",
      border: "#e4dff7",
      surface: "#faf8ff",
      surfaceElevated: "#ede9fe",
      surfaceHover: "#ddd6fe",
      textPrimary: "#2e1065",
      textSecondary: "#6d5b95",
      textMuted: "#9f8ec4",
      success: "#22c55e",
      error: "#ef4444",
      warning: "#f59e0b",
      userBubble: "#8b5cf6",
      userBubbleText: "#ffffff",
      aiBubble: "#ede9fe",
      aiBubbleBorder: "#e4dff750",
    },
  },
];

export function getThemeById(id: string): ThemeConfig {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

export function applyTheme(theme: ThemeConfig) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty("--background", c.background);
  root.style.setProperty("--foreground", c.foreground);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-hover", c.accentHover);
  root.style.setProperty("--border", c.border);
  root.style.setProperty("--surface", c.surface);
  root.style.setProperty("--surface-elevated", c.surfaceElevated);
  root.style.setProperty("--surface-hover", c.surfaceHover);
  root.style.setProperty("--text-primary", c.textPrimary);
  root.style.setProperty("--text-secondary", c.textSecondary);
  root.style.setProperty("--text-muted", c.textMuted);
  root.style.setProperty("--success", c.success);
  root.style.setProperty("--error", c.error);
  root.style.setProperty("--warning", c.warning);
  root.style.setProperty("--user-bubble", c.userBubble);
  root.style.setProperty("--user-bubble-text", c.userBubbleText);
  root.style.setProperty("--ai-bubble", c.aiBubble);
  root.style.setProperty("--ai-bubble-border", c.aiBubbleBorder);
}
