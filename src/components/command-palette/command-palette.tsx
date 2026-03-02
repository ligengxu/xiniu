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
import { useI18n } from "@/lib/i18n";

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
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isEn = locale === "en";
    registerCommands([
      { id: "new-chat", name: t.commands.newChat, description: isEn ? "Start a new conversation" : "开始一个新的对话", icon: "MessageSquare", category: "action", action: onNewChat, keywords: ["新对话", "new", "chat"] },
      { id: "settings", name: t.commands.settings, description: isEn ? "Open settings page" : "进入设置页面", icon: "Settings", category: "navigation", action: onOpenSettings, keywords: ["设置", "settings"] },
      { id: "theme", name: t.commands.theme, description: isEn ? "Change theme" : "更换界面主题外观", icon: "Palette", category: "setting", action: onChangeTheme, keywords: ["theme", "主题"] },
      { id: "model", name: isEn ? "Switch Model" : "切换模型", description: isEn ? "Change AI model" : "更换 AI 模型", icon: "Cpu", category: "setting", action: onOpenSettings, keywords: ["model", "模型"] },
      { id: "sk-folder", name: t.commands.createFolder, description: isEn ? "Create a new folder" : "创建新文件夹", icon: "FolderPlus", category: "skill", action: () => {}, keywords: ["folder", "文件夹"] },
      { id: "sk-txt", name: t.commands.createTxt, description: isEn ? "Create a text file" : "创建 TXT 文本文件", icon: "FileText", category: "skill", action: () => {}, keywords: ["text", "txt"] },
      { id: "sk-browse", name: t.commands.openWebpage, description: isEn ? "Fetch & extract webpage content" : "抓取并提取网页内容", icon: "Globe", category: "skill", action: () => {}, keywords: ["browse", "网页"] },
      { id: "sk-summarize", name: isEn ? "Summarize Page" : "总结网页", description: isEn ? "AI summarize webpage" : "AI 总结网页核心内容", icon: "BookOpen", category: "skill", action: () => {}, keywords: ["summarize", "总结"] },
      { id: "sk-img", name: isEn ? "Download Images" : "下载网页图片", description: isEn ? "Download all images from a webpage" : "下载网页图片", icon: "ImageDown", category: "skill", action: () => {}, keywords: ["image", "图片"] },
      { id: "sk-file", name: isEn ? "Download File" : "下载文件", description: isEn ? "Download file from URL" : "从 URL 下载文件", icon: "Download", category: "skill", action: () => {}, keywords: ["download", "下载"] },
      { id: "sk-open", name: t.commands.openWebpage, description: isEn ? "Open in browser" : "在浏览器中打开网页", icon: "ExternalLink", category: "skill", action: () => {}, keywords: ["open", "打开"] },
    ]);
  }, [onNewChat, onOpenSettings, onChangeTheme, locale, t]);

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

  const isEn = locale === "en";
  const categoryLabels: Record<string, string> = {
    action: isEn ? "Action" : "操作",
    navigation: isEn ? "Nav" : "导航",
    setting: isEn ? "Setting" : "设置",
    skill: isEn ? "Skill" : "技能",
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
            placeholder={t.commands.placeholder}
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
              {isEn ? "No matching commands" : "未找到匹配的命令"}
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
          <span>{isEn ? "↑↓ Navigate · Enter Execute · Esc Close" : "↑↓ 导航 · Enter 执行 · Esc 关闭"}</span>
          <span>Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
