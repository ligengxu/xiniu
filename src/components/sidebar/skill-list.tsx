"use client";

import { useState } from "react";
import { Wrench, Search, Store } from "lucide-react";
import Link from "next/link";
import { getIconComponent } from "@/components/skills/skill-card";

interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  source?: string;
}

interface SkillListProps {
  skills: SkillMeta[];
}

export function SkillList({ skills }: SkillListProps) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? skills.filter(
        (s) =>
          s.displayName.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  return (
    <div className="space-y-1">
      <h3
        className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider flex items-center justify-between"
        style={{ color: "var(--text-muted)" }}
      >
        <span>可用技能</span>
        <span
          className="px-1.5 py-0.5 rounded-md text-[9px] font-bold"
          style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}
        >
          {skills.length}
        </span>
      </h3>

      <div className="px-2 pb-1">
        <div className="relative">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索技能..."
            className="w-full pl-7 pr-3 py-1.5 rounded-lg border text-[11px] outline-none transition-colors"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface-elevated)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      </div>

      {filtered.map((skill) => {
        const Icon = getIconComponent(skill.icon);
        return (
          <div
            key={skill.name}
            className="group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors cursor-default hover:opacity-80"
            style={{ color: "var(--text-muted)" }}
            title={skill.description}
          >
            <Icon
              className="h-4 w-4 shrink-0 transition-colors"
              style={{ color: skill.source === "user" ? "#a78bfa" : "var(--accent)" }}
            />
            <span className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>
              {skill.displayName}
            </span>
            {skill.source === "user" && (
              <span className="ml-auto text-[8px] px-1 py-0.5 rounded" style={{ background: "color-mix(in srgb, #8b5cf6 15%, transparent)", color: "#a78bfa" }}>
                自定义
              </span>
            )}
          </div>
        );
      })}

      {filtered.length === 0 && (
        <p className="px-3 py-4 text-xs text-center" style={{ color: "var(--text-muted)" }}>
          未找到匹配的技能
        </p>
      )}

      <div className="px-2 pt-2">
        <Link
          href="/skills"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors hover:opacity-80 border"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          <Store className="h-3.5 w-3.5" />
          技能商店
        </Link>
      </div>
    </div>
  );
}
