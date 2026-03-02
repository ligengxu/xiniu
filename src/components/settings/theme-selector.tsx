"use client";

import { useEffect } from "react";
import { Check } from "lucide-react";
import { THEMES, getThemeById, applyTheme } from "@/lib/themes";
import { useAppStore } from "@/lib/store";
import { useI18n } from "@/lib/i18n";

export function ThemeSelector() {
  const { settings, setSettings } = useAppStore();
  const { t } = useI18n();
  const currentThemeId = settings.theme || "space-black";

  useEffect(() => {
    applyTheme(getThemeById(currentThemeId));
  }, [currentThemeId]);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {t.settings.themeAppearance}
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map((theme) => {
          const isActive = currentThemeId === theme.id;
          const c = theme.colors;
          return (
            <button
              key={theme.id}
              onClick={() => setSettings({ theme: theme.id })}
              className="relative rounded-xl border-2 p-0.5 transition-all duration-200 hover:scale-[1.02]"
              style={{
                borderColor: isActive ? c.accent : c.border,
                background: c.background,
              }}
            >
              <div className="rounded-lg overflow-hidden" style={{ background: c.background }}>
                <div className="h-5 flex items-center px-2 gap-1" style={{ background: c.surface }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.error }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.warning }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.success }} />
                </div>
                <div className="flex h-16">
                  <div className="w-8 border-r" style={{ background: c.surface, borderColor: c.border }}>
                    <div className="mt-2 mx-1 h-1.5 rounded" style={{ background: c.accent + "40" }} />
                    <div className="mt-1 mx-1 h-1 rounded" style={{ background: c.border }} />
                    <div className="mt-1 mx-1 h-1 rounded" style={{ background: c.border }} />
                  </div>
                  <div className="flex-1 p-2 space-y-1.5">
                    <div className="flex justify-end">
                      <div className="h-3 w-12 rounded-full" style={{ background: c.userBubble }} />
                    </div>
                    <div className="flex">
                      <div className="h-4 w-16 rounded-lg" style={{ background: c.aiBubble, border: `1px solid ${c.aiBubbleBorder}` }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-center gap-1 py-1.5">
                <span className="text-[11px] font-medium" style={{ color: isActive ? c.accent : c.textSecondary }}>
                  {theme.name}
                </span>
                {isActive && (
                  <Check className="h-3 w-3" style={{ color: c.accent }} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
