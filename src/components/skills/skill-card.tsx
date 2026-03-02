"use client";

import {
  Wrench, Trash2, Power, PowerOff, Download, Share2,
  FolderPlus, FileText, ExternalLink, Globe, BookOpen,
  ImageDown, Search, Terminal, FileSpreadsheet,
  Presentation, FileDown, FileSearch, Files, Compass,
  ScanSearch, Languages, Calculator, Code, Sparkles,
  Zap, Brain, MessageSquare, Mail, Clock, Star,
  Monitor, MousePointer, Keyboard, Camera, ArrowDownUp,
  XCircle, CalendarClock, ListTodo, CalendarX,
  ClipboardCopy, Activity, Wifi, FolderSearch,
  Archive, Settings, GitCompare, Hash, Binary,
  Braces, Scan, Bell, BarChart3, Dice5, QrCode,
  ArrowLeftRight, FileCode,
  ShieldCheck, Shield, FlaskConical, ImagePlus, Film, Clapperboard,
} from "lucide-react";
import type { ComponentType } from "react";
import { useI18n } from "@/lib/i18n";

const ICON_MAP: Record<string, ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  Wrench, FolderPlus, FileText, ExternalLink, Globe, BookOpen,
  ImageDown, Download, Search, Terminal, FileSpreadsheet,
  Presentation, FileDown, FileSearch, Files, Compass,
  ScanSearch, Languages, Calculator, Code, Sparkles,
  Zap, Brain, MessageSquare, Mail, Clock, Star,
  Monitor, MousePointer, Keyboard, Camera, ArrowDownUp,
  XCircle, CalendarClock, ListTodo, CalendarX,
  ClipboardCopy, Activity, Wifi, FolderSearch,
  Archive, Settings, GitCompare, Hash, Binary,
  Braces, Scan, Bell, BarChart3, Dice5, QrCode,
  ArrowLeftRight, FileCode,
  ShieldCheck, Shield, FlaskConical, ImagePlus, Film, Clapperboard,
};

export function getIconComponent(iconName: string) {
  return ICON_MAP[iconName] || Wrench;
}

interface SkillCardProps {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  source: "builtin" | "user";
  enabled?: boolean;
  author?: string;
  version?: string;
  onToggle?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onInstall?: () => void;
  onSetup?: () => void;
  hasSetupGuide?: boolean;
  mode?: "installed" | "store";
  downloads?: number;
}

export function SkillCard({
  displayName, description, icon, category, source,
  enabled = true, author, version,
  onToggle, onDelete, onExport, onInstall, onSetup, hasSetupGuide,
  mode = "installed", downloads,
}: SkillCardProps) {
  const { t } = useI18n();
  const CATEGORY_LABELS: Record<string, string> = {
    office: t.skills.categories.office,
    dev: t.skills.categories.dev,
    life: t.skills.categories.life,
    creative: t.skills.categories.creative,
  };
  const Icon = getIconComponent(icon);

  return (
    <div
      className="rounded-xl border p-4 transition-all hover:shadow-md"
      style={{
        borderColor: enabled ? "var(--border)" : "color-mix(in srgb, var(--border) 50%, transparent)",
        background: enabled
          ? "color-mix(in srgb, var(--surface) 80%, transparent)"
          : "color-mix(in srgb, var(--surface) 40%, transparent)",
        opacity: enabled ? 1 : 0.6,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: source === "builtin"
              ? "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000))"
              : "linear-gradient(135deg, #8b5cf6, #6d28d9)",
          }}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {displayName}
            </h3>
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0"
              style={{
                background: source === "builtin"
                  ? "color-mix(in srgb, var(--accent) 20%, transparent)"
                  : "color-mix(in srgb, #8b5cf6 20%, transparent)",
                color: source === "builtin" ? "var(--accent)" : "#a78bfa",
              }}
            >
              {source === "builtin" ? t.skills.builtIn : t.skills.custom}
            </span>
            {version && (
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                v{version}
              </span>
            )}
          </div>

          <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>

          <div className="flex items-center gap-2 mt-2">
            <span
              className="px-1.5 py-0.5 rounded text-[9px]"
              style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}
            >
              {CATEGORY_LABELS[category] || category}
            </span>
            {author && author !== "user" && (
              <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                by {author}
              </span>
            )}
            {downloads !== undefined && (
              <span className="text-[9px] flex items-center gap-0.5" style={{ color: "var(--text-muted)" }}>
                <Download className="h-2.5 w-2.5" /> {downloads}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 mt-3 pt-3 border-t" style={{ borderColor: "color-mix(in srgb, var(--border) 50%, transparent)" }}>
        {mode === "installed" && (
          <>
            {source === "user" && onToggle && (
              <button
                onClick={onToggle}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors hover:opacity-80"
                style={{
                  background: enabled
                    ? "color-mix(in srgb, var(--success) 15%, transparent)"
                    : "color-mix(in srgb, var(--text-muted) 15%, transparent)",
                  color: enabled ? "var(--success)" : "var(--text-muted)",
                }}
              >
                {enabled ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                {enabled ? t.common.enabled : t.common.disabled}
              </button>
            )}
            {source === "user" && onDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors hover:opacity-80"
                style={{ color: "var(--error)", background: "color-mix(in srgb, var(--error) 10%, transparent)" }}
              >
                <Trash2 className="h-3 w-3" /> {t.common.delete}
              </button>
            )}
            {hasSetupGuide && onSetup && (
              <button
                onClick={onSetup}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors hover:opacity-80"
                style={{ color: "#f59e0b", background: "color-mix(in srgb, #f59e0b 12%, transparent)" }}
              >
                <Settings className="h-3 w-3" /> {t.setup.title}
              </button>
            )}
            {onExport && (
              <button
                onClick={onExport}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors hover:opacity-80 ml-auto"
                style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
              >
                <Share2 className="h-3 w-3" /> {t.common.export}
              </button>
            )}
          </>
        )}
        {mode === "store" && onInstall && (
          <button
            onClick={onInstall}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-[10px] font-medium transition-colors hover:opacity-80 ml-auto"
            style={{ background: "var(--accent)", color: "white" }}
          >
            <Download className="h-3 w-3" /> {t.common.install}
          </button>
        )}
      </div>
    </div>
  );
}
