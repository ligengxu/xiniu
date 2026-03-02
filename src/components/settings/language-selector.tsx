"use client";

import { useI18n, type Locale } from "@/lib/i18n";
import { Globe } from "lucide-react";

const LANGUAGES: { id: Locale; label: string; flag: string }[] = [
  { id: "zh", label: "中文", flag: "🇨🇳" },
  { id: "en", label: "English", flag: "🇺🇸" },
];

export function LanguageSelector() {
  const { t, locale, setLocale } = useI18n();

  return (
    <div>
      <h3
        className="text-sm font-medium mb-3 flex items-center gap-2"
        style={{ color: "var(--text-primary)" }}
      >
        <Globe className="h-4 w-4" />
        {t.settings.language}
      </h3>
      <p className="text-[10px] mb-3" style={{ color: "var(--text-muted)" }}>
        {t.settings.languageTip}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {LANGUAGES.map((lang) => {
          const isActive = locale === lang.id;
          return (
            <button
              key={lang.id}
              onClick={() => setLocale(lang.id)}
              className="rounded-xl border px-4 py-3 text-sm transition-all flex items-center gap-3"
              style={{
                borderColor: isActive
                  ? "color-mix(in srgb, var(--accent) 50%, transparent)"
                  : "var(--border)",
                background: isActive
                  ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                  : "var(--surface-elevated)",
                color: isActive ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <span className="text-lg">{lang.flag}</span>
              <span className="font-medium">{lang.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
