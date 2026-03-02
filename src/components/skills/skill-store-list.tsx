"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Loader2, RefreshCw, PackageSearch, Download, CheckCircle2,
  Trash2, Globe, Search, DownloadCloud, Package,
  Briefcase, Code2, Sparkles, Coffee,
  ChevronDown, ChevronRight,
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

const CATEGORIES = [
  {
    key: "dev",
    label: "开发工具",
    icon: Code2,
    gradient: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
    color: "#3b82f6",
    desc: "编译、调试、部署、逆向、数据库、网络工具",
  },
  {
    key: "creative",
    label: "创意设计",
    icon: Sparkles,
    gradient: "linear-gradient(135deg, #f59e0b, #d97706)",
    color: "#f59e0b",
    desc: "图像生成、视频编辑、OCR、截图、SVG",
  },
  {
    key: "office",
    label: "办公效率",
    icon: Briefcase,
    gradient: "linear-gradient(135deg, #10b981, #059669)",
    color: "#10b981",
    desc: "邮件、翻译、PDF、表格、剪贴板、密码",
  },
  {
    key: "life",
    label: "生活服务",
    icon: Coffee,
    gradient: "linear-gradient(135deg, #ec4899, #db2777)",
    color: "#ec4899",
    desc: "天气、汇率、股票、RSS、机器人",
  },
] as const;

type ViewMode = "grid" | "category";
type FilterMode = "all" | "installed" | "available";

export function SkillStoreList({ installedNames: _installedNames, onInstall: _onInstall }: SkillStoreListProps) {
  const [skills, setSkills] = useState<CommunitySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installLog, setInstallLog] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterMode>("all");
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("global");
  const [batchInstalling, setBatchInstalling] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("category");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

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
    setInstallLog((prev) => ({ ...prev, [skill.name]: "downloading" }));
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
          ? ` | 依赖已装 (${data.mirror || "npm"})`
          : "";
        setInstallLog((prev) => ({ ...prev, [skill.name]: `ok:${data.message}${depMsg}` }));
        setSkills((prev) => prev.map((s) => s.name === skill.name ? { ...s, installed: true } : s));
      } else {
        setInstallLog((prev) => ({ ...prev, [skill.name]: `err:${data.message}` }));
      }
    } catch (err) {
      setInstallLog((prev) => ({ ...prev, [skill.name]: `err:${err instanceof Error ? err.message : String(err)}` }));
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
        setInstallLog((prev) => ({ ...prev, [skill.name]: "" }));
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
        await fetchStore();
      }
    } catch (err) {
      alert(`批量安装失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBatchInstalling(false);
    }
  }

  const filtered = useMemo(() => {
    let list = skills;
    if (filter === "installed") list = list.filter((s) => s.installed);
    if (filter === "available") list = list.filter((s) => !s.installed);
    if (activeCategory) list = list.filter((s) => s.category === activeCategory);
    if (search) {
      const kw = search.toLowerCase();
      list = list.filter((s) =>
        s.displayName.toLowerCase().includes(kw) ||
        s.description.toLowerCase().includes(kw) ||
        s.name.toLowerCase().includes(kw)
      );
    }
    return list;
  }, [skills, filter, search, activeCategory]);

  const grouped = useMemo(() => {
    const map: Record<string, CommunitySkill[]> = {};
    for (const s of filtered) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    return map;
  }, [filtered]);

  const stats = useMemo(() => {
    const total = skills.length;
    const inst = skills.filter((s) => s.installed).length;
    const byCat: Record<string, { total: number; installed: number }> = {};
    for (const s of skills) {
      if (!byCat[s.category]) byCat[s.category] = { total: 0, installed: 0 };
      byCat[s.category].total++;
      if (s.installed) byCat[s.category].installed++;
    }
    return { total, installed: inst, available: total - inst, byCat };
  }, [skills]);

  const toggleCollapse = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--accent)" }} />
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>加载技能商店...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 space-y-3">
        <PackageSearch className="h-10 w-10 mx-auto" style={{ color: "var(--error, #ef4444)" }} />
        <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>
        <button onClick={fetchStore}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs mx-auto"
          style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
          <RefreshCw className="h-3.5 w-3.5" /> 重试
        </button>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-16 space-y-2">
        <PackageSearch className="h-12 w-12 mx-auto" style={{ color: "var(--text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>技能商店为空</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── 概览统计 ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map((cat) => {
          const catStats = stats.byCat[cat.key] || { total: 0, installed: 0 };
          const CatIcon = cat.icon;
          const isActive = activeCategory === cat.key;
          return (
            <button key={cat.key} onClick={() => setActiveCategory(isActive ? null : cat.key)}
              className="rounded-xl p-3.5 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: isActive
                  ? cat.gradient
                  : "color-mix(in srgb, var(--surface-elevated) 90%, transparent)",
                border: isActive ? "none" : "1px solid var(--border)",
                boxShadow: isActive ? `0 4px 20px ${cat.color}30` : "none",
              }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                  style={{
                    background: isActive ? "rgba(255,255,255,0.2)" : `${cat.color}18`,
                  }}>
                  <CatIcon className="h-3.5 w-3.5" style={{ color: isActive ? "white" : cat.color }} />
                </div>
                <span className="text-xs font-semibold"
                  style={{ color: isActive ? "white" : "var(--text-primary)" }}>
                  {cat.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-lg font-bold" style={{ color: isActive ? "white" : cat.color }}>
                  {catStats.total}
                </span>
                <span className="text-[10px]" style={{ color: isActive ? "rgba(255,255,255,0.7)" : "var(--text-muted)" }}>
                  个技能 · 已装 {catStats.installed}
                </span>
              </div>
              <p className="text-[9px] mt-1 line-clamp-1"
                style={{ color: isActive ? "rgba(255,255,255,0.6)" : "var(--text-muted)" }}>
                {cat.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── 工具栏 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* 搜索 */}
        <div className="flex items-center gap-1.5 flex-1 min-w-[200px] rounded-lg border px-3 py-2"
          style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能名称、功能描述..."
            className="bg-transparent text-xs outline-none flex-1"
            style={{ color: "var(--text-primary)" }} />
          {search && (
            <button onClick={() => setSearch("")} className="text-[10px] px-1 rounded"
              style={{ color: "var(--text-muted)" }}>
              清除
            </button>
          )}
        </div>

        {/* 筛选 */}
        <div className="flex items-center rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border)" }}>
          {([
            { key: "all" as FilterMode, label: "全部", count: stats.total },
            { key: "installed" as FilterMode, label: "已安装", count: stats.installed },
            { key: "available" as FilterMode, label: "未安装", count: stats.available },
          ]).map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1.5 text-[10px] transition-colors"
              style={{
                background: filter === f.key ? "var(--accent)" : "var(--surface-elevated)",
                color: filter === f.key ? "white" : "var(--text-muted)",
              }}>
              {f.label} ({f.count})
            </button>
          ))}
        </div>

        {/* 视图切换 */}
        <div className="flex items-center rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border)" }}>
          {([
            { key: "category" as ViewMode, label: "分类" },
            { key: "grid" as ViewMode, label: "网格" },
          ]).map((v) => (
            <button key={v.key} onClick={() => setViewMode(v.key)}
              className="px-2.5 py-1.5 text-[10px] transition-colors"
              style={{
                background: viewMode === v.key ? "var(--accent)" : "var(--surface-elevated)",
                color: viewMode === v.key ? "white" : "var(--text-muted)",
              }}>
              {v.label}
            </button>
          ))}
        </div>

        {/* 右侧工具 */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-full"
            style={{ color: "var(--text-muted)", background: "var(--surface-elevated)" }}>
            <Globe className="h-3 w-3" />
            {region === "china" ? "国内镜像" : "官方源"}
          </span>
          <button onClick={fetchStore} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
            style={{ color: "var(--text-muted)", background: "var(--surface-elevated)" }}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {stats.available > 0 && (
            <button onClick={handleBatchInstall} disabled={batchInstalling}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all hover:shadow-lg active:scale-95"
              style={{ background: "var(--accent)", color: "white" }}>
              {batchInstalling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              全部安装
            </button>
          )}
        </div>
      </div>

      {/* ── 内容区 ── */}
      {viewMode === "category" ? (
        <div className="space-y-5">
          {CATEGORIES.filter((cat) => grouped[cat.key]?.length).map((cat) => {
            const catSkills = grouped[cat.key] || [];
            const CatIcon = cat.icon;
            const isCollapsed = collapsed[cat.key];
            const catInstalled = catSkills.filter((s) => s.installed).length;

            return (
              <div key={cat.key}>
                {/* 分类标题 */}
                <button onClick={() => toggleCollapse(cat.key)}
                  className="flex items-center gap-2.5 w-full mb-3 group">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: cat.gradient }}>
                    <CatIcon className="h-4 w-4 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{cat.label}</h2>
                      <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: `${cat.color}15`, color: cat.color }}>
                        {catSkills.length} 个
                      </span>
                      {catInstalled > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full"
                          style={{ background: "color-mix(in srgb, var(--success, #22c55e) 15%, transparent)", color: "var(--success, #22c55e)" }}>
                          已装 {catInstalled}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{cat.desc}</p>
                  </div>
                  {isCollapsed
                    ? <ChevronRight className="h-4 w-4 transition-transform" style={{ color: "var(--text-muted)" }} />
                    : <ChevronDown className="h-4 w-4 transition-transform" style={{ color: "var(--text-muted)" }} />
                  }
                </button>

                {!isCollapsed && (
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {catSkills.map((skill) => (
                      <SkillStoreCard
                        key={skill.name}
                        skill={skill}
                        catColor={cat.color}
                        catGradient={cat.gradient}
                        installing={installing}
                        installLog={installLog}
                        onInstall={handleInstall}
                        onUninstall={handleUninstall}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((skill) => {
            const cat = CATEGORIES.find((c) => c.key === skill.category) || CATEGORIES[0];
            return (
              <SkillStoreCard
                key={skill.name}
                skill={skill}
                catColor={cat.color}
                catGradient={cat.gradient}
                installing={installing}
                installLog={installLog}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
              />
            );
          })}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <Search className="h-8 w-8 mx-auto" style={{ color: "var(--text-muted)" }} />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {search ? `未找到与「${search}」匹配的技能` : "当前筛选下无技能"}
          </p>
          {(search || activeCategory) && (
            <button onClick={() => { setSearch(""); setActiveCategory(null); setFilter("all"); }}
              className="text-[10px] px-3 py-1 rounded-lg mx-auto"
              style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}>
              清除所有筛选
            </button>
          )}
        </div>
      )}

      {/* ── 底部统计 ── */}
      <div className="flex items-center justify-center gap-4 pt-2 pb-1">
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          <Package className="h-3 w-3" /> 共 {stats.total} 个社区技能
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--success, #22c55e)" }}>
          <CheckCircle2 className="h-3 w-3" /> 已安装 {stats.installed}
        </span>
        <span className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          <Download className="h-3 w-3" /> 可安装 {stats.available}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════ 单个技能卡片 ═══════════════════ */

function SkillStoreCard({
  skill, catColor, catGradient, installing, installLog, onInstall, onUninstall,
}: {
  skill: CommunitySkill;
  catColor: string;
  catGradient: string;
  installing: string | null;
  installLog: Record<string, string>;
  onInstall: (s: CommunitySkill) => void;
  onUninstall: (s: CommunitySkill) => void;
}) {
  const Icon = getIconComponent(skill.icon);
  const isActive = installing === skill.name;
  const log = installLog[skill.name] || "";

  const logStatus = log.startsWith("ok:") ? "ok" : log.startsWith("err:") ? "err" : log === "downloading" ? "loading" : "";
  const logText = log.replace(/^(ok:|err:)/, "");

  return (
    <div className="rounded-xl border p-3.5 transition-all hover:shadow-lg hover:-translate-y-0.5 group relative overflow-hidden"
      style={{
        borderColor: skill.installed ? `${catColor}40` : "var(--border)",
        background: "color-mix(in srgb, var(--surface) 90%, transparent)",
      }}>
      {/* 顶部彩条 */}
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: catGradient, opacity: skill.installed ? 1 : 0.3 }} />

      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110"
          style={{ background: catGradient }}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[11px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {skill.displayName}
            </h3>
            {skill.installed && (
              <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: "var(--success, #22c55e)" }} />
            )}
          </div>
          <p className="text-[10px] mt-0.5 line-clamp-2 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {skill.description}
          </p>
        </div>
      </div>

      {/* 依赖标签 */}
      {skill.deps.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {skill.deps.map((dep) => (
            <span key={dep} className="px-1.5 py-0.5 rounded text-[8px] font-mono"
              style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}>
              {dep}
            </span>
          ))}
        </div>
      )}

      {/* 日志 */}
      {logStatus && (
        <div className="flex items-center gap-1 mt-2">
          {logStatus === "loading" && <Loader2 className="h-2.5 w-2.5 animate-spin" style={{ color: "var(--accent)" }} />}
          {logStatus === "ok" && <CheckCircle2 className="h-2.5 w-2.5" style={{ color: "var(--success, #22c55e)" }} />}
          <p className="text-[9px] truncate" style={{
            color: logStatus === "ok" ? "var(--success, #22c55e)" : logStatus === "err" ? "var(--error, #ef4444)" : "var(--text-muted)",
          }}>
            {logStatus === "loading" ? "正在下载并安装..." : logText}
          </p>
        </div>
      )}

      {/* 操作 */}
      <div className="flex items-center gap-1.5 mt-2.5 pt-2 border-t"
        style={{ borderColor: "color-mix(in srgb, var(--border) 40%, transparent)" }}>
        {skill.installed ? (
          <>
            <span className="text-[9px] flex-1" style={{ color: "var(--success, #22c55e)" }}>已安装</span>
            <button onClick={() => onUninstall(skill)} disabled={isActive}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] transition-all hover:opacity-80"
              style={{ color: "var(--error, #ef4444)", background: "color-mix(in srgb, var(--error, #ef4444) 8%, transparent)" }}>
              <Trash2 className="h-3 w-3" /> 卸载
            </button>
          </>
        ) : (
          <button onClick={() => onInstall(skill)} disabled={isActive || installing !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium ml-auto transition-all hover:shadow-md active:scale-95"
            style={{ background: catGradient, color: "white" }}>
            {isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {isActive ? "安装中" : "安装"}
          </button>
        )}
      </div>
    </div>
  );
}
