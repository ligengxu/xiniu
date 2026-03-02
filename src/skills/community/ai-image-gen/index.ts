import { z } from "zod";
import type { SkillDefinition } from "../types";

interface ImageGenConfig {
  provider: "dashscope" | "openai" | "stability";
  apiKey: string;
}

async function loadApiKey(envKey: string): Promise<string | null> {
  try {
    const envPath = require("path").join(process.cwd(), ".env.local");
    const fs = require("fs");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const match = content.match(new RegExp(`^${envKey}=(.+)$`, "m"));
      if (match) return match[1].trim();
    }
  } catch {}
  return process.env[envKey] || null;
}

async function resolveConfig(provider?: string, apiKey?: string): Promise<{ ok: boolean; config?: ImageGenConfig; error?: string }> {
  if (apiKey) {
    return { ok: true, config: { provider: (provider || "dashscope") as ImageGenConfig["provider"], apiKey } };
  }

  const dashKey = await loadApiKey("DASHSCOPE_API_KEY");
  if (dashKey) return { ok: true, config: { provider: "dashscope", apiKey: dashKey } };

  const openaiKey = await loadApiKey("OPENAI_API_KEY");
  if (openaiKey) return { ok: true, config: { provider: "openai", apiKey: openaiKey } };

  const stabilityKey = await loadApiKey("STABILITY_API_KEY");
  if (stabilityKey) return { ok: true, config: { provider: "stability", apiKey: stabilityKey } };

  return {
    ok: false,
    error: "❌ 未配置图片生成API Key。请在 .env.local 中设置以下任一项:\n" +
      "  DASHSCOPE_API_KEY — 通义万相（推荐，国内最快）\n" +
      "  OPENAI_API_KEY — DALL-E 3\n" +
      "  STABILITY_API_KEY — Stable Diffusion\n\n" +
      "或通过 apiKey 参数直接提供。",
  };
}

async function generateDashscope(
  apiKey: string, prompt: string, negativePrompt: string,
  size: string, style: string, count: number,
): Promise<{ ok: boolean; taskId?: string; urls?: string[]; error?: string }> {
  try {
    const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wanx2.1-t2i-turbo",
        input: { prompt, negative_prompt: negativePrompt || undefined },
        parameters: { size, n: count, style: style || undefined },
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await resp.json() as { output?: { task_id: string; task_status: string }; code?: string; message?: string };
    if (data.code) return { ok: false, error: `${data.code}: ${data.message}` };
    if (!data.output?.task_id) return { ok: false, error: "未获取到任务ID" };

    const taskId = data.output.task_id;

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 3000));

      const pollResp = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      const pollData = await pollResp.json() as {
        output?: { task_status: string; results?: Array<{ url: string }> };
      };

      if (pollData.output?.task_status === "SUCCEEDED") {
        const urls = pollData.output.results?.map((r) => r.url).filter(Boolean) || [];
        return { ok: true, taskId, urls };
      }
      if (pollData.output?.task_status === "FAILED") {
        return { ok: false, taskId, error: "生成失败" };
      }
    }
    return { ok: false, taskId, error: "生成超时（3分钟）" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function generateOpenAI(
  apiKey: string, prompt: string, size: string, quality: string, count: number,
): Promise<{ ok: boolean; urls?: string[]; error?: string }> {
  try {
    const sizeMap: Record<string, string> = {
      "1024*1024": "1024x1024", "1792*1024": "1792x1024", "1024*1792": "1024x1792",
    };
    const resp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        size: sizeMap[size] || "1024x1024",
        quality: quality || "standard",
        n: Math.min(count, 1),
      }),
      signal: AbortSignal.timeout(120000),
    });

    const data = await resp.json() as { data?: Array<{ url: string }>; error?: { message: string } };
    if (data.error) return { ok: false, error: data.error.message };
    const urls = data.data?.map((d) => d.url) || [];
    return { ok: true, urls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function generateStability(
  apiKey: string, prompt: string, negativePrompt: string, size: string,
): Promise<{ ok: boolean; base64?: string; error?: string }> {
  try {
    const [w, h] = size.split("*").map(Number);
    const aspectRatio = w && h ? `${w}:${h}` : "1:1";
    const formParts: Array<[string, string]> = [
      ["prompt", prompt],
      ["output_format", "png"],
      ["aspect_ratio", aspectRatio],
    ];
    if (negativePrompt) formParts.push(["negative_prompt", negativePrompt]);

    const boundary = `----FormBoundary${Date.now()}`;
    let body = "";
    for (const [key, val] of formParts) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${val}\r\n`;
    }
    body += `--${boundary}--\r\n`;

    const resp = await fetch("https://api.stability.ai/v2beta/stable-image/generate/sd3", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(120000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` };
    }
    const data = await resp.json() as { image?: string; artifacts?: Array<{ base64: string }>; message?: string };
    const base64 = data.image || data.artifacts?.[0]?.base64;
    if (!base64) return { ok: false, error: data.message || "未生成图片" };
    return { ok: true, base64 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function downloadImage(url: string, savePath: string): Promise<boolean> {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const dir = path.dirname(savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(savePath, buffer);
    return true;
  } catch { return false; }
}

export const aiImageGenSkill: SkillDefinition = {
  name: "ai_image_gen",
  displayName: "智能图片生成",
  description:
    "AI文生图：通过文字描述生成图片，支持通义万相（国内）、DALL-E 3（OpenAI）、Stable Diffusion三种引擎。" +
    "用户说'生成图片'、'画一张'、'AI绘图'、'文生图'、'AI画图'时使用。",
  icon: "Palette",
  category: "creative",
  setupGuide: {
    framework: "通义万相 / DALL-E / Stable Diffusion",
    frameworkUrl: "https://dashscope.aliyuncs.com/",
    configSteps: [
      "方案A (推荐): 前往 dashscope.aliyuncs.com 获取 API Key",
      "方案A: 在 .env.local 中设置 DASHSCOPE_API_KEY",
      "方案B: 获取 OpenAI API Key (platform.openai.com)",
      "方案C: 获取 Stability AI Key (platform.stability.ai)",
      "使用 check_config 操作验证配置",
    ],
    requiredCredentials: [
      { key: "dashscope_key", label: "DashScope API Key", description: "通义万相文生图 (国内推荐)", envVar: "DASHSCOPE_API_KEY" },
      { key: "openai_key", label: "OpenAI API Key", description: "DALL-E 3 (可选)", envVar: "OPENAI_API_KEY" },
      { key: "stability_key", label: "Stability AI Key", description: "Stable Diffusion (可选)", envVar: "STABILITY_API_KEY" },
    ],
    healthCheckAction: "check_config",
    docsUrl: "https://help.aliyun.com/zh/model-studio/text-to-image",
  },
  parameters: z.object({
    action: z.enum(["generate", "check_config", "query_task"]).describe(
      "操作: generate=生成图片, check_config=检查API配置, query_task=查询异步任务状态"
    ),
    prompt: z.string().optional().describe("图片描述（中文或英文，越详细越好）"),
    negativePrompt: z.string().optional().describe("反向提示词（不想出现的内容）"),
    size: z.string().optional().describe("图片尺寸: 1024*1024(默认) / 1792*1024(横版) / 1024*1792(竖版) / 512*512"),
    style: z.string().optional().describe("风格(通义万相): <auto>/<3d cartoon>/<anime>/<oil painting>/<watercolor>/<sketch>/<flat illustration>/<photography>"),
    count: z.number().optional().describe("生成数量，默认1（DALL-E最多1张）"),
    quality: z.string().optional().describe("质量(DALL-E): standard/hd"),
    provider: z.string().optional().describe("指定引擎: dashscope/openai/stability，不填自动检测"),
    apiKey: z.string().optional().describe("API Key（不填则从.env.local读取）"),
    savePath: z.string().optional().describe("保存目录"),
    taskId: z.string().optional().describe("query_task时的任务ID"),
  }),
  execute: async (params) => {
    const p = params as {
      action: string; prompt?: string; negativePrompt?: string; size?: string;
      style?: string; count?: number; quality?: string; provider?: string;
      apiKey?: string; savePath?: string; taskId?: string;
    };

    try {
      if (p.action === "check_config") {
        const checks: string[] = [];
        const dashKey = await loadApiKey("DASHSCOPE_API_KEY");
        const openaiKey = await loadApiKey("OPENAI_API_KEY");
        const stabilityKey = await loadApiKey("STABILITY_API_KEY");

        checks.push(`通义万相 (DASHSCOPE_API_KEY): ${dashKey ? `✅ 已配置 (${dashKey.slice(0, 6)}...)` : "❌ 未配置"}`);
        checks.push(`DALL-E 3 (OPENAI_API_KEY): ${openaiKey ? `✅ 已配置 (${openaiKey.slice(0, 6)}...)` : "❌ 未配置"}`);
        checks.push(`Stable Diffusion (STABILITY_API_KEY): ${stabilityKey ? `✅ 已配置 (${stabilityKey.slice(0, 6)}...)` : "❌ 未配置"}`);

        return {
          success: true,
          message: `🎨 AI图片生成配置检查\n━━━━━━━━━━━━━━━━━━━━\n${checks.join("\n")}\n\n💡 在 .env.local 中添加对应 API Key 即可启用`,
          data: { dashscope: !!dashKey, openai: !!openaiKey, stability: !!stabilityKey },
        };
      }

      if (p.action === "query_task") {
        if (!p.taskId) return { success: false, message: "❌ 请提供 taskId" };
        const apiKey = p.apiKey || await loadApiKey("DASHSCOPE_API_KEY");
        if (!apiKey) return { success: false, message: "❌ 查询任务需要 DASHSCOPE_API_KEY" };

        const resp = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${p.taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        const data = await resp.json() as {
          output?: { task_status: string; results?: Array<{ url: string }> };
        };

        const status = data.output?.task_status || "UNKNOWN";
        if (status === "SUCCEEDED") {
          const urls = data.output?.results?.map((r) => r.url) || [];
          return { success: true, message: `✅ 任务完成!\n图片URL:\n${urls.map((u, i) => `${i + 1}. ${u}`).join("\n")}` };
        }
        return { success: true, message: `⏳ 任务状态: ${status}` };
      }

      if (p.action === "generate") {
        if (!p.prompt) return { success: false, message: "❌ 请提供图片描述 (prompt 参数)" };

        const configRes = await resolveConfig(p.provider, p.apiKey);
        if (!configRes.ok || !configRes.config) return { success: false, message: configRes.error! };
        const config = configRes.config;

        const size = p.size || "1024*1024";
        const count = p.count || 1;
        const path = await import("path");
        const fs = await import("fs");

        const saveDir = p.savePath || path.join("C:\\Users\\Administrator\\Desktop", `ai_image_${Date.now()}`);
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

        const providerLabels: Record<string, string> = {
          dashscope: "通义万相", openai: "DALL-E 3", stability: "Stable Diffusion XL",
        };

        let msg = `🎨 正在生成图片...\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🤖 引擎: ${providerLabels[config.provider] || config.provider}\n`;
        msg += `📝 提示: ${p.prompt.slice(0, 100)}${p.prompt.length > 100 ? "..." : ""}\n`;
        msg += `📐 尺寸: ${size} | 数量: ${count}\n\n`;

        if (config.provider === "dashscope") {
          const res = await generateDashscope(config.apiKey, p.prompt, p.negativePrompt || "", size, p.style || "", count);
          if (!res.ok) return { success: false, message: msg + `❌ 生成失败: ${res.error}` };

          const savedFiles: string[] = [];
          for (let i = 0; i < (res.urls?.length || 0); i++) {
            const filePath = path.join(saveDir, `image_${i + 1}.png`);
            const ok = await downloadImage(res.urls![i], filePath);
            if (ok) savedFiles.push(filePath);
          }

          msg += `✅ 生成完成! 共 ${res.urls?.length || 0} 张\n`;
          for (const f of savedFiles) msg += `📁 ${f}\n`;
          msg += `\n🔗 在线URL:\n${res.urls?.map((u, i) => `${i + 1}. ${u}`).join("\n")}`;
          return { success: true, message: msg, data: { files: savedFiles, urls: res.urls, taskId: res.taskId } };
        }

        if (config.provider === "openai") {
          const res = await generateOpenAI(config.apiKey, p.prompt, size, p.quality || "standard", count);
          if (!res.ok) return { success: false, message: msg + `❌ 生成失败: ${res.error}` };

          const savedFiles: string[] = [];
          for (let i = 0; i < (res.urls?.length || 0); i++) {
            const filePath = path.join(saveDir, `dalle_${i + 1}.png`);
            const ok = await downloadImage(res.urls![i], filePath);
            if (ok) savedFiles.push(filePath);
          }

          msg += `✅ 生成完成!\n`;
          for (const f of savedFiles) msg += `📁 ${f}\n`;
          return { success: true, message: msg, data: { files: savedFiles, urls: res.urls } };
        }

        if (config.provider === "stability") {
          const res = await generateStability(config.apiKey, p.prompt, p.negativePrompt || "", size);
          if (!res.ok) return { success: false, message: msg + `❌ 生成失败: ${res.error}` };

          const filePath = path.join(saveDir, "sdxl_1.png");
          fs.writeFileSync(filePath, Buffer.from(res.base64!, "base64"));

          msg += `✅ 生成完成!\n📁 ${filePath}`;
          return { success: true, message: msg, data: { files: [filePath] } };
        }

        return { success: false, message: `❌ 不支持的引擎: ${config.provider}` };
      }

      return { success: false, message: `❌ 未知操作: ${p.action}` };
    } catch (err) {
      return { success: false, message: `❌ 图片生成异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
