"use client";

import { useChat } from "@ai-sdk/react";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { useAppStore, saveSessionMessages, loadSessionMessages } from "@/lib/store";
import { DefaultChatTransport } from "ai";

interface ChatContainerProps {
  sessionId: string | null;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  return <ChatContainerInner key={sessionId || "default"} sessionId={sessionId} />;
}

const COMPLEXITY_MAP: Record<string, string> = {
  simple: "[代码质量: 简单档]",
  medium: "[代码质量: 中等档]",
  complex: "[代码质量: 复杂档]",
};

function ChatContainerInner({ sessionId }: ChatContainerProps) {
  const providerId = useAppStore((s) => s.settings.providerId);
  const modelId = useAppStore((s) => s.settings.modelId);
  const codeComplexity = useAppStore((s) => s.settings.codeComplexity);
  const updateSessionTitle = useAppStore((s) => s.updateSessionTitle);
  const touchSession = useAppStore((s) => s.touchSession);
  const getActiveProviderConfig = useAppStore((s) => s.getActiveProviderConfig);

  const [input, setInput] = useState("");
  const titleUpdatedRef = useRef(false);

  const chatId = sessionId || "default";

  const initialMessages = useMemo(
    () => loadSessionMessages(chatId),
    [chatId]
  );

  const [chatError, setChatError] = useState<string | null>(null);

  const transport = useMemo(() => {
    const config = getActiveProviderConfig();
    return new DefaultChatTransport({
      api: "/api/chat",
      body: {
        providerId,
        modelId,
        ...(config?.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config?.baseUrl ? { baseUrl: config.baseUrl } : {}),
      },
    });
  }, [providerId, modelId, getActiveProviderConfig]);

  const onChatError = useCallback((err: Error) => {
    const msg = err?.message || String(err);
    if (msg.includes("413") || msg.includes("上下文过长") || msg.includes("input length")) {
      setChatError("对话上下文过长，请点击左侧「新对话」开始新会话后重试。");
    } else {
      setChatError(`AI 请求失败: ${msg.slice(0, 150)}`);
    }
  }, []);

  const { messages, sendMessage, stop, status } = useChat({
    id: chatId,
    messages: initialMessages.length > 0 ? initialMessages : undefined,
    transport,
    onError: onChatError,
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (status === "error" && !chatError) {
      setChatError("AI 响应异常，可能是对话上下文过长。请新建一个对话后重试。");
    }
  }, [status, chatError]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMsgCountRef = useRef(initialMessages.length);
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    if (!sessionId) return;
    if (messages.length === 0 && prevMsgCountRef.current === 0) return;
    prevMsgCountRef.current = messages.length;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const delay = isLoadingRef.current ? 5000 : 500;
    saveTimerRef.current = setTimeout(() => {
      saveSessionMessages(sessionId, messagesRef.current);
    }, delay);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages.length, sessionId, isLoading]);

  useEffect(() => {
    titleUpdatedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || titleUpdatedRef.current) return;
    const userMsgs = messages.filter((m) => m.role === "user");
    if (userMsgs.length === 1 && userMsgs[0].parts) {
      const textPart = userMsgs[0].parts.find((p) => p.type === "text");
      if (textPart && "text" in textPart) {
        const title = textPart.text.slice(0, 30) + (textPart.text.length > 30 ? "..." : "");
        updateSessionTitle(sessionId, title);
        titleUpdatedRef.current = true;
      }
    }
    if (messages.length > 0) {
      touchSession(sessionId);
    }
  }, [messages, sessionId, updateSessionTitle, touchSession]);

  const handleSubmit = useCallback(async (
    e: React.FormEvent,
    attachedImages?: Array<{ file: File; preview: string; name: string }>,
  ) => {
    e.preventDefault();
    const val = input.trim();
    if ((!val && !attachedImages?.length) || isLoadingRef.current) return;
    setChatError(null);

    let finalText = val;
    const tag = COMPLEXITY_MAP[codeComplexity || "medium"] || "";

    if (attachedImages && attachedImages.length > 0) {
      try {
        const formData = new FormData();
        for (const img of attachedImages) {
          formData.append("files", img.file);
        }
        const resp = await fetch("/api/upload", { method: "POST", body: formData });
        const result = await resp.json();
        if (result.success && result.files?.length > 0) {
          const paths = result.files.map(
            (f: { name: string; path: string }) => `[已上传图片: ${f.name}] 路径: ${f.path}`
          ).join("\n");
          finalText = finalText
            ? `${finalText}\n\n${paths}`
            : paths;
        }
      } catch {
        finalText = finalText || "(图片上传失败)";
      }
    }

    sendMessage({ text: tag ? `${tag}\n${finalText}` : finalText });
    setInput("");
  }, [input, codeComplexity, sendMessage]);

  const handleHintClick = useCallback((text: string) => {
    if (isLoadingRef.current) return;
    const tag = COMPLEXITY_MAP[codeComplexity || "medium"] || "";
    sendMessage({ text: tag ? `${tag}\n${text}` : text });
  }, [codeComplexity, sendMessage]);

  const handleDismissError = useCallback(() => setChatError(null), []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <MessageList
        messages={messages}
        isLoading={isLoading}
        onHintClick={handleHintClick}
        errorMessage={chatError}
        onDismissError={handleDismissError}
      />
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
        onStop={stop}
      />
    </div>
  );
}
