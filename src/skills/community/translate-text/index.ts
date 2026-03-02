import { z } from "zod";
import type { SkillDefinition } from "../types";

const LANG_MAP: Record<string, string> = {
  zh: "中文", en: "英语", ja: "日语", ko: "韩语", fr: "法语",
  de: "德语", es: "西班牙语", pt: "葡萄牙语", ru: "俄语", ar: "阿拉伯语",
  it: "意大利语", nl: "荷兰语", pl: "波兰语", tr: "土耳其语", vi: "越南语",
  th: "泰语", id: "印尼语", ms: "马来语", hi: "印地语", uk: "乌克兰语",
  cs: "捷克语", sv: "瑞典语", da: "丹麦语", fi: "芬兰语", el: "希腊语",
  hu: "匈牙利语", ro: "罗马尼亚语", bg: "保加利亚语", hr: "克罗地亚语", sk: "斯洛伐克语",
};

function detectLang(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u3040-\u30ff\u31f0-\u31ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  return "en";
}

function splitTextForTranslation(text: string, maxLen = 4500): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length + 2 > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? "\n\n" : "") + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  if (chunks.length === 0) {
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
  }
  return chunks;
}

async function translateChunk(text: string, from: string, to: string): Promise<{ ok: boolean; translated: string; engine: string }> {
  const engines = [
    {
      name: "Google翻译",
      url: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&dt=t&q=${encodeURIComponent(text)}`,
      parse: (data: unknown) => {
        const arr = data as Array<Array<Array<string>>>;
        return arr[0].map((s) => s[0]).join("");
      },
    },
    {
      name: "MyMemory",
      url: `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${from}|${to}`,
      parse: (data: unknown) => {
        const d = data as { responseData?: { translatedText?: string } };
        return d.responseData?.translatedText || "";
      },
    },
  ];

  for (const engine of engines) {
    try {
      const resp = await fetch(engine.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const result = engine.parse(data);
      if (result && result.length > 0) {
        return { ok: true, translated: result, engine: engine.name };
      }
    } catch {
      continue;
    }
  }
  return { ok: false, translated: "", engine: "none" };
}

async function translateViaApi(text: string, from: string, to: string): Promise<{ ok: boolean; translated: string; engine: string }> {
  const chunks = splitTextForTranslation(text);
  if (chunks.length === 1) return translateChunk(chunks[0], from, to);

  const results: string[] = [];
  let usedEngine = "";
  for (const chunk of chunks) {
    const r = await translateChunk(chunk, from, to);
    if (!r.ok) return { ok: false, translated: results.join("\n\n"), engine: usedEngine || "none" };
    results.push(r.translated);
    if (!usedEngine) usedEngine = r.engine;
  }
  return { ok: true, translated: results.join("\n\n"), engine: usedEngine };
}

export const translateTextSkill: SkillDefinition = {
  name: "translate_text",
  displayName: "多语言翻译",
  description: "翻译文本：支持30+语言互译（中/英/日/韩/法/德/西/俄/阿拉伯等）。自动检测源语言，无需手动指定。用户说'翻译'、'translate'、'把xx翻译成xx'时使用。",
  icon: "Languages",
  category: "office",
  parameters: z.object({
    text: z.string().describe("要翻译的文本"),
    from: z.string().optional().describe("源语言代码(zh/en/ja/ko等)，不填则自动检测"),
    to: z.string().optional().describe("目标语言代码，默认：如果源文本是中文则译为英文，否则译为中文"),
    listLanguages: z.boolean().optional().describe("设为true时列出所有支持的语言代码"),
  }),
  execute: async (params) => {
    const { text, from: inputFrom, to: inputTo, listLanguages } = params as {
      text: string; from?: string; to?: string; listLanguages?: boolean;
    };

    if (listLanguages) {
      const list = Object.entries(LANG_MAP).map(([code, name]) => `${code}: ${name}`).join("\n");
      return { success: true, message: `支持的语言:\n${list}` };
    }

    if (!text || text.trim().length === 0) {
      return { success: false, message: "请提供要翻译的文本" };
    }

    const detectedFrom = inputFrom || detectLang(text);
    const targetTo = inputTo || (detectedFrom === "zh" ? "en" : "zh");

    const fromName = LANG_MAP[detectedFrom] || detectedFrom;
    const toName = LANG_MAP[targetTo] || targetTo;

    try {
      const result = await translateViaApi(text, detectedFrom, targetTo);

      if (result.ok) {
        let msg = `翻译完成 (${fromName} → ${toName})\n`;
        msg += `引擎: ${result.engine}\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `原文: ${text.slice(0, 500)}${text.length > 500 ? "..." : ""}\n\n`;
        msg += `译文: ${result.translated}`;

        return {
          success: true,
          message: msg,
          data: { original: text, translated: result.translated, from: detectedFrom, to: targetTo, engine: result.engine },
        };
      }

      return { success: false, message: `翻译失败，所有翻译引擎均不可用。请检查网络连接。` };
    } catch (err) {
      return { success: false, message: `翻译异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
