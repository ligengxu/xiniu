"use client";

import { Send, Square, Mic, MicOff, Zap, Settings2, Rocket, ImagePlus, X } from "lucide-react";
import { useRef, useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { getDialectById } from "@/lib/speech";
import { useI18n } from "@/lib/i18n";

function useComplexityOptions() {
  const { t } = useI18n();
  return [
    { id: "simple" as const, label: t.chat.simple, icon: Zap },
    { id: "medium" as const, label: t.chat.medium, icon: Settings2 },
    { id: "complex" as const, label: t.chat.complex, icon: Rocket },
  ];
}

interface AttachedImage {
  file: File;
  preview: string;
  name: string;
}

interface ChatInputProps {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent, attachedImages?: AttachedImage[]) => void;
  isLoading: boolean;
  onStop: () => void;
}

export function ChatInput({
  input,
  setInput,
  onSubmit,
  isLoading,
  onStop,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const { t } = useI18n();
  const COMPLEXITY_OPTIONS = useComplexityOptions();
  const complexity = useAppStore((s) => s.settings.codeComplexity) || "medium";
  const dialectId = useAppStore((s) => s.settings.dialectId);
  const setSettings = useAppStore((s) => s.setSettings);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    const dialect = getDialectById(dialectId || "mandarin");
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = dialect.lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };

    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, [isListening, setInput, dialectId]);

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newImages: AttachedImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      newImages.push({
        file,
        preview: URL.createObjectURL(file),
        name: file.name,
      });
    }
    setAttachedImages((prev) => [...prev, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeImage = useCallback((idx: number) => {
    setAttachedImages((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleFormSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachedImages.length === 0) || isLoading) return;
    onSubmit(e, attachedImages.length > 0 ? attachedImages : undefined);
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.preview));
      return [];
    });
  }, [input, attachedImages, isLoading, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if ((input.trim() || attachedImages.length > 0) && !isLoading) {
        handleFormSubmit(e);
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    const newImages: AttachedImage[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) continue;
      newImages.push({
        file,
        preview: URL.createObjectURL(file),
        name: file.name,
      });
    }
    if (newImages.length > 0) setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <form
      onSubmit={handleFormSubmit}
      className="border-t backdrop-blur-xl p-4"
      style={{
        borderColor: "var(--border)",
        background: "color-mix(in srgb, var(--surface) 80%, transparent)",
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageSelect}
      />
      <div className="max-w-3xl mx-auto mb-2 flex items-center gap-1">
        <span className="text-[10px] mr-1 shrink-0" style={{ color: "var(--text-muted)" }}>
          {t.chat.codeQuality}
        </span>
        {COMPLEXITY_OPTIONS.map((opt) => {
          const active = complexity === opt.id;
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSettings({ codeComplexity: opt.id })}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{
                background: active
                  ? "color-mix(in srgb, var(--accent) 20%, transparent)"
                  : "transparent",
                color: active ? "var(--accent)" : "var(--text-muted)",
                border: active
                  ? "1px solid color-mix(in srgb, var(--accent) 40%, transparent)"
                  : "1px solid transparent",
              }}
              title={opt.desc}
            >
              <Icon className="h-3 w-3" />
              {opt.label}
            </button>
          );
        })}
      </div>

      {attachedImages.length > 0 && (
        <div className="max-w-3xl mx-auto mb-2 flex flex-wrap gap-2">
          {attachedImages.map((img, idx) => (
            <div
              key={idx}
              className="relative group rounded-lg overflow-hidden border"
              style={{ borderColor: "var(--border)", width: 64, height: 64 }}
            >
              <img
                src={img.preview}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(idx)}
                className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: "var(--error)", color: "#fff" }}
              >
                <X className="h-3 w-3" />
              </button>
              <div
                className="absolute bottom-0 left-0 right-0 text-[8px] truncate px-1 py-0.5"
                style={{
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                }}
              >
                {img.name}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-3xl mx-auto flex items-end gap-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors"
          style={{
            background: "var(--surface-elevated)",
            color: "var(--text-muted)",
          }}
          title={t.chat.uploadImage}
        >
          <ImagePlus className="h-4 w-4" />
        </button>

        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.chat.inputPlaceholder}
            rows={1}
            className="w-full resize-none rounded-2xl border px-4 py-3 pr-12 text-sm transition-all focus:outline-none focus:ring-1"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface-elevated)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <button
          type="button"
          onClick={toggleVoice}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
            isListening ? "animate-pulse" : ""
          }`}
          style={{
            background: isListening ? "var(--error)" : "var(--surface-elevated)",
            color: isListening ? "#fff" : "var(--text-muted)",
          }}
          title={isListening ? t.chat.stopReading : t.chat.voiceInput}
        >
          {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>

        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white transition-colors"
            style={{ background: "var(--error)" }}
          >
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() && attachedImages.length === 0}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: "var(--accent)" }}
          >
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </form>
  );
}
