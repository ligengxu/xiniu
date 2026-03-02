import { z } from "zod";
import type { SkillDefinition, SkillResult } from "./types";

export interface ConversationTurn {
  turn: number;
  role: string;
  preview: string;
  charCount: number;
  hasToolCalls: boolean;
  toolNames?: string[];
}

const MAX_DETAIL_CHARS = 8_000;

function summarizeHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
): { turns: ConversationTurn[]; totalChars: number } {
  const turns: ConversationTurn[] = [];
  let turnIdx = 0;
  let totalChars = 0;

  for (const msg of messages) {
    turnIdx++;
    let text = "";
    const toolNames: string[] = [];
    let hasToolCalls = false;

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          text += part.text;
        }
        if (part.type === "tool-call" || part.type === "tool_call") {
          hasToolCalls = true;
          if (part.toolName) toolNames.push(part.toolName);
        }
      }
    }

    if (Array.isArray(msg.parts)) {
      for (const p of msg.parts) {
        if (p.type === "text" && typeof p.text === "string") {
          text += p.text;
        }
        if (p.type === "tool-invocation" || p.type === "tool-call") {
          hasToolCalls = true;
          if (p.toolName) toolNames.push(p.toolName);
        }
      }
    }

    totalChars += text.length;
    turns.push({
      turn: turnIdx,
      role: msg.role || "unknown",
      preview: text.slice(0, 120) + (text.length > 120 ? "..." : ""),
      charCount: text.length,
      hasToolCalls,
      toolNames: toolNames.length > 0 ? toolNames : undefined,
    });
  }

  return { turns, totalChars };
}

function extractTurnContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
  from: number,
  to: number,
  detailed: boolean,
): string {
  const selected = messages.slice(Math.max(0, from - 1), to);
  const parts: string[] = [];

  for (let i = 0; i < selected.length; i++) {
    const msg = selected[i];
    const turnNum = from + i;
    let text = "";

    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          text += part.text;
        }
      }
    }
    if (Array.isArray(msg.parts)) {
      for (const p of msg.parts) {
        if (p.type === "text" && typeof p.text === "string") {
          text += p.text;
        }
      }
    }

    if (!detailed && text.length > 500) {
      text = text.slice(0, 250) + `\n...[省略 ${text.length - 500} 字符]...\n` + text.slice(-250);
    } else if (detailed && text.length > MAX_DETAIL_CHARS) {
      const half = Math.floor(MAX_DETAIL_CHARS / 2);
      text = text.slice(0, half) + `\n...[省略 ${text.length - MAX_DETAIL_CHARS} 字符]...\n` + text.slice(-half);
    }

    parts.push(`[轮次${turnNum} ${msg.role}] ${text}`);
  }

  return parts.join("\n\n---\n\n");
}

function searchInHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any[],
  query: string,
): string {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches: { turn: number; role: string; snippet: string }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") text += part.text;
      }
    }
    if (Array.isArray(msg.parts)) {
      for (const p of msg.parts) {
        if (p.type === "text" && typeof p.text === "string") text += p.text;
      }
    }

    const lower = text.toLowerCase();
    if (keywords.some((kw) => lower.includes(kw))) {
      const firstIdx = Math.min(
        ...keywords.map((kw) => lower.indexOf(kw)).filter((idx) => idx >= 0),
      );
      const start = Math.max(0, firstIdx - 100);
      const end = Math.min(text.length, firstIdx + 300);
      matches.push({
        turn: i + 1,
        role: msg.role || "unknown",
        snippet: (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : ""),
      });
    }
  }

  if (matches.length === 0) {
    return `未找到与"${query}"相关的对话内容。`;
  }

  return matches
    .slice(0, 10)
    .map((m) => `[轮次${m.turn} ${m.role}] ${m.snippet}`)
    .join("\n\n---\n\n");
}

export const contextDigestDef: SkillDefinition = {
  name: "context_digest",
  displayName: "上下文管家",
  description: "按需查询对话历史。当你需要回顾之前的对话内容、搜索特定信息、或查看历史工具调用结果时使用。支持三种模式：overview(对话概要)、search(关键词搜索)、detail(查看指定轮次的完整内容)",
  icon: "📋",
  category: "dev",
  parameters: z.object({
    mode: z.enum(["overview", "search", "detail"]).describe(
      "查询模式。overview: 获取整个对话的概要索引；search: 按关键词搜索历史内容；detail: 获取指定轮次范围的完整内容"
    ),
    query: z.string().optional().describe("搜索关键词（mode=search时必填），如'搜索结果'、'用户第一次提到的需求'"),
    from_turn: z.number().optional().describe("起始轮次编号（mode=detail时使用，从1开始）"),
    to_turn: z.number().optional().describe("结束轮次编号（mode=detail时使用）"),
  }),

  execute: async (params, _ctx?: unknown): Promise<SkillResult> => {
    const mode = params.mode as string;
    const query = params.query as string | undefined;
    const fromTurn = params.from_turn as number | undefined;
    const toTurn = params.to_turn as number | undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = _ctx as { fullHistory?: any[] } | undefined;
    const messages = ctx?.fullHistory;

    if (!messages || messages.length === 0) {
      return {
        success: true,
        message: "当前对话历史为空或只有最近几轮（已完整展示在上下文中），无需额外查询。",
      };
    }

    if (mode === "overview") {
      const { turns, totalChars } = summarizeHistory(messages);
      const lines = turns.map((t) => {
        let line = `轮次${t.turn} [${t.role}] ${t.preview} (${t.charCount}字符)`;
        if (t.hasToolCalls && t.toolNames) {
          line += ` 🔧 ${t.toolNames.join(", ")}`;
        }
        return line;
      });
      return {
        success: true,
        message: [
          `对话概要 — 共${turns.length}轮, ${totalChars}字符`,
          "",
          ...lines,
        ].join("\n"),
      };
    }

    if (mode === "search") {
      if (!query) {
        return { success: false, message: "search模式需要提供query参数" };
      }
      const result = searchInHistory(messages, query);
      return { success: true, message: result };
    }

    if (mode === "detail") {
      const from = fromTurn ?? 1;
      const to = toTurn ?? messages.length;
      const content = extractTurnContent(messages, from, to, true);
      return {
        success: true,
        message: `轮次 ${from}-${to} 详细内容:\n\n${content}`,
      };
    }

    return { success: false, message: `未知mode: ${mode}` };
  },
};
