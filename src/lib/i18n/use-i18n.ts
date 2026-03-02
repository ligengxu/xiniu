"use client";

import { useSyncExternalStore, useCallback } from "react";
import { zh, en, type Locale, type Translations } from "./locales";

const STORAGE_KEY = "xiniu-locale";
const locales: Record<Locale, Translations> = { zh, en };

let currentLocale: Locale | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function detectLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && locales[stored]) return stored;
  const lang = navigator.language || "";
  if (lang.startsWith("zh")) return "zh";
  return "en";
}

export function getLocale(): Locale {
  if (currentLocale) return currentLocale;
  if (typeof window === "undefined") return "zh";
  currentLocale = detectLocale();
  return currentLocale;
}

export function setLocale(locale: Locale) {
  currentLocale = locale;
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Locale {
  return getLocale();
}

function getServerSnapshot(): Locale {
  return "zh";
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const t = locales[locale];

  const fmt = useCallback(
    (template: string, vars: Record<string, string | number>) => {
      let result = template;
      for (const [k, v] of Object.entries(vars)) {
        result = result.replace(`{${k}}`, String(v));
      }
      return result;
    },
    []
  );

  return { t, locale, setLocale, fmt };
}
