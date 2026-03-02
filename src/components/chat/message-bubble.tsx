"use client";

import { useState, useRef, useEffect, memo, useCallback, useMemo } from "react";
import { Bot, User, ChevronRight, Volume2, ChevronDown, Loader2 } from "lucide-react";
import type { UIMessage } from "ai";
import { ToolInvocationCard } from "./tool-invocation";
import { MarkdownRenderer } from "./markdown-renderer";
import { useAppStore } from "@/lib/store";
import {
  DIALECT_LIST,
  getDialectById,
  speak as dialectSpeak,
  stopSpeaking,
  isSpeaking,
} from "@/lib/speech";

interface MessageBubbleProps {
  message: UIMessage;
}

function extractToolName(partType: string): string {
  if (partType.startsWith("tool-")) {
    return partType.slice(5);
  }
  return partType;
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs transition-colors group"
        style={{ color: "var(--text-muted)" }}
      >
        <ChevronRight
          className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
        />
        <span className="font-medium">思考过程</span>
        {!expanded && (
          <span className="truncate max-w-[200px]" style={{ color: "var(--text-muted)" }}>
            {content.slice(0, 50)}...
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 pl-5 border-l-2 animate-fade-in" style={{ borderColor: "var(--border)" }}>
          <p className="text-xs italic leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-muted)" }}>
            {content}
          </p>
        </div>
      )}
    </div>
  );
}

function extractThinking(text: string): { thinking: string | null; content: string } {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/;
  const match = thinkRegex.exec(text);
  if (match) {
    const thinking = match[1].trim();
    const content = text.replace(thinkRegex, "").trim();
    return { thinking, content };
  }
  return { thinking: null, content: text };
}

const SpeakButton = memo(function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialectId = useAppStore((s) => s.settings.dialectId);
  const speechRate = useAppStore((s) => s.settings.speechRate);
  const setSettings = useAppStore((s) => s.setSettings);

  const currentDialect = getDialectById(dialectId || "mandarin");

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    if (!speaking) return;
    const check = setInterval(() => {
      if (!isSpeaking()) {
        setSpeaking(false);
        clearInterval(check);
      }
    }, 300);
    return () => clearInterval(check);
  }, [speaking]);

  const doSpeak = useCallback(async (did: string) => {
    stopSpeaking();
    setSpeaking(false);
    setError(null);
    setMenuOpen(false);
    setLoading(true);

    const result = await dialectSpeak(text, {
      dialectId: did,
      rate: speechRate || 1.0,
    });

    setLoading(false);

    if (!result.ok) {
      setError(result.reason);
      return;
    }

    setSpeaking(true);
  }, [text, speechRate]);

  const handleMainClick = () => {
    if (loading) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    doSpeak(dialectId || "mandarin");
  };

  return (
    <div className="relative inline-flex items-center" ref={menuRef}>
      <button
        onClick={handleMainClick}
        disabled={loading}
        className="p-1 rounded-l-md transition-colors flex items-center gap-0.5"
        style={{
          color: speaking ? "var(--accent)" : loading ? "var(--text-muted)" : "var(--text-muted)",
          background: speaking
            ? "color-mix(in srgb, var(--accent) 10%, transparent)"
            : "transparent",
          opacity: loading ? 0.6 : 1,
        }}
        title={loading ? "生成语音中..." : speaking ? "停止朗读" : `${currentDialect.flag} ${currentDialect.name}朗读`}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Volume2 className={`h-3.5 w-3.5 ${speaking ? "animate-pulse" : ""}`} />
        )}
        <span className="text-[10px] leading-none">{currentDialect.flag}</span>
      </button>

      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="p-0.5 rounded-r-md transition-colors"
        style={{
          color: "var(--text-muted)",
          background: menuOpen
            ? "color-mix(in srgb, var(--accent) 10%, transparent)"
            : "transparent",
        }}
        title="切换语言"
      >
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
      </button>

      {error && (
        <div
          className="absolute bottom-full right-0 mb-1 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap shadow-lg z-50 animate-fade-in"
          style={{
            background: "var(--error, #ef4444)",
            color: "#fff",
          }}
        >
          {error}
        </div>
      )}

      {menuOpen && (
        <div
          className="absolute bottom-full right-0 mb-1 w-48 rounded-xl border p-1 shadow-xl z-50 dialect-menu-enter"
          style={{
            background: "var(--surface-elevated)",
            borderColor: "var(--border)",
          }}
        >
          <div
            className="px-2 py-1 text-[10px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            选择朗读语言
          </div>
          {DIALECT_LIST.map((d) => {
            const isActive = d.id === (dialectId || "mandarin");
            return (
              <button
                key={d.id}
                onClick={() => {
                  setSettings({ dialectId: d.id });
                  doSpeak(d.id);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors"
                style={{
                  background: isActive
                    ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                    : "transparent",
                  color: isActive ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                <span className="text-sm">{d.flag}</span>
                <span className="flex-1 text-left truncate">{d.name}</span>
                <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                  {d.voice.split("-").slice(0, 2).join("-")}
                </span>
                {isActive && (
                  <Volume2 className="h-3 w-3 flex-shrink-0" style={{ color: "var(--accent)" }} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

const UserTextBubble = memo(function UserTextBubble({ text }: { text: string }) {
  const complexityMatch = text.match(/^\[代码质量:\s*(简单档|中等档|复杂档)\]\n?/);
  const complexityLabel = complexityMatch ? complexityMatch[1] : null;
  const userText = complexityMatch ? text.slice(complexityMatch[0].length) : text;
  return (
    <div
      className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
      style={{ background: "var(--user-bubble)", color: "var(--user-bubble-text)" }}
    >
      {complexityLabel && (
        <span
          className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mr-1.5 align-middle"
          style={{
            background: "rgba(255,255,255,0.15)",
            color: "rgba(255,255,255,0.85)",
          }}
        >
          {complexityLabel === "简单档" ? "⚡" : complexityLabel === "复杂档" ? "🚀" : "⚙️"} {complexityLabel}
        </span>
      )}
      {userText}
    </div>
  );
});

const AiTextBubble = memo(function AiTextBubble({ text }: { text: string }) {
  const { thinking, content } = useMemo(() => extractThinking(text), [text]);
  return (
    <div
      className="rounded-2xl px-4 py-3 text-sm border overflow-hidden"
      style={{ background: "var(--ai-bubble)", color: "var(--text-primary)", borderColor: "var(--ai-bubble-border)" }}
    >
      {thinking && <ThinkingBlock content={thinking} />}
      {content && <MarkdownRenderer content={content} />}
      <div className="flex justify-end mt-1">
        <SpeakButton text={content} />
      </div>
    </div>
  );
});

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  const totalToolSteps = useMemo(
    () => message.parts.filter(isToolPart).length,
    [message.parts]
  );

  let toolStepIndex = 0;

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      {!isUser && (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5"
          style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}
        >
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div className={`max-w-[75%] min-w-0 space-y-1 ${isUser ? "order-first" : ""}`}>
        {message.parts.map((part, i) => {
          if (part.type === "text" && "text" in part && (part as { text: string }).text) {
            const rawText = (part as { text: string }).text;
            if (isUser) {
              return <UserTextBubble key={i} text={rawText} />;
            }
            return <AiTextBubble key={i} text={rawText} />;
          }

          if (part.type === "reasoning" && "reasoning" in part) {
            const reasoning = (part as { reasoning: string }).reasoning;
            if (!reasoning) return null;
            return (
              <div
                key={i}
                className="rounded-2xl px-4 py-3 text-sm border"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <ThinkingBlock content={reasoning} />
              </div>
            );
          }

          if (isToolPart(part)) {
            toolStepIndex++;
            const currentStep = toolStepIndex;
            const toolPart = part as unknown as {
              type: string;
              toolCallId: string;
              toolName?: string;
              state: string;
              input?: Record<string, unknown>;
              output?: { success?: boolean; message?: string; data?: Record<string, unknown> };
              errorText?: string;
            };
            const toolName = toolPart.toolName || extractToolName(toolPart.type);
            return (
              <ToolInvocationCard
                key={toolPart.toolCallId || i}
                toolName={toolName}
                state={toolPart.state}
                input={toolPart.input as Record<string, unknown>}
                output={toolPart.output as { success?: boolean; message?: string; data?: Record<string, unknown> }}
                errorText={toolPart.errorText}
                stepIndex={totalToolSteps > 1 ? currentStep : undefined}
                totalSteps={totalToolSteps > 1 ? totalToolSteps : undefined}
              />
            );
          }

          return null;
        })}
      </div>

      {isUser && (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5"
          style={{ background: "var(--surface-elevated)", color: "var(--text-secondary)" }}
        >
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
});
