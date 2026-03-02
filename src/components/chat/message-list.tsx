"use client";

import { useEffect, useRef, memo } from "react";
import type { UIMessage } from "ai";
import { MessageBubble } from "./message-bubble";
import { Bot, AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface MessageListProps {
  messages: UIMessage[];
  isLoading: boolean;
  onHintClick?: (text: string) => void;
  errorMessage?: string | null;
  onDismissError?: () => void;
}

const HINTS_ZH = [
  "帮我创建一个工作文件夹",
  "浏览 baidu.com 的内容",
  "下载这个网页的图片",
  "创建一个备忘录",
  "用 Python 写一个冒泡排序",
  "总结一下最近的科技新闻",
];

const HINTS_EN = [
  "Create a project folder for me",
  "Browse baidu.com content",
  "Download images from this webpage",
  "Create a memo note",
  "Write a bubble sort in Python",
  "Summarize recent tech news",
];

export const MessageList = memo(function MessageList({ messages, isLoading, onHintClick, errorMessage, onDismissError }: MessageListProps) {
  const { t, locale } = useI18n();
  const HINTS = locale === "en" ? HINTS_EN : HINTS_ZH;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRAF = useRef<number>(0);
  const userAtBottomRef = useRef(true);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      userAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!userAtBottomRef.current) return;
    cancelAnimationFrame(scrollRAF.current);
    scrollRAF.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(scrollRAF.current);
  }, [messages.length, isLoading]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 10%, transparent))",
          }}
        >
          <Bot className="h-10 w-10" style={{ color: "var(--accent)" }} />
        </div>
        <div className="text-center space-y-2">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t.app.name}
          </h2>
          <p
            className="text-sm max-w-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t.chat.welcomeDesc}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 mt-4 max-w-lg justify-center">
          {HINTS.map((hint) => (
            <button
              key={hint}
              onClick={() => onHintClick?.(hint)}
              className="text-xs px-3 py-1.5 rounded-full border transition-all cursor-pointer hover:opacity-80"
              style={{
                borderColor: "var(--border)",
                color: "var(--text-muted)",
                background: "var(--surface-elevated)",
              }}
            >
              {hint}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden" ref={scrollContainerRef}>
      <div className="max-w-3xl mx-auto p-4 space-y-4 overflow-hidden">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {isLoading &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "user" && (
            <div className="flex gap-3 animate-fade-in">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}
              >
                <Bot className="h-4 w-4" />
              </div>
              <div
                className="rounded-2xl border px-4 py-3"
                style={{ background: "var(--ai-bubble)", borderColor: "var(--ai-bubble-border)" }}
              >
                <div className="flex gap-1">
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "var(--text-muted)", animationDelay: "0ms" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "var(--text-muted)", animationDelay: "150ms" }}
                  />
                  <span
                    className="w-2 h-2 rounded-full animate-bounce"
                    style={{ background: "var(--text-muted)", animationDelay: "300ms" }}
                  />
                </div>
              </div>
            </div>
          )}
        {errorMessage && (
          <div className="flex gap-3 animate-fade-in">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "color-mix(in srgb, var(--error) 20%, transparent)", color: "var(--error)" }}
            >
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div
              className="flex-1 rounded-2xl border px-4 py-3 text-sm"
              style={{ background: "color-mix(in srgb, var(--error) 5%, var(--surface))", borderColor: "color-mix(in srgb, var(--error) 30%, var(--border))", color: "var(--error)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span>{errorMessage}</span>
                {onDismissError && (
                  <button onClick={onDismissError} className="shrink-0 p-0.5 rounded hover:opacity-70 transition-opacity">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
