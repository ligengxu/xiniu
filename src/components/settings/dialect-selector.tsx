"use client";

import { useState, useCallback } from "react";
import { Volume2, Check, Gauge, AlertCircle, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  DIALECT_LIST,
  speak,
  stopSpeaking,
  isSpeaking,
  type DialectInfo,
} from "@/lib/speech";

const RATE_OPTIONS = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1.0, label: "1.0x" },
  { value: 1.25, label: "1.25x" },
  { value: 1.5, label: "1.5x" },
  { value: 2.0, label: "2.0x" },
];

export function DialectSelector() {
  const { settings, setSettings } = useAppStore();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const handlePreview = useCallback(
    async (dialect: DialectInfo) => {
      if (previewId === dialect.id) {
        stopSpeaking();
        setPreviewId(null);
        return;
      }

      stopSpeaking();
      setPreviewError(null);
      setLoadingId(dialect.id);

      const sampleText = getSampleText(dialect.id);

      const result = await speak(sampleText, {
        dialectId: dialect.id,
        rate: settings.speechRate || 1.0,
      });

      setLoadingId(null);

      if (!result.ok) {
        setPreviewError(result.reason);
        setPreviewId(null);
        setTimeout(() => setPreviewError(null), 4000);
        return;
      }

      setPreviewId(dialect.id);

      const check = setInterval(() => {
        if (!isSpeaking()) {
          setPreviewId(null);
          clearInterval(check);
        }
      }, 300);
    },
    [previewId, settings.speechRate]
  );

  const selectDialect = useCallback(
    (dialectId: string) => {
      stopSpeaking();
      setPreviewId(null);
      setSettings({ dialectId });
    },
    [setSettings]
  );

  const currentDialectId = settings.dialectId || "mandarin";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            语音方言
          </h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            使用微软 Edge TTS 引擎，支持多语言真实语音合成
          </p>
        </div>
      </div>

      {previewError && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs animate-fade-in"
          style={{
            background: "color-mix(in srgb, var(--error, #ef4444) 12%, var(--surface))",
            color: "var(--error, #ef4444)",
            border: "1px solid color-mix(in srgb, var(--error, #ef4444) 25%, transparent)",
          }}
        >
          <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{previewError}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {DIALECT_LIST.map((dialect) => {
          const isActive = currentDialectId === dialect.id;
          const isPreviewing = previewId === dialect.id;
          const isLoading = loadingId === dialect.id;

          return (
            <button
              key={dialect.id}
              onClick={() => selectDialect(dialect.id)}
              className="group relative rounded-xl border p-3 text-left transition-all duration-200 hover:scale-[1.02]"
              style={{
                borderColor: isActive ? "var(--accent)" : "var(--border)",
                background: isActive
                  ? "color-mix(in srgb, var(--accent) 8%, var(--surface))"
                  : "var(--surface)",
                boxShadow: isActive
                  ? "0 0 0 1px var(--accent), 0 2px 8px color-mix(in srgb, var(--accent) 15%, transparent)"
                  : "none",
              }}
            >
              <div className="flex items-start justify-between">
                <span className="text-lg leading-none">{dialect.flag}</span>
                <div className="flex items-center gap-1">
                  {isActive && (
                    <span
                      className="flex h-4 w-4 items-center justify-center rounded-full"
                      style={{ background: "var(--accent)" }}
                    >
                      <Check className="h-2.5 w-2.5 text-white" />
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePreview(dialect);
                    }}
                    disabled={isLoading}
                    className="flex h-5 w-5 items-center justify-center rounded-md transition-colors opacity-0 group-hover:opacity-100"
                    style={{
                      color: isPreviewing ? "var(--accent)" : "var(--text-muted)",
                      background: isPreviewing
                        ? "color-mix(in srgb, var(--accent) 15%, transparent)"
                        : "transparent",
                    }}
                    title="试听"
                  >
                    {isLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Volume2
                        className={`h-3 w-3 ${isPreviewing ? "animate-pulse" : ""}`}
                      />
                    )}
                  </button>
                </div>
              </div>

              <p
                className="text-xs font-medium mt-1.5 truncate"
                style={{ color: isActive ? "var(--accent)" : "var(--text-primary)" }}
              >
                {dialect.name}
              </p>
              <p
                className="text-[10px] mt-0.5 font-mono"
                style={{ color: "var(--text-muted)" }}
              >
                {dialect.voice.split("-").slice(0, 2).join("-")}
              </p>
            </button>
          );
        })}
      </div>

      {/* Speech rate */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5" style={{ color: "var(--text-muted)" }} />
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            语速
          </span>
        </div>
        <div className="flex gap-1.5">
          {RATE_OPTIONS.map((opt) => {
            const isActiveRate = (settings.speechRate || 1.0) === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setSettings({ speechRate: opt.value })}
                className="flex-1 rounded-lg py-1.5 text-xs font-medium transition-all"
                style={{
                  background: isActiveRate
                    ? "var(--accent)"
                    : "var(--surface-elevated)",
                  color: isActiveRate ? "#fff" : "var(--text-secondary)",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getSampleText(dialectId: string): string {
  switch (dialectId) {
    case "mandarin":
      return "你好，我是犀牛智能助手，很高兴为你服务。";
    case "cantonese":
      return "你好，我係犀牛智能助手，好高興為你服務。";
    case "taiwanese":
      return "你好，我是犀牛智能助手，很高興為你服務。";
    case "sichuanese":
      return "你好，我是犀牛智能助手，很高兴为你服务嘛。";
    case "shanghainese":
      return "侬好，阿拉是犀牛智能助手，邪气欢喜为侬服务。";
    case "hokkien":
      return "你好，我是犀牛智能助手，真歡喜替你服務。";
    case "english":
      return "Hello, I am Xiniu AI assistant, nice to serve you.";
    case "japanese":
      return "こんにちは、私はXiniu AIアシスタントです。よろしくお願いします。";
    case "korean":
      return "안녕하세요, 저는 시뉴 AI 어시스턴트입니다. 만나서 반갑습니다.";
    default:
      return "你好，我是犀牛智能助手。";
  }
}
