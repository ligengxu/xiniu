"use client";

import { useState } from "react";
import { Bot, Settings, PanelLeftClose, Plus, CalendarClock, MessageSquare, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { SkillList } from "./skill-list";
import { useAppStore, type ChatSession } from "@/lib/store";

interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  icon: string;
}

interface SidebarProps {
  skills: SkillMeta[];
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + "分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "小时前";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "天前";
  return new Date(ts).toLocaleDateString("zh-CN");
}

export function Sidebar({ skills, open, onToggle, onNewChat, onSelectSession }: SidebarProps) {
  const { sessions, activeSessionId, deleteSession } = useAppStore();
  const [skillsExpanded, setSkillsExpanded] = useState(false);

  if (!open) return null;

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside
      className="w-full h-full flex flex-col border-r backdrop-blur-xl shrink-0"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--surface) 80%, transparent)",
      }}
    >
      <div
        className="flex items-center justify-between p-4 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #000))" }}
          >
            <Bot className="h-4 w-4 text-white" />
          </div>
          <div>
            <h1
              className="text-sm font-bold"
              style={{ color: "var(--text-primary)" }}
            >
              犀牛 Agent
            </h1>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              AI 智能助手
            </p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="p-1.5 rounded-md transition-colors hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all hover:opacity-80"
          style={{
            borderColor: "var(--border)",
            background: "var(--surface-elevated)",
            color: "var(--text-secondary)",
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          新对话
        </button>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto">
        {sortedSessions.length > 0 && (
          <div className="px-2 pb-2">
            <div className="px-2 py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                对话历史
              </span>
            </div>
            <div className="space-y-0.5">
              {sortedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === activeSessionId}
                  onSelect={() => onSelectSession(session.id)}
                  onDelete={() => deleteSession(session.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Skills (collapsible) */}
        <div className="px-2 pb-2">
          <button
            onClick={() => setSkillsExpanded(!skillsExpanded)}
            className="w-full flex items-center justify-between px-2 py-1 rounded-md hover:opacity-80 transition-opacity"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              技能列表 ({skills.length})
            </span>
            {skillsExpanded ? (
              <ChevronUp className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
            ) : (
              <ChevronDown className="h-3 w-3" style={{ color: "var(--text-muted)" }} />
            )}
          </button>
          {skillsExpanded && <SkillList skills={skills} />}
        </div>
      </div>

      <div className="border-t p-3 space-y-1" style={{ borderColor: "var(--border)" }}>
        <Link
          href="/scheduler"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <CalendarClock className="h-4 w-4" />
          定时任务
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <Settings className="h-4 w-4" />
          设置
        </Link>
      </div>
    </aside>
  );
}

function SessionItem({ session, isActive, onSelect, onDelete }: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all"
      style={{
        background: isActive ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
        borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
      }}
      onClick={onSelect}
    >
      <MessageSquare
        className="h-3.5 w-3.5 shrink-0"
        style={{ color: isActive ? "var(--accent)" : "var(--text-muted)" }}
      />
      <div className="flex-1 min-w-0">
        <p
          className="text-[11px] font-medium truncate"
          style={{ color: isActive ? "var(--text-primary)" : "var(--text-secondary)" }}
        >
          {session.title}
        </p>
        <p className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>
          {formatTime(session.updatedAt)}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-60 hover:opacity-100 p-1 rounded transition-opacity"
        style={{ color: "var(--error)" }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
