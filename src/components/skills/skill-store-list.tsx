"use client";

import { useState, useEffect } from "react";
import { Loader2, RefreshCw, PackageSearch } from "lucide-react";
import { SkillCard } from "./skill-card";

interface StoreItem {
  name: string;
  displayName: string;
  description: string;
  author: string;
  downloads: number;
  version: string;
  tags: string[];
  url: string;
  icon?: string;
  category?: string;
}

interface SkillStoreListProps {
  installedNames: string[];
  onInstall: (item: StoreItem) => Promise<void>;
}

export function SkillStoreList({ installedNames, onInstall }: SkillStoreListProps) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState<string | null>(null);

  async function fetchStore() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/skills/store");
      const data = await res.json();
      if (data.success) {
        setItems(data.skills || []);
      } else {
        setError(data.message || "加载失败");
      }
    } catch (err) {
      setError(`加载商店失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStore();
  }, []);

  async function handleInstall(item: StoreItem) {
    setInstalling(item.name);
    try {
      await onInstall(item);
    } finally {
      setInstalling(null);
    }
  }

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
        <button
          onClick={fetchStore}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs mx-auto transition-colors hover:opacity-80"
          style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
        >
          <RefreshCw className="h-3 w-3" /> 重试
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <PackageSearch className="h-10 w-10 mx-auto" style={{ color: "var(--text-muted)" }} />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>暂无远程技能</p>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          远程技能索引为空，可以在"创建"标签页自己编写技能
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          共 {items.length} 个技能
        </span>
        <button
          onClick={fetchStore}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <RefreshCw className="h-3 w-3" /> 刷新
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const isInstalled = installedNames.includes(item.name);
          return (
            <SkillCard
              key={item.name}
              name={item.name}
              displayName={item.displayName}
              description={item.description}
              icon={item.icon || "Wrench"}
              category={item.category || "life"}
              source="user"
              author={item.author}
              version={item.version}
              downloads={item.downloads}
              mode="store"
              onInstall={isInstalled ? undefined : () => handleInstall(item)}
            />
          );
        })}
      </div>
    </div>
  );
}
