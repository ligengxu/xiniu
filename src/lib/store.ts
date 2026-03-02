import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UIMessage } from "ai";
import { DEFAULT_PROVIDERS, type ModelProvider } from "./model-providers";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { id: string; name: string }[];
  isBuiltin: boolean;
}

interface Settings {
  providerId: string;
  modelId: string;
  disabledSkills: string[];
  theme: string;
  dialectId: string;
  speechRate: number;
  codeComplexity: "simple" | "medium" | "complex";
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

const MSG_PREFIX = "xiniu-msgs-";

export function saveSessionMessages(sessionId: string, messages: UIMessage[]) {
  try {
    localStorage.setItem(MSG_PREFIX + sessionId, JSON.stringify(messages));
  } catch {
    // storage full — prune oldest sessions
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(MSG_PREFIX));
    if (keys.length > 10) {
      keys.slice(0, 5).forEach((k) => localStorage.removeItem(k));
      try {
        localStorage.setItem(MSG_PREFIX + sessionId, JSON.stringify(messages));
      } catch { /* noop */ }
    }
  }
}

export function loadSessionMessages(sessionId: string): UIMessage[] {
  try {
    const raw = localStorage.getItem(MSG_PREFIX + sessionId);
    if (!raw) return [];
    return JSON.parse(raw) as UIMessage[];
  } catch {
    return [];
  }
}

function removeSessionMessages(sessionId: string) {
  try {
    localStorage.removeItem(MSG_PREFIX + sessionId);
  } catch { /* noop */ }
}

interface AppState {
  settings: Settings;
  sidebarOpen: boolean;
  sessions: ChatSession[];
  activeSessionId: string | null;
  providerConfigs: ProviderConfig[];

  setSidebarOpen: (open: boolean) => void;
  setSettings: (s: Partial<Settings>) => void;
  toggleSkill: (skillName: string) => void;

  createSession: (title?: string) => string;
  setActiveSession: (id: string | null) => void;
  updateSessionTitle: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  touchSession: (id: string) => void;

  getProviders: () => ProviderConfig[];
  addProvider: (p: Omit<ProviderConfig, "isBuiltin">) => void;
  updateProvider: (id: string, patch: Partial<Omit<ProviderConfig, "id" | "isBuiltin">>) => void;
  deleteProvider: (id: string) => void;
  deleteModel: (providerId: string, modelId: string) => void;
  getActiveProviderConfig: () => ProviderConfig | undefined;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function buildBuiltinConfigs(): ProviderConfig[] {
  return DEFAULT_PROVIDERS.map((p) => ({
    ...p,
    apiKey: "",
    isBuiltin: true,
  }));
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      settings: {
        providerId: "openai",
        modelId: "gpt-4o",
        disabledSkills: [],
        theme: "space-black",
        dialectId: "mandarin",
        speechRate: 1.0,
        codeComplexity: "medium",
      },
      sidebarOpen: true,
      sessions: [],
      activeSessionId: null,
      providerConfigs: buildBuiltinConfigs(),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSettings: (s) =>
        set((state) => ({
          settings: { ...state.settings, ...s },
        })),
      toggleSkill: (skillName) =>
        set((state) => {
          const disabled = state.settings.disabledSkills;
          const next = disabled.includes(skillName)
            ? disabled.filter((n) => n !== skillName)
            : [...disabled, skillName];
          return { settings: { ...state.settings, disabledSkills: next } };
        }),

      createSession: (title) => {
        const id = generateId();
        const now = Date.now();
        const session: ChatSession = {
          id,
          title: title || "新对话",
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: id,
        }));
        return id;
      },

      setActiveSession: (id) => set({ activeSessionId: id }),

      updateSessionTitle: (id, title) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, title, updatedAt: Date.now() } : s
          ),
        })),

      deleteSession: (id) => {
        removeSessionMessages(id);
        set((state) => {
          const filtered = state.sessions.filter((s) => s.id !== id);
          const newActive =
            state.activeSessionId === id
              ? filtered[0]?.id || null
              : state.activeSessionId;
          return { sessions: filtered, activeSessionId: newActive };
        });
      },

      touchSession: (id) =>
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id ? { ...s, updatedAt: Date.now() } : s
          ),
        })),

      getProviders: () => {
        const state = get();
        const configs = state.providerConfigs;
        const builtinIds = new Set(DEFAULT_PROVIDERS.map((p) => p.id));
        const existingIds = new Set(configs.map((c) => c.id));
        const merged = [...configs];
        for (const dp of DEFAULT_PROVIDERS) {
          if (!existingIds.has(dp.id)) {
            merged.push({ ...dp, apiKey: "", isBuiltin: true });
          }
        }
        return merged.map((c) =>
          builtinIds.has(c.id) ? { ...c, isBuiltin: true } : c
        );
      },

      addProvider: (p) =>
        set((state) => {
          if (state.providerConfigs.some((c) => c.id === p.id)) return state;
          return {
            providerConfigs: [
              ...state.providerConfigs,
              { ...p, isBuiltin: false },
            ],
          };
        }),

      updateProvider: (id, patch) =>
        set((state) => ({
          providerConfigs: state.providerConfigs.map((c) =>
            c.id === id ? { ...c, ...patch } : c
          ),
        })),

      deleteProvider: (id) =>
        set((state) => {
          const target = state.providerConfigs.find((c) => c.id === id);
          if (target?.isBuiltin) return state;
          const filtered = state.providerConfigs.filter((c) => c.id !== id);
          const settingsUpdate: Partial<Settings> = {};
          if (state.settings.providerId === id && filtered.length > 0) {
            settingsUpdate.providerId = filtered[0].id;
            settingsUpdate.modelId = filtered[0].models[0]?.id || "";
          }
          return {
            providerConfigs: filtered,
            ...(Object.keys(settingsUpdate).length > 0
              ? { settings: { ...state.settings, ...settingsUpdate } }
              : {}),
          };
        }),

      deleteModel: (providerId, modelId) =>
        set((state) => {
          const provider = state.providerConfigs.find((c) => c.id === providerId);
          if (!provider || provider.models.length <= 1) return state;
          const newModels = provider.models.filter((m) => m.id !== modelId);
          const newConfigs = state.providerConfigs.map((c) =>
            c.id === providerId ? { ...c, models: newModels } : c
          );
          const settingsUpdate: Partial<Settings> = {};
          if (state.settings.providerId === providerId && state.settings.modelId === modelId) {
            settingsUpdate.modelId = newModels[0]?.id || "";
          }
          return {
            providerConfigs: newConfigs,
            ...(Object.keys(settingsUpdate).length > 0
              ? { settings: { ...state.settings, ...settingsUpdate } }
              : {}),
          };
        }),

      getActiveProviderConfig: () => {
        const state = get();
        return state.getProviders().find(
          (c) => c.id === state.settings.providerId
        );
      },
    }),
    { name: "xiniu-settings" }
  )
);
