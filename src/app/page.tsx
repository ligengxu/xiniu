"use client";

import { useEffect, useState, useCallback } from "react";
import { PanelLeft } from "lucide-react";
import { ChatContainer } from "@/components/chat/chat-container";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ResizablePanel } from "@/components/layout/resizable-panel";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { useAppStore } from "@/lib/store";
import { getThemeById, applyTheme } from "@/lib/themes";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";

interface SkillMeta {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  source?: string;
}

export default function HomePage() {
  const {
    sidebarOpen, setSidebarOpen, settings,
    sessions, activeSessionId, createSession, setActiveSession,
  } = useAppStore();
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const router = useRouter();
  const { t } = useI18n();

  useEffect(() => {
    applyTheme(getThemeById(settings.theme || "space-black"));
  }, [settings.theme]);

  useEffect(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then(setSkills)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!activeSessionId && sessions.length === 0) {
      createSession(t.app.newChat);
    } else if (!activeSessionId && sessions.length > 0) {
      setActiveSession(sessions[0].id);
    }
  }, [activeSessionId, sessions, createSession, setActiveSession]);

  const handleNewChat = useCallback(() => {
    createSession("新对话");
  }, [createSession]);

  const handleSelectSession = useCallback((id: string) => {
    setActiveSession(id);
  }, [setActiveSession]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const headerTitle = activeSession?.title || t.app.newChat;

  return (
    <div
      className="flex h-dvh overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <ResizablePanel
        defaultWidth={256}
        minWidth={200}
        maxWidth={400}
        side="left"
        visible={sidebarOpen}
        storageKey="sidebar"
      >
        <Sidebar
          skills={skills}
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onNewChat={handleNewChat}
          onSelectSession={handleSelectSession}
        />
      </ResizablePanel>

      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header
          className="flex items-center gap-3 px-4 py-3 border-b backdrop-blur-xl"
          style={{
            borderColor: "var(--border)",
            background: "color-mix(in srgb, var(--surface) 60%, transparent)",
          }}
        >
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md transition-colors hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
          <h2
            className="text-sm font-medium truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {headerTitle}
          </h2>
          <div className="ml-auto">
            <kbd
              className="hidden sm:inline-flex h-6 items-center rounded-md border px-2 text-[10px] font-mono gap-1 cursor-pointer hover:opacity-80 transition-opacity"
              style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
            >
              Ctrl+K
            </kbd>
          </div>
        </header>

        <ChatContainer sessionId={activeSessionId} />
      </main>

      <CommandPalette
        onNewChat={handleNewChat}
        onOpenSettings={() => router.push("/settings")}
        onChangeTheme={() => router.push("/settings")}
      />
    </div>
  );
}
