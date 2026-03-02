"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Package, Store, PenTool, Upload, Loader2 } from "lucide-react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { getThemeById, applyTheme } from "@/lib/themes";
import { SkillCard } from "@/components/skills/skill-card";
import { SkillEditor } from "@/components/skills/skill-editor";
import { SkillStoreList } from "@/components/skills/skill-store-list";
import { SkillSetupGuide } from "@/components/skills/skill-setup-guide";
import type { SkillConfig } from "@/skills/schema";
import { useI18n } from "@/lib/i18n";

interface SetupGuideData {
  framework: string;
  frameworkUrl: string;
  installCommands?: { label: string; cmd: string; mirror?: string }[];
  configSteps: string[];
  requiredCredentials?: { key: string; label: string; description: string; envVar?: string }[];
  healthCheckAction?: string;
  docsUrl?: string;
}

interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category: string;
  source: "builtin" | "user";
  enabled?: boolean;
  author?: string;
  version?: string;
  setupGuide?: SetupGuideData | null;
}

type TabId = "installed" | "store" | "create";

export default function SkillsPage() {
  const { settings } = useAppStore();
  const { t, fmt } = useI18n();
  const [tab, setTab] = useState<TabId>("installed");
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "builtin" | "user">("all");
  const [importing, setImporting] = useState(false);
  const [setupSkill, setSetupSkill] = useState<SkillMeta | null>(null);

  useEffect(() => {
    applyTheme(getThemeById(settings.theme || "space-black"));
  }, [settings.theme]);

  async function fetchSkills() {
    setLoading(true);
    try {
      const res = await fetch("/api/skills/manage");
      const data = await res.json();
      if (data.success) setSkills(data.skills);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSkills();
  }, []);

  async function handleToggle(name: string, currentEnabled: boolean) {
    const skill = skills.find((s) => s.name === name);
    if (!skill || skill.source !== "user") return;

    try {
      const getRes = await fetch(`/api/skills/manage`);
      const getData = await getRes.json();
      const allSkills: SkillMeta[] = getData.skills || [];
      const fullSkill = allSkills.find((s: SkillMeta) => s.name === name);
      if (!fullSkill) return;

      const userSkillRes = await fetch(`/api/skills/manage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fullSkill, enabled: !currentEnabled }),
      });
      if (userSkillRes.ok) {
        await fetchSkills();
      }
    } catch {
      // ignore
    }
  }

  async function handleDelete(name: string) {
    if (!confirm(fmt(t.skills.uninstallConfirm, { name }))) return;
    try {
      const res = await fetch(`/api/skills/manage?name=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (res.ok) await fetchSkills();
    } catch {
      // ignore
    }
  }

  async function handleExport(name: string) {
    const skill = skills.find((s) => s.name === name);
    if (!skill) return;

    try {
      const res = await fetch(`/api/skills/manage`);
      const data = await res.json();
      const allSkills = data.skills || [];
      const found = allSkills.find((s: SkillMeta) => s.name === name);
      if (!found) return;

      const blob = new Blob([JSON.stringify(found, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }

  async function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        const text = await file.text();
        const config = JSON.parse(text);
        const res = await fetch("/api/skills/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        const data = await res.json();
        if (data.success) {
          await fetchSkills();
          alert(t.common.success);
        } else {
          alert(`${t.common.error}: ${data.message || data.errors?.join(", ")}`);
        }
      } catch (err) {
        alert(`${t.common.error}: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  async function handleSaveSkill(config: SkillConfig) {
    const res = await fetch("/api/skills/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || data.errors?.join(", "));
    }
    await fetchSkills();
    setTab("installed");
  }

  async function handleInstallFromStore(item: { name: string; url: string }) {
    try {
      const res = await fetch(item.url);
      const config = await res.json();
      const saveRes = await fetch("/api/skills/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await saveRes.json();
      if (data.success) {
        await fetchSkills();
        alert(`"${item.name}" 安装成功！`);
      } else {
        alert(`安装失败: ${data.message || data.errors?.join(", ")}`);
      }
    } catch (err) {
      alert(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const filteredSkills = skills.filter((s) => {
    if (filter === "builtin") return s.source === "builtin";
    if (filter === "user") return s.source === "user";
    return true;
  });

  const builtinCount = skills.filter((s) => s.source === "builtin").length;
  const userCount = skills.filter((s) => s.source === "user").length;

  const TABS: { id: TabId; label: string; icon: typeof Package }[] = [
    { id: "installed", label: t.skills.installed, icon: Package },
    { id: "store", label: t.skills.store, icon: Store },
    { id: "create", label: t.skills.create, icon: PenTool },
  ];

  return (
    <div className="min-h-dvh" style={{ background: "var(--background)" }}>
      {/* Header */}
      <header
        className="border-b backdrop-blur-xl sticky top-0 z-10"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--surface) 80%, transparent)",
        }}
      >
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Link
              href="/"
              className="p-1.5 rounded-md transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <h1 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
              {t.skills.title}
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}>
              {fmt(t.skills.skillCount, { n: skills.length })}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition-colors hover:opacity-80 border"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                {t.common.import} JSON
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {TABS.map(({ id, label, icon: TabIcon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: tab === id ? "var(--accent)" : "transparent",
                  color: tab === id ? "white" : "var(--text-muted)",
                }}
              >
                <TabIcon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-6">
        {tab === "installed" && (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              {(["all", "builtin", "user"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="px-3 py-1 rounded-full text-[11px] transition-colors"
                  style={{
                    background: filter === f ? "var(--surface-elevated)" : "transparent",
                    color: filter === f ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  {f === "all" ? `${t.common.all} (${skills.length})` : f === "builtin" ? `${t.skills.builtIn} (${builtinCount})` : `${t.skills.custom} (${userCount})`}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--accent)" }} />
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSkills.map((skill) => (
                  <SkillCard
                    key={skill.name}
                    {...skill}
                    onToggle={skill.source === "user" ? () => handleToggle(skill.name, skill.enabled !== false) : undefined}
                    onDelete={skill.source === "user" ? () => handleDelete(skill.name) : undefined}
                    onExport={skill.source === "user" ? () => handleExport(skill.name) : undefined}
                    hasSetupGuide={!!skill.setupGuide}
                    onSetup={skill.setupGuide ? () => setSetupSkill(skill) : undefined}
                  />
                ))}
              </div>
            )}

            {!loading && filteredSkills.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {t.skills.noMatch}
                </p>
              </div>
            )}
          </div>
        )}

        {tab === "store" && (
          <SkillStoreList
            installedNames={skills.map((s) => s.name)}
            onInstall={handleInstallFromStore}
          />
        )}

        {tab === "create" && (
          <div className="max-w-2xl">
            <SkillEditor onSave={handleSaveSkill} />
          </div>
        )}
      </main>

      {setupSkill?.setupGuide && (
        <SkillSetupGuide
          skillName={setupSkill.name}
          displayName={setupSkill.displayName}
          guide={setupSkill.setupGuide}
          onClose={() => setSetupSkill(null)}
        />
      )}
    </div>
  );
}
