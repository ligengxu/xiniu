"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  MessageSquare,
  Settings,
  Palette,
  Cpu,
  FolderPlus,
  FileText,
  Globe,
  BookOpen,
  ImageDown,
  Download,
  ExternalLink,
} from "lucide-react";
import { searchCommands, recordCommandUsage, registerCommands, type Command } from "@/lib/commands";

interface CommandPaletteProps {
  onNewChat: () => void;
  onOpenSettings: () => void;
  onChangeTheme: () => void;
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  MessageSquare,
  Settings,
  Palette,
  Cpu,
  FolderPlus,
  FileText,
  Globe,
  BookOpen,
  ImageDown,
  Download,
  ExternalLink,
  Search,
};

export function CommandPalette({ onNewChat, onOpenSettings, onChangeTheme }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerCommands([
      { id: "new-chat", name: "新建对话", description: "开始一个新的对话", icon: "MessageSquare", category: "action", action: onNewChat, keywords: ["新对话", "new", "chat"] },
      { id: "settings", name: "打开设置", description: "进入设置页面", icon: "Settings", category: "navigation", action: onOpenSettings, keywords: ["设置", "settings", "配置"] },
      { id: "theme", name: "切换主题", description: "更换界面主题外观", icon: "Palette", category: "setting", action: onChangeTheme, keywords: ["主题", "theme", "外观", "颜色"] },
      { id: "model", name: "切换模型", description: "更换 AI 模型", icon: "Cpu", category: "setting", action: onOpenSettings, keywords: ["模型", "model", "AI"] },
      { id: "sk-folder", name: "创建文件夹", description: "在指定路径创建新文件夹", icon: "FolderPlus", category: "skill", action: () => {}, keywords: ["文件夹", "目录"] },
      { id: "sk-txt", name: "创建文本文件", description: "创建 TXT 文本文件", icon: "FileText", category: "skill", action: () => {}, keywords: ["文本", "txt", "笔记"] },
      { id: "sk-browse", name: "浏览网页", description: "抓取并提取网页内容", icon: "Globe", category: "skill", action: () => {}, keywords: ["网页", "浏览", "抓取"] },
      { id: "sk-summarize", name: "总结网页", description: "AI 总结网页核心内容", icon: "BookOpen", category: "skill", action: () => {}, keywords: ["总结", "摘要", "概括"] },
      { id: "sk-img", name: "下载网页图片", description: "下载网页上的所有图片", icon: "ImageDown", category: "skill", action: () => {}, keywords: ["图片", "下载", "image"] },
      { id: "sk-file", name: "下载文件", description: "从 URL 下载文件到本地", icon: "Download", category: "skill", action: () => {}, keywords: ["下载", "文件", "download"] },
      { id: "sk-open", name: "打开网页", description: "在浏览器中打开网页", icon: "ExternalLink", category: "skill", action: () => {}, keywords: ["打开", "网页", "open"] },
    ]);
  }, [onNewChat, onOpenSettings, onChangeTheme]);

  const results = searchCommands(query);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      setOpen((prev) => {
        if (!prev) {
          setQuery("");
          setSelectedIndex(0);
        }
        return !prev;
      });
    }
    if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }, [open]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const executeCommand = (cmd: Command) => {
    recordCommandUsage(cmd.id);
    setOpen(false);
    cmd.action();
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      executeCommand(results[selectedIndex]);
    }
  };

  if (!open) return null;

  const categoryLabels: Record<string, string> = {
    action: "操作",
    navigation: "导航",
    setting: "设置",
    skill: "技能",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        className="relative w-full max-w-lg rounded-2xl border overflow-hidden shadow-2xl"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleListKeyDown}
            placeholder="输入命令或搜索..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-50"
            style={{ color: "var(--text-primary)" }}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center rounded border px-1.5 text-[10px] font-mono" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[300px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              未找到匹配的命令
            </div>
          ) : (
            results.map((cmd, i) => {
              const Icon = ICON_MAP[cmd.icon] || Search;
              const isSelected = i === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  onClick={() => executeCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                  style={{
                    background: isSelected ? "var(--surface-elevated)" : "transparent",
                    color: "var(--text-primary)",
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{cmd.name}</div>
                    <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{cmd.description}</div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md shrink-0" style={{ background: "var(--surface-elevated)", color: "var(--text-muted)" }}>
                    {categoryLabels[cmd.category]}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t text-[10px]" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          <span>↑↓ 导航 · Enter 执行 · Esc 关闭</span>
          <span>Ctrl+K 唤起</span>
        </div>
      </div>
    </div>
  );
}
