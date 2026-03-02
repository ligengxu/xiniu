import { z } from "zod";
import type { SkillDefinition } from "../types";

interface OcrResult {
  text: string;
  blocks: Array<{ text: string; confidence: number; bbox?: number[] }>;
  language?: string;
}

async function loadApiKey(envKey: string): Promise<string | null> {
  try {
    const path = require("path");
    const fs = require("fs");
    const envPath = path.join(process.cwd(), ".env.local");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${envKey}=(.+)$`, "m"));
      if (match) return match[1].trim();
    }
  } catch {}
  return process.env[envKey] || null;
}

async function ocrWithTesseract(imagePath: string, lang: string): Promise<OcrResult | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(execFile);

    const { stdout } = await execAsync("tesseract", [imagePath, "stdout", "-l", lang, "--psm", "3"], {
      timeout: 30000, windowsHide: true,
    });

    const text = stdout.trim();
    if (!text) return null;

    return {
      text,
      blocks: text.split("\n").filter(Boolean).map((line) => ({ text: line, confidence: 0 })),
      language: lang,
    };
  } catch {
    return null;
  }
}

async function ocrWithTesseractTsv(imagePath: string, lang: string): Promise<OcrResult | null> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(execFile);

    const { stdout } = await execAsync("tesseract", [imagePath, "stdout", "-l", lang, "--psm", "3", "tsv"], {
      timeout: 30000, windowsHide: true,
    });

    const lines = stdout.split("\n").slice(1);
    const blocks: Array<{ text: string; confidence: number; bbox: number[] }> = [];
    const textParts: string[] = [];

    for (const line of lines) {
      const parts = line.split("\t");
      if (parts.length >= 12) {
        const conf = parseInt(parts[10]);
        const text = parts[11]?.trim();
        if (text && conf > 0) {
          blocks.push({
            text,
            confidence: conf,
            bbox: [parseInt(parts[6]), parseInt(parts[7]), parseInt(parts[8]), parseInt(parts[9])],
          });
          textParts.push(text);
        }
      }
    }

    if (textParts.length === 0) return null;
    return { text: textParts.join(" "), blocks, language: lang };
  } catch {
    return null;
  }
}

async function ocrWithDashscope(imagePath: string): Promise<OcrResult | null> {
  const apiKey = await loadApiKey("DASHSCOPE_API_KEY");
  if (!apiKey) return null;

  try {
    const fs = await import("fs");
    const imageBuffer = fs.readFileSync(imagePath);
    const base64 = imageBuffer.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
    const mimeMap: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" };
    const mime = mimeMap[ext] || "image/png";

    const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-vl-plus",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            { type: "text", text: "请精确识别这张图片中的所有文字内容。只输出识别到的文字，不要添加任何解释或描述。如果是表格，请用制表符分隔列。保持原始排版格式。" },
          ],
        }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await resp.json() as { choices?: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    return {
      text,
      blocks: text.split("\n").filter(Boolean).map((line) => ({ text: line, confidence: 95 })),
      language: "auto",
    };
  } catch {
    return null;
  }
}

async function ocrWithUrl(imageUrl: string): Promise<OcrResult | null> {
  const apiKey = await loadApiKey("DASHSCOPE_API_KEY");
  if (!apiKey) return null;

  try {
    const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "qwen-vl-plus",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: "请精确识别这张图片中的所有文字内容。只输出识别到的文字，不要添加任何解释或描述。如果是表格，请用制表符分隔列。保持原始排版格式。" },
          ],
        }],
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await resp.json() as { choices?: Array<{ message: { content: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    return {
      text,
      blocks: text.split("\n").filter(Boolean).map((line) => ({ text: line, confidence: 95 })),
      language: "auto",
    };
  } catch {
    return null;
  }
}

async function ocrBatch(
  imagePaths: string[], engine: string, lang: string,
): Promise<Array<{ file: string; ok: boolean; result?: OcrResult; error?: string }>> {
  const results: Array<{ file: string; ok: boolean; result?: OcrResult; error?: string }> = [];

  for (const filePath of imagePaths) {
    try {
      const fs = await import("fs");
      if (!fs.existsSync(filePath)) {
        results.push({ file: filePath, ok: false, error: "文件不存在" });
        continue;
      }

      let result: OcrResult | null = null;
      if (engine === "dashscope") {
        result = await ocrWithDashscope(filePath);
      } else {
        result = await ocrWithTesseractTsv(filePath, lang);
        if (!result) result = await ocrWithTesseract(filePath, lang);
      }

      if (result) {
        results.push({ file: filePath, ok: true, result });
      } else {
        results.push({ file: filePath, ok: false, error: "识别失败" });
      }
    } catch (err) {
      results.push({ file: filePath, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}

async function detectTesseract(): Promise<{ available: boolean; version?: string; languages?: string[] }> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(execFile);

    const { stdout: verOut } = await execAsync("tesseract", ["--version"], { timeout: 5000, windowsHide: true });
    const version = verOut.split("\n")[0]?.trim() || "unknown";

    const { stdout: langOut } = await execAsync("tesseract", ["--list-langs"], { timeout: 5000, windowsHide: true });
    const languages = langOut.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);

    return { available: true, version, languages };
  } catch {
    return { available: false };
  }
}

export const ocrExtractSkill: SkillDefinition = {
  name: "ocr_extract",
  displayName: "文字识别提取",
  description:
    "OCR文字识别：从图片中提取文字，支持本地Tesseract和云端通义千问VL多模态识别。支持印刷体/手写体/表格/公式。" +
    "用户说'OCR'、'文字识别'、'识别图片文字'、'提取文字'、'图片转文字'时使用。",
  icon: "ScanText",
  category: "creative",
  setupGuide: {
    framework: "Tesseract OCR + 通义千问VL",
    frameworkUrl: "https://github.com/tesseract-ocr/tesseract",
    installCommands: [
      { label: "Windows - Scoop", cmd: "scoop install tesseract" },
      { label: "macOS - Homebrew", cmd: "brew install tesseract tesseract-lang" },
      { label: "Ubuntu/Debian", cmd: "sudo apt install tesseract-ocr tesseract-ocr-chi-sim" },
    ],
    configSteps: [
      "方案A (本地): 安装 Tesseract OCR 引擎",
      "方案A: 安装中文语言包 (chi_sim)",
      "方案B (云端): 获取通义千问 API Key (dashscope.aliyuncs.com)",
      "方案B: 在 .env.local 中设置 DASHSCOPE_API_KEY",
      "使用 detect 操作检查 OCR 引擎可用性",
    ],
    requiredCredentials: [
      { key: "dashscope_key", label: "DashScope API Key", description: "通义千问多模态识别 (可选, 云端方案)", envVar: "DASHSCOPE_API_KEY" },
    ],
    healthCheckAction: "detect",
    docsUrl: "https://tesseract-ocr.github.io/tessdoc/",
  },
  parameters: z.object({
    action: z.enum(["recognize", "batch", "detect", "from_url"]).describe(
      "操作: recognize=识别单张图片, batch=批量识别, detect=检测OCR引擎, from_url=从URL识别"
    ),
    imagePath: z.string().optional().describe("recognize时: 图片文件路径"),
    imagePaths: z.array(z.string()).optional().describe("batch时: 图片路径列表"),
    imageUrl: z.string().optional().describe("from_url时: 图片URL"),
    engine: z.enum(["auto", "tesseract", "dashscope"]).optional().describe("OCR引擎: auto(自动选择)/tesseract(本地)/dashscope(云端)，默认auto"),
    lang: z.string().optional().describe("Tesseract语言: chi_sim(简中)/chi_tra(繁中)/eng(英)/jpn(日)/kor(韩)，默认chi_sim+eng"),
    savePath: z.string().optional().describe("结果保存路径(TXT)"),
    outputFormat: z.enum(["text", "json", "tsv"]).optional().describe("输出格式: text/json/tsv，默认text"),
  }),
  execute: async (params) => {
    const p = params as {
      action: string; imagePath?: string; imagePaths?: string[]; imageUrl?: string;
      engine?: string; lang?: string; savePath?: string; outputFormat?: string;
    };

    try {
      if (p.action === "detect") {
        const tesseract = await detectTesseract();
        const dashKey = await loadApiKey("DASHSCOPE_API_KEY");

        let msg = `🔍 OCR引擎检测\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `\nTesseract:\n`;
        if (tesseract.available) {
          msg += `  ✅ 可用 (${tesseract.version})\n`;
          msg += `  📋 已安装语言: ${tesseract.languages?.join(", ") || "无"}\n`;
          if (!tesseract.languages?.some((l) => l.includes("chi"))) {
            msg += `  ⚠️ 未安装中文语言包\n  💡 安装: 下载 chi_sim.traineddata 到 tessdata 目录\n`;
          }
        } else {
          msg += `  ❌ 未安装\n  💡 安装: https://github.com/UB-Mannheim/tesseract/wiki\n`;
        }

        msg += `\n通义千问VL (云端):\n`;
        msg += dashKey ? `  ✅ 已配置 DASHSCOPE_API_KEY\n` : `  ❌ 未配置\n  💡 在 .env.local 中添加 DASHSCOPE_API_KEY\n`;

        msg += `\n📌 推荐: 云端引擎(dashscope)效果最好，支持手写体和复杂排版`;

        return { success: true, message: msg, data: { tesseract: tesseract.available, dashscope: !!dashKey } };
      }

      if (p.action === "from_url") {
        if (!p.imageUrl) return { success: false, message: "❌ 请提供 imageUrl" };
        const result = await ocrWithUrl(p.imageUrl);
        if (!result) return { success: false, message: "❌ 识别失败。请确保 DASHSCOPE_API_KEY 已配置" };

        let msg = `✅ 图片文字识别完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🌐 URL: ${p.imageUrl}\n`;
        msg += `📊 识别: ${result.blocks.length}个文本块\n\n`;
        msg += `📝 识别结果:\n${result.text}`;

        if (p.savePath) {
          const fs = await import("fs");
          const path = await import("path");
          const dir = path.dirname(p.savePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(p.savePath, result.text, "utf-8");
          msg += `\n\n📁 已保存: ${p.savePath}`;
        }

        return { success: true, message: msg, data: { text: result.text, blocks: result.blocks.length } };
      }

      if (p.action === "recognize") {
        if (!p.imagePath) return { success: false, message: "❌ 请提供 imagePath" };
        const fs = await import("fs");
        if (!fs.existsSync(p.imagePath)) return { success: false, message: `❌ 文件不存在: ${p.imagePath}` };

        let engine = p.engine || "auto";
        const lang = p.lang || "chi_sim+eng";

        if (engine === "auto") {
          const dashKey = await loadApiKey("DASHSCOPE_API_KEY");
          if (dashKey) engine = "dashscope";
          else {
            const tesseract = await detectTesseract();
            engine = tesseract.available ? "tesseract" : "dashscope";
          }
        }

        let result: OcrResult | null = null;
        if (engine === "dashscope") {
          result = await ocrWithDashscope(p.imagePath);
          if (!result) return { success: false, message: "❌ 云端识别失败。请检查 DASHSCOPE_API_KEY 配置" };
        } else {
          result = await ocrWithTesseractTsv(p.imagePath, lang);
          if (!result) result = await ocrWithTesseract(p.imagePath, lang);
          if (!result) {
            const dashKey = await loadApiKey("DASHSCOPE_API_KEY");
            if (dashKey) result = await ocrWithDashscope(p.imagePath);
          }
          if (!result) return { success: false, message: "❌ 识别失败。请安装 Tesseract 或配置 DASHSCOPE_API_KEY" };
        }

        let output = result.text;
        if (p.outputFormat === "json") output = JSON.stringify(result.blocks, null, 2);
        else if (p.outputFormat === "tsv") output = result.blocks.map((b) => `${b.confidence}\t${b.text}`).join("\n");

        let msg = `✅ 文字识别完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📄 文件: ${p.imagePath}\n`;
        msg += `🤖 引擎: ${engine}\n`;
        msg += `📊 识别: ${result.blocks.length}个文本块\n\n`;
        msg += `📝 识别结果:\n${output.slice(0, 3000)}${output.length > 3000 ? "\n...(已截断)" : ""}`;

        if (p.savePath) {
          const path = await import("path");
          const dir = path.dirname(p.savePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(p.savePath, output, "utf-8");
          msg += `\n\n📁 已保存: ${p.savePath}`;
        }

        return { success: true, message: msg, data: { text: result.text, blocks: result.blocks.length, engine } };
      }

      if (p.action === "batch") {
        if (!p.imagePaths || p.imagePaths.length === 0) return { success: false, message: "❌ 请提供 imagePaths 列表" };

        let engine = p.engine || "auto";
        if (engine === "auto") {
          const dashKey = await loadApiKey("DASHSCOPE_API_KEY");
          engine = dashKey ? "dashscope" : "tesseract";
        }

        const results = await ocrBatch(p.imagePaths, engine, p.lang || "chi_sim+eng");
        const ok = results.filter((r) => r.ok);
        const fail = results.filter((r) => !r.ok);

        let msg = `✅ 批量识别完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📊 成功: ${ok.length} | 失败: ${fail.length} | 总计: ${results.length}\n\n`;

        for (const r of ok) {
          msg += `✅ ${r.file.split(/[/\\]/).pop()}: ${r.result!.text.slice(0, 80)}...\n`;
        }
        for (const r of fail) {
          msg += `❌ ${r.file.split(/[/\\]/).pop()}: ${r.error}\n`;
        }

        if (p.savePath) {
          const fs = await import("fs");
          const path = await import("path");
          const dir = path.dirname(p.savePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const combined = ok.map((r) => `=== ${r.file} ===\n${r.result!.text}\n`).join("\n");
          fs.writeFileSync(p.savePath, combined, "utf-8");
          msg += `\n📁 已保存: ${p.savePath}`;
        }

        return { success: true, message: msg, data: { total: results.length, success: ok.length, failed: fail.length } };
      }

      return { success: false, message: `❌ 未知操作: ${p.action}` };
    } catch (err) {
      return { success: false, message: `❌ OCR异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
