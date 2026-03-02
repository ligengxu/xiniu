import { streamText, convertToModelMessages, stepCountIs, type ModelMessage } from "ai";
import { getModel } from "@/lib/models";
import { getFilteredToolsAndPrompt, computeActiveToolNames, buildInitialSystemPrompt } from "@/skills/registry";
import type { SkillDefinition } from "@/skills/types";

export const maxDuration = 300;

const MAX_CONTEXT_CHARS = 80_000;
const MAX_SINGLE_TOOL_CHARS = 12_000;
const CONTEXT_COMPRESS_THRESHOLD = 8;

function truncateToolOutputs(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) return msg;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trimmedContent = (msg.content as any[]).map((part) => {
      if (part.type !== "text" || typeof part.text !== "string") return part;
      let text = part.text;
      text = text.replace(
        /"base64"\s*:\s*"[A-Za-z0-9+/=]{1000,}"/g,
        `"base64": "[已省略]"`
      );
      if (text.length > MAX_SINGLE_TOOL_CHARS) {
        const half = Math.floor(MAX_SINGLE_TOOL_CHARS / 2);
        text = text.slice(0, half) + `\n\n...[内容过长，已截断 ${text.length - MAX_SINGLE_TOOL_CHARS} 字符]...\n\n` + text.slice(-half);
      }
      return { ...part, text };
    });

    return { ...msg, content: trimmedContent } as typeof msg;
  });
}

function enforceContextLimit(messages: ModelMessage[]): ModelMessage[] {
  let totalLen = 0;
  for (const m of messages) {
    if (typeof m.content === "string") {
      totalLen += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if ("text" in p && typeof p.text === "string") totalLen += p.text.length;
      }
    }
  }

  if (totalLen <= MAX_CONTEXT_CHARS) return messages;

  const keep = Math.max(4, Math.floor(messages.length * 0.3));
  const head = messages.slice(0, 2);
  const tail = messages.slice(-keep);
  return [...head, ...tail];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function smartCompressMessages(uiMessages: any[]): { compressed: any[]; fullHistory: any[] } {
  if (!Array.isArray(uiMessages) || uiMessages.length <= CONTEXT_COMPRESS_THRESHOLD) {
    return { compressed: uiMessages, fullHistory: uiMessages };
  }

  const keepRecent = Math.min(4, Math.floor(uiMessages.length * 0.4));
  const earlyMessages = uiMessages.slice(0, uiMessages.length - keepRecent);
  const recentMessages = uiMessages.slice(-keepRecent);

  const summaryParts: string[] = [];
  for (let i = 0; i < earlyMessages.length; i++) {
    const msg = earlyMessages[i];
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.parts)) {
      for (const p of msg.parts) {
        if (p.type === "text" && typeof p.text === "string") text += p.text;
      }
    }
    const preview = text.slice(0, 80) + (text.length > 80 ? "..." : "");
    if (preview.trim()) {
      summaryParts.push(`[轮次${i + 1} ${msg.role}] ${preview}`);
    }
  }

  const summaryText = `[对话历史摘要 — 共${earlyMessages.length}轮已压缩，如需详情请调用 context_digest 工具]\n\n${summaryParts.join("\n")}`;
  const summaryMessage = {
    role: "assistant" as const,
    content: summaryText,
    parts: [{ type: "text" as const, text: summaryText }],
  };

  return {
    compressed: [summaryMessage, ...recentMessages],
    fullHistory: uiMessages,
  };
}

function extractDispatchedModules(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  steps: any[],
): string[] {
  const modules: string[] = [];
  for (const step of steps) {
    if (!step.toolResults) continue;
    for (const tr of step.toolResults) {
      if (tr.toolName === "dispatch_skills" && tr.result?.data?._dispatch) {
        const activated = tr.result.data.activatedModules;
        if (Array.isArray(activated)) {
          for (const m of activated) modules.push(m);
        }
      }
    }
  }
  return modules;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      messages: uiMessages,
      providerId = "",
      modelId = "",
      apiKey: clientApiKey,
      baseUrl: clientBaseUrl,
    } = body;

    const userTexts: string[] = [];
    if (Array.isArray(uiMessages)) {
      for (const m of uiMessages) {
        if (m.role === "user") {
          if (typeof m.content === "string") userTexts.push(m.content);
          else if (Array.isArray(m.parts)) {
            for (const p of m.parts) {
              if (p.type === "text" && typeof p.text === "string") userTexts.push(p.text);
            }
          }
        }
      }
    }

    const model = getModel(providerId, modelId, clientApiKey, clientBaseUrl);
    const {
      allTools,
      activeToolNames: initialActiveTools,
      systemPrompt: initialPrompt,
      preloadedModules,
      allSkills,
      userSkillNames,
    } = await getFilteredToolsAndPrompt(providerId, modelId, userTexts);

    const allSkillNames = allSkills.map((s: SkillDefinition) => s.name);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const normalizedMessages = (uiMessages as any[]).map((m: any) => {
      if (m.parts) return m;
      if (typeof m.content === "string") {
        return { ...m, parts: [{ type: "text", text: m.content }] };
      }
      return m;
    });

    const { compressed, fullHistory } = smartCompressMessages(normalizedMessages);

    let modelMessages = await convertToModelMessages(compressed);
    modelMessages = truncateToolOutputs(modelMessages);
    modelMessages = enforceContextLimit(modelMessages);

    const activatedModules = new Set<string>();

    const result = streamText({
      model,
      system: initialPrompt,
      messages: modelMessages,
      tools: allTools,
      activeTools: initialActiveTools,
      experimental_context: { fullHistory },

      prepareStep: ({ steps }) => {
        const newModules = extractDispatchedModules(steps);
        if (newModules.length === 0) return {};

        let changed = false;
        for (const m of newModules) {
          if (!activatedModules.has(m)) {
            activatedModules.add(m);
            changed = true;
          }
        }

        if (!changed) return {};

        const expandedActiveTools = computeActiveToolNames(
          allSkillNames,
          activatedModules,
          preloadedModules,
          userSkillNames,
        );

        const allModules = [...preloadedModules, ...Array.from(activatedModules)];
        const expandedPrompt = buildInitialSystemPrompt(
          expandedActiveTools,
          allSkills,
          allModules,
        );

        console.log(
          `[prepareStep] dispatched=[${Array.from(activatedModules).join(",")}] active=${expandedActiveTools.length}/${allSkillNames.length} len=${expandedPrompt.length}`
        );

        return {
          activeTools: expandedActiveTools,
          system: expandedPrompt,
        };
      },

      stopWhen: stepCountIs(20),
    });

    return result.toUIMessageStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chat] Error:", message);

    if (message.includes("Range of input length") || message.includes("too long") || message.includes("context_length") || message.includes("Input is too long")) {
      return Response.json(
        { error: "对话上下文过长，请新建一个对话后重试。" },
        { status: 413 }
      );
    }

    return Response.json(
      { error: `AI 服务异常: ${message.slice(0, 200)}` },
      { status: 500 }
    );
  }
}
