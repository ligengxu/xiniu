"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft, Plus, Play, Pause, Trash2, RefreshCw,
  CheckCircle2, XCircle, Clock, Loader2, CalendarClock,
  ChevronDown, ChevronUp, SkipForward, AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { useAppStore } from "@/lib/store";
import { getThemeById, applyTheme } from "@/lib/themes";

interface TaskStep {
  skillName: string;
  skillParams: Record<string, unknown>;
  onFail?: string;
  retryCount?: number;
  outputAs?: string;
}

interface TaskCondition {
  type: string;
  value: string;
}

interface CronTask {
  id: string;
  name: string;
  description: string;
  schedule: string;
  steps: TaskStep[];
  conditions: TaskCondition[];
  enabled: boolean;
  maxRuns?: number;
  createdAt: string;
  lastRun?: string;
  lastStatus?: string;
  runCount: number;
  nextRun?: string;
  agentMode?: boolean;
}

interface HistoryEntry {
  id: string;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime: string;
  status: string;
  stepResults: { step: number; skill: string; success: boolean; message: string; duration: number }[];
  conditionsMet: boolean;
  skippedReason?: string;
  duration: number;
}

interface Stats {
  total: number;
  enabled: number;
  running: number;
  success: number;
  failure: number;
}

export default function SchedulerPage() {
  const { settings } = useAppStore();
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, enabled: 0, running: 0, success: 0, failure: 0 });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"tasks" | "history">("tasks");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    applyTheme(getThemeById(settings.theme || "space-black"));
  }, [settings.theme]);

  async function fetchData() {
    setLoading(true);
    try {
      const [tasksRes, histRes] = await Promise.all([
        fetch("/api/cron").then((r) => r.json()),
        fetch("/api/cron?action=history").then((r) => r.json()),
      ]);
      if (tasksRes.success) {
        setTasks(tasksRes.tasks || []);
        setStats(tasksRes.stats || stats);
      }
      if (histRes.success) setHistory((histRes.history || []).reverse());
    } catch { /* ignore */ }
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, []);

  async function handleToggle(taskId: string) {
    await fetch("/api/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", taskId }),
    });
    fetchData();
  }

  async function handleDelete(taskId: string) {
    if (!confirm("确定要删除此任务？")) return;
    await fetch("/api/cron", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", taskId }),
    });
    fetchData();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const statusIcon = (status?: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--success)" }} />;
      case "failure": return <XCircle className="h-3.5 w-3.5" style={{ color: "var(--error)" }} />;
      case "running": return <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--warning)" }} />;
      case "skipped": return <SkipForward className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />;
      default: return <Clock className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />;
    }
  };

  return (
    <div className="min-h-dvh" style={{ background: "var(--background)" }}>
      <header
        className="border-b backdrop-blur-xl sticky top-0 z-10"
        style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 80%, transparent)" }}
      >
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center gap-3 mb-4">
            <Link href="/" className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--text-muted)" }}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <CalendarClock className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <h1 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>定时任务管理</h1>
            <button onClick={fetchData} className="ml-auto p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--text-muted)" }}>
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* Stats */}
          <div className="flex gap-3 mb-4">
            {([
              ["总计", stats.total, "var(--text-primary)"],
              ["启用", stats.enabled, "var(--success)"],
              ["运行中", stats.running, "var(--warning)"],
              ["成功", stats.success, "var(--success)"],
              ["失败", stats.failure, "var(--error)"],
            ] as const).map(([label, count, color]) => (
              <div key={label} className="px-3 py-2 rounded-lg" style={{ background: "var(--surface-elevated)" }}>
                <div className="text-lg font-bold" style={{ color }}>{count}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div className="flex gap-1">
            {(["tasks", "history"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: tab === t ? "var(--accent)" : "transparent",
                  color: tab === t ? "white" : "var(--text-muted)",
                }}
              >
                {t === "tasks" ? "任务列表" : "执行历史"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--accent)" }} />
          </div>
        ) : tab === "tasks" ? (
          <div className="space-y-3">
            {tasks.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <CalendarClock className="h-12 w-12 mx-auto" style={{ color: "var(--text-muted)" }} />
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>暂无定时任务</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  在对话中告诉犀牛 Agent 创建定时任务，如："每5分钟搜索最新AI新闻并保存"
                </p>
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-xl border overflow-hidden"
                  style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 80%, transparent)" }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    {statusIcon(task.lastStatus)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{task.name}</span>
                        {task.agentMode && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-medium" style={{ background: "color-mix(in srgb, #8b5cf6 20%, transparent)", color: "#a78bfa" }}>
                            Agent
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {task.schedule} | {task.steps.length}步骤 | 已执行{task.runCount}次
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>{task.description}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button onClick={() => handleToggle(task.id)} className="p-1.5 rounded-md hover:opacity-80" title={task.enabled ? "暂停" : "恢复"}>
                        {task.enabled ? <Pause className="h-3.5 w-3.5" style={{ color: "var(--success)" }} /> : <Play className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />}
                      </button>
                      <button onClick={() => handleDelete(task.id)} className="p-1.5 rounded-md hover:opacity-80">
                        <Trash2 className="h-3.5 w-3.5" style={{ color: "var(--error)" }} />
                      </button>
                      <button onClick={() => toggleExpand(task.id)} className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--text-muted)" }}>
                        {expanded.has(task.id) ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {expanded.has(task.id) && (
                    <div className="px-4 pb-3 pt-1 border-t space-y-2" style={{ borderColor: "color-mix(in srgb, var(--border) 50%, transparent)" }}>
                      <div className="text-[10px] space-y-1" style={{ color: "var(--text-muted)" }}>
                        <p>ID: {task.id}</p>
                        <p>创建: {new Date(task.createdAt).toLocaleString("zh-CN")}</p>
                        {task.lastRun && <p>上次执行: {new Date(task.lastRun).toLocaleString("zh-CN")}</p>}
                        {task.nextRun && <p>下次执行: {new Date(task.nextRun).toLocaleString("zh-CN")}</p>}
                        {task.maxRuns ? <p>最大次数: {task.maxRuns} (已执行 {task.runCount})</p> : null}
                      </div>
                      <div className="text-[10px] font-medium mt-2" style={{ color: "var(--text-secondary)" }}>步骤:</div>
                      {task.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px] pl-2" style={{ color: "var(--text-muted)" }}>
                          <span className="w-4 text-center font-bold" style={{ color: "var(--accent)" }}>{i + 1}</span>
                          <span>{step.skillName}</span>
                          {step.onFail && <span className="px-1 rounded" style={{ background: "var(--surface-elevated)" }}>{step.onFail}</span>}
                        </div>
                      ))}
                      {task.conditions.length > 0 && (
                        <>
                          <div className="text-[10px] font-medium mt-2" style={{ color: "var(--text-secondary)" }}>条件:</div>
                          {task.conditions.map((c, i) => (
                            <div key={i} className="text-[11px] pl-2" style={{ color: "var(--text-muted)" }}>
                              {c.type}: {c.value}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {history.length === 0 ? (
              <p className="text-center py-12 text-sm" style={{ color: "var(--text-muted)" }}>暂无执行记录</p>
            ) : (
              history.slice(0, 100).map((h) => (
                <div
                  key={h.id}
                  className="rounded-lg border px-4 py-3"
                  style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--surface) 60%, transparent)" }}
                >
                  <div className="flex items-center gap-2">
                    {statusIcon(h.status)}
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{h.taskName}</span>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {new Date(h.startTime).toLocaleString("zh-CN")} | {h.duration}ms
                    </span>
                    {!h.conditionsMet && (
                      <span className="flex items-center gap-0.5 text-[9px]" style={{ color: "var(--warning)" }}>
                        <AlertTriangle className="h-2.5 w-2.5" /> {h.skippedReason}
                      </span>
                    )}
                    <button onClick={() => toggleExpand(h.id)} className="ml-auto p-1 hover:opacity-80" style={{ color: "var(--text-muted)" }}>
                      {expanded.has(h.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>
                  {expanded.has(h.id) && h.stepResults.length > 0 && (
                    <div className="mt-2 space-y-1 pl-4">
                      {h.stepResults.map((sr, i) => (
                        <div key={i} className="flex items-center gap-2 text-[11px]">
                          <span className={sr.success ? "" : ""} style={{ color: sr.success ? "var(--success)" : "var(--error)" }}>
                            {sr.success ? "✓" : "✗"}
                          </span>
                          <span style={{ color: "var(--text-secondary)" }}>{sr.skill}</span>
                          <span style={{ color: "var(--text-muted)" }}>({sr.duration}ms)</span>
                          <span className="text-[10px] truncate flex-1" style={{ color: "var(--text-muted)" }}>
                            {sr.message.substring(0, 100)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
