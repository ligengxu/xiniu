"use client";

import { useState, useEffect } from "react";
import {
  Loader2, RefreshCw, PackageSearch, Download, CheckCircle2,
  Trash2, Globe, Search, DownloadCloud,
} from "lucide-react";
import { getIconComponent } from "./skill-card";

interface CommunitySkill {
  name: string;
  dir: string;
  displayName: string;
  icon: string;
  category: string;
  deps: string[];
  description: string;
  installed: boolean;
}

interface SkillStoreListProps {
  installedNames: string[];
  onInstall: (item: { name: string; url: string }) => Promise<void>;
}

const CATEGORY_LABELS: Record<string, string> = {
  office: "办公", dev: "开发", life: "生活", creative: "创意",
};

export function SkillStoreList({ installedNames: _installedNames, onInstall: _onInstall }: SkillStoreListProps) {
  const [skills, setSkills] = useState<CommunitySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "installed" | "available">("all");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("global");
  const [batchInstalling, setBatchInstalling] = useState(false);

  async function fetchStore() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/skills/store");
      const data = await res.json();
      if (data.success) {
        setSkills(data.skills || []);
        setRegion(data.region || "global");
      } else {
        setError(data.message || "加载失败");
      }
    } catch (err) {
      setError(`加载商店失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStore(); }, []);

  async function handleInstall(skill: CommunitySkill) {
    setInstalling(skill.name);
    setInstallLog((prev) => ({ ...prev, [skill.name]: "正在下载技能源码..." }));
    try {
      const res = await fetch("/api/skills/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          skillDir: skill.dir,
          skillName: skill.displayName,
          deps: skill.deps,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const depMsg = skill.deps.length > 0
          ? `\n依赖 ${skill.deps.join(", ")} 已安装 (${data.mirror || "npm"})`
          : "";
        setInstallLog((prev) => ({ ...prev, [skill.name]: `✅ ${data.message}${depMsg}` }));
        setSkills((prev) => prev.map((s) => s.name === skill.name ? { ...s, installed: true } : s));
      } else {
        setInstallLog((prev) => ({ ...prev, [skill.name]: `❌ ${data.message}` }));
      }
    } catch (err) {
      setInstallLog((prev) => ({ ...prev, [skill.name]: `❌ ${err instanceof Error ? err.message : String(err)}` }));
    } finally {
      setInstalling(null);
    }
  }

  async function handleUninstall(skill: CommunitySkill) {
    if (!confirm(`确定要卸载「${skill.displayName}」吗？`)) return;
    setInstalling(skill.name);
    try {
      const res = await fetch("/api/skills/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uninstall", skillDir: skill.dir, skillName: skill.displayName }),
      });
      const data = await res.json();
      if (data.success) {
        setSkills((prev) => prev.map((s) => s.name === skill.name ? { ...s, installed: false } : s));
        setInstallLog((prev) => ({ ...prev, [skill.name]: "已卸载" }));
      }
    } finally {
      setInstalling(null);
    }
  }

  async function handleBatchInstall() {
    if (!confirm("将安装所有未安装的社区技能及其依赖，可能需要几分钟，确定继续？")) return;
    setBatchInstalling(true);
    try {
      const res = await fetch("/api/skills/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_all" }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        await fetchStore();
      }
    } catch (err) {
      alert(`批量安装失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchInstalling(false);
    }
  }

  const filtered = skills.filter((s) => {
    if (filter === "installed" && !s.installed) return false;
    if (filter === "available" && s.installed) return false;
    if (search) {
      const kw = search.toLowerCase();
      return s.displayName.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw) ||
        s.name.toLowerCase().includes(kw);
    }
    return true;
  });

  const installedCount = skills.filter((s) => s.installed).length;
  const availableCount = skills.length - installedCount;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>
        <button onClick={fetchStore}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs mx-auto"
          style={{ color: "var(--accent)" }}>
          <RefreshCw className="h-3 w-3" /> 重试
        </button>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <PackageSearch className="h-10 w-10 mx-auto" style={{ color: "var(--text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>技能清单为空</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-1 min-w-[180px] rounded-lg border px-3 py-1.5"
          style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能..." className="bg-transparent text-xs outline-none flex-1"
            style={{ color: "var(--text-primary)" }} />
        </div>
        <div className="flex items-center gap-1">
          {(["all", "installed", "available"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-2.5 py-1 rounded-full text-[10px]"
              style={{
                background: filter === f ? "var(--surface-elevated)" : "transparent",
                color: filter === f ? "var(--text-primary)" : "var(--text-muted)",
              }}>
              {f === "all" ? `全部 (${skills.length})` : f === "installed" ? `已装 (${installedCount})` : `可装 (${availableCount})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <Globe className="h-3 w-3" />
            {region === "china" ? "国内镜像" : "官方源"}
          </span>
          <button onClick={fetchStore} className="p-1 rounded hover:opacity-70" style={{ color: "var(--text-muted)" }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {availableCount > 0 && (
            <button onClick={handleBatchInstall} disabled={batchInstalling}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium"
              style={{ background: "var(--accent)", color: "white" }}>
              {batchInstalling ? <Loader2 className="h-3 w-3 animate-spin" /> : <DownloadCloud className="h-3 w-3" />}
              全部安装
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((skill) => {
          const Icon = getIconComponent(skill.icon);
          const isActive = installing === skill.name;
          const log = installLog[skill.name];
          return (
            <div key={skill.name} className="rounded-xl border p-4 transition-all hover:shadow-md"
              style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 80%, transparent)" }}>
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000))" }}>
                  <Icon className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {skill.displayName}
                    </h3>
                    {skill.installed && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--success, #22c55e)" }} />
                    )}
                  </div>
                  <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "var(--text-muted)" }}>
                    {skill.description}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[8px]"
                      style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}>
                      {CATEGORY_LABELS[skill.category] || skill.category}
                    </span>
                    {skill.deps.length > 0 && (
                      <span className="text-[8px]" style={{ color: "var(--text-muted)" }}>
                        依赖: {skill.deps.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {log && (
                <p className="text-[9px] mt-2 truncate" style={{
                  color: log.startsWith("✅") ? "var(--success, #22c55e)" : log.startsWith("❌") ? "var(--error, #ef4444)" : "var(--text-muted)",
                }}>{log}</p>
              )}
              <div className="flex items-center gap-1.5 mt-3 pt-2 border-t" style={{ borderColor: "color-mix(in srgb, var(--border) 50%, transparent)" }}>
                {skill.installed ? (
                  <button onClick={() => handleUninstall(skill)} disabled={isActive}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] hover:opacity-80"
                    style={{ color: "var(--error, #ef4444)", background: "color-mix(in srgb, var(--error, #ef4444) 10%, transparent)" }}>
                    <Trash2 className="h-3 w-3" /> 卸载
                  </button>
                ) : (
                  <button onClick={() => handleInstall(skill)} disabled={isActive || installing !== null}
                    className="flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-medium hover:opacity-80 ml-auto"
                    style={{ background: "var(--accent)", color: "white" }}>
                    {isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {isActive ? "安装中..." : "安装"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-8">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>无匹配技能</p>
        </div>
      )}
    </div>
  );
}
