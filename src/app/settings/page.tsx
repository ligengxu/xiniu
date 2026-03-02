"use client";

import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ModelConfig } from "@/components/settings/model-config";
import { ThemeSelector } from "@/components/settings/theme-selector";
import { DialectSelector } from "@/components/settings/dialect-selector";
import { LanguageSelector } from "@/components/settings/language-selector";
import { useAppStore } from "@/lib/store";
import { getThemeById, applyTheme } from "@/lib/themes";
import { useI18n } from "@/lib/i18n";

export default function SettingsPage() {
  const { settings } = useAppStore();
  const { t } = useI18n();

  useEffect(() => {
    applyTheme(getThemeById(settings.theme || "space-black"));
  }, [settings.theme]);

  return (
    <div className="min-h-dvh" style={{ background: "var(--background)" }}>
      <header
        className="border-b backdrop-blur-xl"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--surface) 60%, transparent)",
        }}
      >
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-6 py-4">
          <Link
            href="/"
            className="p-1.5 rounded-md transition-colors hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1
            className="text-sm font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t.settings.title}
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-8 space-y-8">
        <LanguageSelector />
        <div className="border-t" style={{ borderColor: "var(--border)" }} />
        <ThemeSelector />
        <div className="border-t" style={{ borderColor: "var(--border)" }} />
        <DialectSelector />
        <div className="border-t" style={{ borderColor: "var(--border)" }} />
        <ModelConfig />
      </main>
    </div>
  );
}
