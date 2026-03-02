import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { SkillDefinition, SkillResult } from "../types";

const OUTPUT_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  ".xiniu",
  "video-narrator",
);

const VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const APIMART_BASE_URL = "https://api.apimart.ai/v1";
const QINGYUN_BASE_URL = "https://api.qingyuntop.top";

// ─── env helpers ──────────────────────────────────────────────────

interface VideoApiConfig {
  provider: "qingyun" | "apimart" | "volcengine";
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

function getVideoApiConfig(): VideoApiConfig | null {
  const qingyunKey = process.env.QINGYUN_API_KEY;
  if (qingyunKey) {
    return {
      provider: "qingyun",
      baseUrl: process.env.QINGYUN_API_BASE || QINGYUN_BASE_URL,
      apiKey: qingyunKey,
      defaultModel: process.env.VIDEO_MODEL || "veo3",
    };
  }

  const apimartKey = process.env.APIMART_API_KEY || process.env.VIDEO_API_KEY;
  if (apimartKey) {
    return {
      provider: "apimart",
      baseUrl: process.env.VIDEO_API_BASE_URL || APIMART_BASE_URL,
      apiKey: apimartKey,
      defaultModel: process.env.VIDEO_MODEL || "sora-2",
    };
  }

  const volcKey = process.env.VOLCENGINE_API_KEY || process.env.ARK_API_KEY;
  if (volcKey) {
    return {
      provider: "volcengine",
      baseUrl: process.env.SEEDANCE_BASE_URL || VOLCENGINE_BASE_URL,
      apiKey: volcKey,
      defaultModel: process.env.SEEDANCE_ENDPOINT_ID || "doubao-seedance-2.0-t2v-250428",
    };
  }

  return null;
}

function getImageGenApiKey(): string | null {
  return (
    process.env.VOLCENGINE_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.QWEN_API_KEY ||
    null
  );
}

function getTextModelApiKey(): string | null {
  return (
    process.env.DASHSCOPE_API_KEY ||
    process.env.QWEN_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    null
  );
}

function getTextModelConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  if (process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY) {
    return {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: (process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY)!,
      model: "qwen-plus",
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: "deepseek-chat",
    };
  }
  return null;
}

// ─── AI text generation ───────────────────────────────────────────

async function aiGenerate(systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = getTextModelConfig();
  if (!cfg) throw new Error("未配置文本模型 API Key（需要 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY）");

  const resp = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 4000,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`AI生成失败 (${resp.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || "";
}

// ─── TTS (edge-tts) ──────────────────────────────────────────────

function edgeTts(
  text: string,
  outFile: string,
  voice = "zh-CN-YunxiNeural",
  rate = "+0%",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "python",
      ["-m", "edge_tts", "--text", text, "--voice", voice, "--rate", rate, "--write-media", outFile],
      { env: { ...process.env, PYTHONIOENCODING: "utf-8" }, windowsHide: true },
    );
    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`edge-tts failed (${code}): ${stderr.slice(0, 300)}`));
    });
    proc.on("error", reject);
    setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error("TTS timed out (60s)"));
    }, 60_000);
  });
}

// ─── convert local image to data URI or return URL ──────────────

async function imageToDataUri(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".bmp": "image/bmp", ".gif": "image/gif",
  };
  const mime = mimeMap[ext] || "image/png";
  const b64 = buf.toString("base64");
  return `data:${mime};base64,${b64}`;
}

// ─── Video generation (apimart / volcengine dual backend) ───────

interface VideoTaskResponse {
  id?: string;
  status: string;
  content?: Array<{
    video_url?: string;
    video?: { url?: string };
  }>;
  error?: { message?: string; code?: string };
  output?: { video_url?: string };
  result?: { video_url?: string; videos?: Array<{ url?: string }> };
  data?: {
    task_id?: string;
    status?: string;
    video_url?: string;
    url?: string;
    fail_reason?: string;
    progress?: string;
    output?: { video_url?: string };
    result_urls?: string[];
    video_generation_status?: string;
  };
  video_url?: string;
  progress?: number;
  status_update_time?: number;
  code?: string | number;
}

function normalizeTaskResponse(raw: Record<string, unknown>): VideoTaskResponse {
  // qingyuntop format: { id, status, video_url, data: { ... }, status_update_time }
  if (typeof raw.status === "string" && typeof raw.id === "string") {
    return raw as unknown as VideoTaskResponse;
  }
  if (raw.data && typeof raw.data === "object" && "task_id" in (raw.data as Record<string, unknown>)) {
    const inner = raw.data as Record<string, unknown>;
    return {
      id: inner.task_id as string,
      status: (inner.status as string) || "unknown",
      data: inner as VideoTaskResponse["data"],
      error: inner.fail_reason ? { message: inner.fail_reason as string } : undefined,
      progress: typeof inner.progress === "string" ? parseInt(inner.progress) : undefined,
    };
  }
  return raw as unknown as VideoTaskResponse;
}

function extractVideoUrl(task: VideoTaskResponse): string {
  return (
    task.video_url ||
    task.content?.[0]?.video_url ||
    task.content?.[0]?.video?.url ||
    task.output?.video_url ||
    task.result?.video_url ||
    task.result?.videos?.[0]?.url ||
    task.data?.video_url ||
    task.data?.url ||
    task.data?.output?.video_url ||
    task.data?.result_urls?.[0] ||
    ""
  );
}

async function createVideoTask(
  prompt: string,
  imageUrl?: string,
  duration = 5,
  aspectRatio = "9:16",
): Promise<{ taskId: string; provider: string }> {
  const cfg = getVideoApiConfig();
  if (!cfg) throw new Error("未配置视频生成 API Key（QINGYUN_API_KEY / APIMART_API_KEY / VOLCENGINE_API_KEY）");

  if (cfg.provider === "qingyun") {
    const model = cfg.defaultModel;
    const body: Record<string, unknown> = {
      model,
      prompt,
      duration,
      aspect_ratio: aspectRatio,
    };
    if (imageUrl) body.image_urls = [imageUrl];

    const resp = await fetch(`${cfg.baseUrl}/v1/video/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`创建视频任务失败 (${resp.status}): ${errText.slice(0, 500)}`);
    }

    const raw = (await resp.json()) as Record<string, unknown>;
    const taskId = (raw.id as string) || (raw.task_id as string);
    if (!taskId) throw new Error(`未获取到任务ID, 响应: ${JSON.stringify(raw).slice(0, 500)}`);
    return { taskId, provider: "qingyun" };
  }

  if (cfg.provider === "apimart") {
    const model = cfg.defaultModel;
    let finalDuration = duration;
    if (model.includes("sora-2-pro") || model.includes("sora-2")) {
      const allowed = [10, 15, 25];
      finalDuration = allowed.reduce((best, v) =>
        Math.abs(v - duration) < Math.abs(best - duration) ? v : best, allowed[0]);
    }

    const body: Record<string, unknown> = {
      model,
      prompt,
      duration: finalDuration,
      aspect_ratio: aspectRatio,
    };
    if (imageUrl) body.image_urls = [imageUrl];

    const resp = await fetch(`${cfg.baseUrl}/videos/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`创建视频任务失败 (${resp.status}): ${errText.slice(0, 500)}`);
    }

    const raw = (await resp.json()) as Record<string, unknown>;
    let taskId: string | undefined;
    if (Array.isArray(raw.data) && raw.data.length > 0) {
      taskId = (raw.data[0] as Record<string, unknown>).task_id as string;
    }
    taskId = taskId || (raw.id as string) || (raw.task_id as string) || (raw.request_id as string);
    if (!taskId) throw new Error(`未获取到任务ID, 响应: ${JSON.stringify(raw).slice(0, 500)}`);
    return { taskId, provider: "apimart" };
  }

  // volcengine
  const body: Record<string, unknown> = {
    model: cfg.defaultModel,
    content: [{ type: "text", text: prompt }],
  };

  if (imageUrl) {
    (body.content as Array<Record<string, unknown>>).push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
    if (!process.env.SEEDANCE_ENDPOINT_ID) {
      body.model = "doubao-seedance-2.0-i2v-250428";
    }
  }

  body.extra = { video_duration: duration, aspect_ratio: aspectRatio };

  const resp = await fetch(`${cfg.baseUrl}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`创建视频任务失败 (${resp.status}): ${errText.slice(0, 500)}`);
  }

  const data = (await resp.json()) as Record<string, unknown>;
  const taskId = (data.id || data.task_id) as string;
  if (!taskId) throw new Error("未获取到视频任务ID");
  return { taskId, provider: "volcengine" };
}

async function queryVideoTask(taskId: string): Promise<VideoTaskResponse> {
  const cfg = getVideoApiConfig();
  if (!cfg) throw new Error("未配置视频 API");

  let url: string;
  if (cfg.provider === "qingyun") {
    url = `${cfg.baseUrl}/v1/video/query?id=${encodeURIComponent(taskId)}`;
  } else {
    url = `${cfg.baseUrl}/videos/generations/${encodeURIComponent(taskId)}`;
  }

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`查询视频任务失败 (${resp.status}): ${errText.slice(0, 300)}`);
  }

  const raw = (await resp.json()) as Record<string, unknown>;
  return normalizeTaskResponse(raw);
}

async function waitForVideo(
  taskId: string,
  maxWaitMs = 600_000,
): Promise<{ videoUrl: string; status: string }> {
  const start = Date.now();
  const pollIntervals = [8000, 10000, 15000, 15000, 20000, 30000, 30000];

  for (let i = 0; Date.now() - start < maxWaitMs; i++) {
    const interval = pollIntervals[Math.min(i, pollIntervals.length - 1)];
    await new Promise((r) => setTimeout(r, interval));

    const task = await queryVideoTask(taskId);
    const s = task.status?.toLowerCase() || "";

    if (["completed", "succeeded", "success"].includes(s)) {
      const url = extractVideoUrl(task);
      if (!url) throw new Error(`视频生成完成但未返回URL, raw: ${JSON.stringify(task).slice(0, 500)}`);
      return { videoUrl: url, status: task.status };
    }
    if (["failed", "cancelled", "fail", "failure", "error"].includes(s)) {
      throw new Error(`视频任务${task.status}: ${task.error?.message || task.data?.fail_reason || "未知错误"}`);
    }
  }
  throw new Error(`视频生成超时 (${Math.round(maxWaitMs / 1000)}s)`);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`下载失败: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  await fs.writeFile(dest, buf);
}

// ─── image generation via DASHSCOPE ─────────────────────────────

async function generateCharacterImage(description: string): Promise<string> {
  const apiKey = getImageGenApiKey();
  if (!apiKey) throw new Error("未配置图片生成 API Key（需要 VOLCENGINE_API_KEY 或 DASHSCOPE_API_KEY）");

  const dashKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
  if (dashKey) {
    const resp = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dashKey}`,
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model: "wanx-v1",
        input: { prompt: description },
        parameters: { size: "1024*1024", n: 1 },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) throw new Error(`图片生成请求失败: ${resp.status}`);
    const data = (await resp.json()) as { output?: { task_id?: string } };
    const tid = data.output?.task_id;
    if (!tid) throw new Error("未获取到图片生成任务ID");

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const qr = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${tid}`, {
        headers: { Authorization: `Bearer ${dashKey}` },
      });
      const qd = (await qr.json()) as {
        output?: {
          task_status?: string;
          results?: Array<{ url?: string }>;
        };
      };
      if (qd.output?.task_status === "SUCCEEDED") {
        const imgUrl = qd.output.results?.[0]?.url;
        if (!imgUrl) throw new Error("图片生成完成但无URL");
        const imgPath = path.join(OUTPUT_DIR, `character_${Date.now()}.png`);
        await downloadFile(imgUrl, imgPath);
        return imgPath;
      }
      if (qd.output?.task_status === "FAILED") {
        throw new Error("图片生成失败");
      }
    }
    throw new Error("图片生成超时");
  }

  throw new Error("需要配置 DASHSCOPE_API_KEY 以使用图片生成功能");
}

// ─── narration script types ─────────────────────────────────────

interface NarrationSegment {
  index: number;
  text: string;
  duration: number;
  expression: string;
  action: string;
  cameraMove: string;
  backgroundMotion: string;
  videoPrompt: string;
}

interface NarrationScript {
  title: string;
  totalDuration: number;
  segments: NarrationSegment[];
  fullText: string;
}

// ─── MAIN SKILL ─────────────────────────────────────────────────

export const videoNarratorSkill: SkillDefinition = {
  name: "video_narrator",
  displayName: "AI口播视频生成",
  description:
    "从文章/话题生成抖音风格口播视频的完整流水线：AI生成口播话术 → 场景脚本(动作/神态/镜头) → TTS语音 → AI视频生成。" +
    "用户说'口播视频'、'生成口播'、'做个视频'、'抖音视频'、'口播'、'视频制作'、'短视频'、'talking head'时使用。" +
    "支持上传人物照片(filePath参数)或AI生成形象。支持多种视频API后端: qingyuntop(veo3/sora-2), apimart, volcengine。",
  icon: "Video",
  category: "creative",
  parameters: z.object({
    action: z
      .enum([
        "check_config",
        "generate_script",
        "generate_audio",
        "generate_video",
        "full_pipeline",
        "query_task",
      ])
      .describe(
        "操作: check_config=检查所需API配置, generate_script=从文章生成口播话术+场景脚本, " +
        "generate_audio=为话术生成TTS语音, generate_video=调用Seedance生成单段视频, " +
        "full_pipeline=一键完整流水线(文章→话术→语音→视频), query_task=查询视频生成任务状态",
      ),
    article: z.string().optional().describe("输入文章内容或主题（generate_script/full_pipeline时使用）"),
    topic: z.string().optional().describe("视频主题/关键词（当无article时用于AI搜索生成文章）"),
    filePath: z.string().optional().describe("人物照片路径（用于图生视频，生成口播人物形象）"),
    characterDesc: z.string().optional().describe("人物形象描述（无照片时用于AI生成人物形象，如'职业装年轻女性，短发，温柔微笑'）"),
    scriptJson: z.string().optional().describe("generate_audio/generate_video时传入的场景脚本JSON（由generate_script步骤输出）"),
    segmentIndex: z.number().optional().describe("指定处理脚本中的第N段（0开始，不传则处理所有段）"),
    taskId: z.string().optional().describe("query_task时传入视频生成任务ID"),
    voiceId: z.string().optional().describe("TTS语音角色: zh-CN-YunxiNeural(男)、zh-CN-XiaoxiaoNeural(女)、zh-CN-YunjianNeural(男播音)、zh-CN-XiaoyiNeural(女播音)，默认YunxiNeural"),
    duration: z.number().optional().describe("每段视频时长(秒)，4-15，默认8"),
    aspectRatio: z.string().optional().describe("视频比例: 9:16(抖音竖屏，默认) / 16:9(横屏) / 1:1(方形)"),
    style: z.string().optional().describe("口播风格: casual(轻松日常)/professional(专业严肃)/humorous(幽默搞笑)/emotional(情感走心)，默认casual"),
    outputDir: z.string().optional().describe("输出目录"),
  }),
  execute: async (params): Promise<SkillResult> => {
    const {
      action,
      article,
      topic,
      filePath,
      characterDesc,
      scriptJson,
      segmentIndex,
      taskId,
      voiceId = "zh-CN-YunxiNeural",
      duration = 8,
      aspectRatio = "9:16",
      style = "casual",
      outputDir,
    } = params as {
      action: string;
      article?: string;
      topic?: string;
      filePath?: string;
      characterDesc?: string;
      scriptJson?: string;
      segmentIndex?: number;
      taskId?: string;
      voiceId?: string;
      duration?: number;
      aspectRatio?: string;
      style?: string;
      outputDir?: string;
    };

    const outDir = outputDir ? path.resolve(outputDir) : OUTPUT_DIR;
    await fs.mkdir(outDir, { recursive: true });

    try {
      switch (action) {
        // ─── 1. CONFIG CHECK ──────────────────────────────────
        case "check_config": {
          const checks: string[] = [];
          let allOk = true;

          const textCfg = getTextModelConfig();
          if (textCfg) {
            checks.push(`✅ 文本生成模型: ${textCfg.model} (${textCfg.baseUrl})`);
          } else {
            checks.push("❌ 文本生成模型: 未配置。请在 .env.local 中设置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY");
            allOk = false;
          }

          const videoCfg = getVideoApiConfig();
          if (videoCfg) {
            checks.push(`✅ 视频生成模型: ${videoCfg.provider} (${videoCfg.baseUrl})`);
            checks.push(`   默认模型: ${videoCfg.defaultModel}`);
          } else {
            checks.push(
              "❌ 视频生成模型: 未配置。请在 .env.local 中设置以下任一组:\n" +
              "   方案A (推荐): QINGYUN_API_KEY=你的qingyuntop Key (支持veo3/sora-2)\n" +
              "   方案B: APIMART_API_KEY=你的apimart.ai Key\n" +
              "   方案C: VOLCENGINE_API_KEY=你的火山引擎Key + SEEDANCE_ENDPOINT_ID=接入点ID",
            );
            allOk = false;
          }

          const imgKey = getImageGenApiKey();
          if (imgKey) {
            checks.push("✅ 图片生成模型: 已配置 (DASHSCOPE_API_KEY 或 VOLCENGINE_API_KEY)");
          } else {
            checks.push("⚠️ 图片生成模型: 未配置。如需AI生成人物形象，请配置 DASHSCOPE_API_KEY");
          }

          try {
            const testProc = spawn("python", ["-m", "edge_tts", "--list-voices"], { windowsHide: true });
            const ttsOk = await new Promise<boolean>((resolve) => {
              testProc.on("close", (c) => resolve(c === 0));
              testProc.on("error", () => resolve(false));
              setTimeout(() => { try { testProc.kill(); } catch {} resolve(false); }, 10_000);
            });
            checks.push(ttsOk ? "✅ TTS语音合成: edge-tts 可用" : "❌ TTS语音合成: edge-tts 不可用。请执行: pip install edge-tts");
            if (!ttsOk) allOk = false;
          } catch {
            checks.push("❌ TTS语音合成: Python未安装或edge-tts未安装。请执行: pip install edge-tts");
            allOk = false;
          }

          return {
            success: true,
            message:
              `口播视频生成 — 环境检查\n━━━━━━━━━━━━━━━━━━━━\n${checks.join("\n")}\n━━━━━━━━━━━━━━━━━━━━\n` +
              (allOk
                ? "✅ 所有必要组件已就绪，可以开始生成口播视频！"
                : "⚠️ 部分组件缺失，请按提示完成配置后再使用。"),
            data: {
              ready: allOk,
              textModel: !!textCfg,
              videoModel: !!videoCfg,
              imageModel: !!imgKey,
              tts: true,
            },
          };
        }

        // ─── 2. GENERATE SCRIPT ───────────────────────────────
        case "generate_script": {
          if (!article && !topic) {
            return { success: false, message: "❌ 需要提供 article(文章内容) 或 topic(视频主题)" };
          }

          const textCfg = getTextModelConfig();
          if (!textCfg) {
            return { success: false, message: "❌ 未配置文本模型。请在 .env.local 中设置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY" };
          }

          const styleMap: Record<string, string> = {
            casual: "轻松日常、像朋友聊天一样，适当用网络热词和口语化表达",
            professional: "专业严肃、逻辑清晰、有权威感，适合知识分享类",
            humorous: "幽默搞笑、段子手风格、适当用夸张和反转，让人想点赞转发",
            emotional: "情感走心、有温度、能引起共鸣，适合正能量和鸡汤类",
          };
          const styleDesc = styleMap[style] || styleMap.casual;

          const scriptPrompt = `你是一个顶级的抖音短视频编导，专门做口播视频内容。

请根据以下内容，生成一个适合抖音口播的完整脚本。

## 要求

1. **话术风格**: ${styleDesc}
2. **总时长控制**: 45-90秒（抖音黄金时长）
3. **结构**: 开头hook(3-5秒抓眼球) → 核心内容(3-5段，每段8-12秒) → 结尾引导互动(5-8秒)
4. **每段话术必须配合**: 表情神态、肢体动作、镜头运动、背景变化

## 输出格式 (严格JSON)

\`\`\`json
{
  "title": "视频标题（吸引点击）",
  "segments": [
    {
      "index": 0,
      "text": "这段的口播文字（自然口语化）",
      "duration": 8,
      "expression": "人物表情描述（如：微笑看向镜头、惊讶张大嘴巴、认真皱眉思考）",
      "action": "人物动作描述（如：双手比心、指向旁边、摊手耸肩、竖起大拇指）",
      "cameraMove": "镜头运动（如：缓慢推近、固定中景、从左平移到右、轻微摇晃手持感）",
      "backgroundMotion": "背景描述和是否运动（如：纯色渐变背景微动、办公室场景固定、街景人流走动）",
      "videoPrompt": "用于视频生成模型的英文Prompt，描述这一段的完整画面（人物表情+动作+镜头+背景+氛围，尽量详细和电影感）"
    }
  ]
}
\`\`\`

注意:
- videoPrompt 必须用英文写，要非常具体和画面感强
- 每段的 videoPrompt 要包含人物描述、表情、动作、镜头运动、背景、光线氛围等
- 抖音竖屏9:16比例
- 开头第一句话必须有"hook"吸引力，如提问、反常识、数字冲击等
- 结尾要引导评论/点赞/关注`;

          const userInput = article
            ? `请将以下文章改编为抖音口播视频脚本:\n\n${article}`
            : `请围绕"${topic}"这个主题，创作一个抖音口播视频脚本`;

          const rawResult = await aiGenerate(scriptPrompt, userInput);

          const jsonMatch = rawResult.match(/```(?:json)?\s*([\s\S]*?)```/) || rawResult.match(/(\{[\s\S]*\})/);
          if (!jsonMatch) {
            return {
              success: false,
              message: `❌ AI生成的脚本格式异常，无法解析JSON。\n原始输出:\n${rawResult.slice(0, 2000)}`,
            };
          }

          let script: NarrationScript;
          try {
            const parsed = JSON.parse(jsonMatch[1].trim());
            script = {
              title: parsed.title || "口播视频",
              totalDuration: 0,
              segments: (parsed.segments || []).map((s: Record<string, unknown>, i: number) => ({
                index: i,
                text: String(s.text || ""),
                duration: Number(s.duration) || 8,
                expression: String(s.expression || ""),
                action: String(s.action || ""),
                cameraMove: String(s.cameraMove || ""),
                backgroundMotion: String(s.backgroundMotion || ""),
                videoPrompt: String(s.videoPrompt || ""),
              })),
              fullText: "",
            };
            script.totalDuration = script.segments.reduce((a, s) => a + s.duration, 0);
            script.fullText = script.segments.map((s) => s.text).join("\n");
          } catch (e) {
            return {
              success: false,
              message: `❌ JSON解析失败: ${e instanceof Error ? e.message : String(e)}\n原始输出:\n${rawResult.slice(0, 1000)}`,
            };
          }

          const scriptPath = path.join(outDir, `script_${Date.now()}.json`);
          await fs.writeFile(scriptPath, JSON.stringify(script, null, 2), "utf-8");

          let preview = `📝 口播脚本: ${script.title}\n━━━━━━━━━━━━━━━━━━━━\n`;
          preview += `⏱️ 总时长: ~${script.totalDuration}秒 | 共${script.segments.length}个段落\n\n`;

          for (const seg of script.segments) {
            preview += `**[${seg.index + 1}] ${seg.duration}秒**\n`;
            preview += `💬 "${seg.text}"\n`;
            preview += `😊 表情: ${seg.expression}\n`;
            preview += `🤸 动作: ${seg.action}\n`;
            preview += `🎥 镜头: ${seg.cameraMove}\n`;
            preview += `🌆 背景: ${seg.backgroundMotion}\n\n`;
          }

          preview += `━━━━━━━━━━━━━━━━━━━━\n📄 脚本已保存: ${scriptPath}\n`;
          preview += `\n接下来可以:\n1. 调用 generate_audio 生成语音\n2. 调用 generate_video 生成视频\n3. 或直接 full_pipeline 一键完成`;

          return {
            success: true,
            message: preview,
            data: {
              scriptPath,
              script,
              segmentCount: script.segments.length,
              totalDuration: script.totalDuration,
            },
          };
        }

        // ─── 3. GENERATE AUDIO ────────────────────────────────
        case "generate_audio": {
          if (!scriptJson) {
            return { success: false, message: "❌ 需要提供 scriptJson（由 generate_script 输出的脚本JSON）" };
          }

          let script: NarrationScript;
          try {
            const parsed = JSON.parse(scriptJson);
            script = parsed.script || parsed;
          } catch {
            const resolved = path.resolve(scriptJson);
            try {
              const content = await fs.readFile(resolved, "utf-8");
              script = JSON.parse(content);
            } catch {
              return { success: false, message: `❌ 无法解析脚本: ${scriptJson}` };
            }
          }

          const segments = segmentIndex !== undefined
            ? [script.segments[segmentIndex]].filter(Boolean)
            : script.segments;

          if (segments.length === 0) {
            return { success: false, message: "❌ 没有找到要处理的段落" };
          }

          const audioFiles: string[] = [];
          const results: string[] = [];

          for (const seg of segments) {
            const audioPath = path.join(outDir, `audio_seg${seg.index}_${Date.now()}.mp3`);
            try {
              await edgeTts(seg.text, audioPath, voiceId);
              audioFiles.push(audioPath);
              results.push(`✅ 段落${seg.index + 1}: ${audioPath}`);
            } catch (err) {
              results.push(`❌ 段落${seg.index + 1}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          return {
            success: true,
            message:
              `🎙️ TTS语音生成完成\n━━━━━━━━━━━━━━━━━━━━\n` +
              `语音角色: ${voiceId}\n` +
              `处理段落: ${segments.length}段\n\n` +
              results.join("\n") +
              `\n━━━━━━━━━━━━━━━━━━━━\n📁 音频目录: ${outDir}`,
            data: { audioFiles, voiceId, segmentCount: segments.length },
          };
        }

        // ─── 4. GENERATE VIDEO ────────────────────────────────
        case "generate_video": {
          const videoCfg = getVideoApiConfig();
          if (!videoCfg) {
            return {
              success: false,
              message:
                "❌ 未配置视频生成模型。请在 .env.local 中添加:\n" +
                "QINGYUN_API_KEY=你的qingyuntop Key (推荐，支持veo3/sora-2)\n" +
                "或 APIMART_API_KEY=你的apimart.ai Key\n" +
                "或 VOLCENGINE_API_KEY=你的火山引擎Key",
            };
          }

          let imageDataUrl: string | undefined;

          if (filePath) {
            const resolved = path.resolve(filePath);
            try {
              await fs.access(resolved);
              imageDataUrl = await imageToDataUri(resolved);
            } catch {
              return { success: false, message: `❌ 人物照片不存在: ${resolved}` };
            }
          } else if (characterDesc) {
            try {
              const imgPath = await generateCharacterImage(characterDesc);
              imageDataUrl = await imageToDataUri(imgPath);
            } catch (err) {
              return {
                success: false,
                message: `⚠️ AI生成人物形象失败: ${err instanceof Error ? err.message : String(err)}\n请提供 filePath 参数上传人物照片，或检查图片生成API配置`,
              };
            }
          }

          if (!scriptJson) {
            return { success: false, message: "❌ 需要提供 scriptJson（场景脚本JSON）来生成视频" };
          }

          let script: NarrationScript;
          try {
            const parsed = JSON.parse(scriptJson);
            script = parsed.script || parsed;
          } catch {
            const resolved = path.resolve(scriptJson);
            try {
              const content = await fs.readFile(resolved, "utf-8");
              script = JSON.parse(content);
            } catch {
              return { success: false, message: `❌ 无法解析脚本: ${scriptJson}` };
            }
          }

          const segments = segmentIndex !== undefined
            ? [script.segments[segmentIndex]].filter(Boolean)
            : script.segments;

          if (segments.length === 0) {
            return { success: false, message: "❌ 没有找到要处理的段落" };
          }

          const taskIds: Array<{ segIndex: number; taskId: string; provider: string; prompt: string }> = [];
          const errors: string[] = [];

          for (const seg of segments) {
            try {
              const result = await createVideoTask(
                seg.videoPrompt,
                imageDataUrl,
                Math.min(Math.max(seg.duration, 4), 15),
                aspectRatio,
              );
              taskIds.push({ segIndex: seg.index, taskId: result.taskId, provider: result.provider, prompt: seg.videoPrompt.slice(0, 80) });
            } catch (err) {
              errors.push(`段落${seg.index + 1}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          let msg = `🎬 视频生成任务已提交\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `API: ${videoCfg.provider} (${videoCfg.defaultModel})\n`;
          msg += `人物形象: ${filePath ? "用户上传照片" : characterDesc ? "AI生成" : "无（文生视频模式）"}\n`;
          msg += `比例: ${aspectRatio}\n\n`;

          for (const t of taskIds) {
            msg += `✅ 段落${t.segIndex + 1} → 任务ID: ${t.taskId}\n   Prompt: ${t.prompt}...\n`;
          }
          for (const e of errors) {
            msg += `❌ ${e}\n`;
          }

          msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `⏳ 视频生成中（每段约2-5分钟），请使用 query_task 查询状态。\n`;
          msg += `或传入 taskId 参数调用 query_task 查看进度。`;

          return {
            success: true,
            message: msg,
            data: { taskIds, errors, imageUsed: !!imageDataUrl },
          };
        }

        // ─── 5. QUERY TASK ────────────────────────────────────
        case "query_task": {
          if (!taskId) {
            return { success: false, message: "❌ 需要提供 taskId 参数" };
          }

          const task = await queryVideoTask(taskId);
          const videoUrl = extractVideoUrl(task);

          let msg = `📋 视频任务状态\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `任务ID: ${taskId}\n`;
          msg += `状态: ${task.status}\n`;
          if (task.data?.progress) msg += `进度: ${task.data.progress}\n`;

          if (videoUrl) {
            const localPath = path.join(outDir, `video_${taskId.slice(-8)}_${Date.now()}.mp4`);
            try {
              await downloadFile(videoUrl, localPath);
              msg += `✅ 视频已下载: ${localPath}\n`;
            } catch {
              msg += `视频URL: ${videoUrl}\n(下载到本地失败，请手动下载)\n`;
            }
          }

          if (task.error?.message) {
            msg += `错误: ${task.error.message}\n`;
          }

          return {
            success: true,
            message: msg,
            data: { taskId, status: task.status, videoUrl },
          };
        }

        // ─── 6. FULL PIPELINE ─────────────────────────────────
        case "full_pipeline": {
          if (!article && !topic) {
            return { success: false, message: "❌ 需要提供 article(文章内容) 或 topic(视频主题)" };
          }

          const pipelineVideoCfg = getVideoApiConfig();
          if (!pipelineVideoCfg) {
            return {
              success: false,
              message:
                "❌ 完整流水线需要配置视频生成模型。请在 .env.local 中添加:\n" +
                "QINGYUN_API_KEY=你的qingyuntop Key (推荐)\n" +
                "或 APIMART_API_KEY=你的apimart.ai Key\n" +
                "或 VOLCENGINE_API_KEY=你的火山引擎Key\n\n" +
                "或者你可以先用 generate_script 生成脚本，再分步执行。",
            };
          }

          const textCfg = getTextModelConfig();
          if (!textCfg) {
            return { success: false, message: "❌ 未配置文本模型。请在 .env.local 中设置 DASHSCOPE_API_KEY 或 DEEPSEEK_API_KEY" };
          }

          const pipelineLog: string[] = [];
          pipelineLog.push("🚀 口播视频全流程启动");
          pipelineLog.push("━━━━━━━━━━━━━━━━━━━━");

          // Step 1: generate script
          pipelineLog.push("\n📝 步骤1/4: 生成口播话术与场景脚本...");

          const styleMap: Record<string, string> = {
            casual: "轻松日常、像朋友聊天一样",
            professional: "专业严肃、逻辑清晰",
            humorous: "幽默搞笑、段子手风格",
            emotional: "情感走心、有温度",
          };

          const scriptSystemPrompt = `你是一个顶级的抖音短视频编导，专门做口播视频内容。请生成适合抖音口播的完整脚本。

要求:
1. 话术风格: ${styleMap[style] || styleMap.casual}
2. 总时长: 45-90秒，分3-5段，每段8-12秒
3. 开头hook(抓眼球) → 核心内容 → 结尾互动引导
4. 每段包含表情/动作/镜头/背景描述

输出格式 (严格JSON):
\`\`\`json
{
  "title": "视频标题",
  "segments": [
    {
      "index": 0,
      "text": "口播文字",
      "duration": 8,
      "expression": "表情描述",
      "action": "动作描述",
      "cameraMove": "镜头运动",
      "backgroundMotion": "背景描述",
      "videoPrompt": "英文视频Prompt（包含人物表情+动作+镜头+背景+氛围）"
    }
  ]
}
\`\`\``;

          const userInput = article
            ? `将以下文章改编为抖音口播视频脚本:\n\n${article}`
            : `围绕"${topic}"主题，创作抖音口播视频脚本`;

          let script: NarrationScript;
          try {
            const rawResult = await aiGenerate(scriptSystemPrompt, userInput);
            const jsonMatch = rawResult.match(/```(?:json)?\s*([\s\S]*?)```/) || rawResult.match(/(\{[\s\S]*\})/);
            if (!jsonMatch) throw new Error("AI输出格式异常");

            const parsed = JSON.parse(jsonMatch[1].trim());
            script = {
              title: parsed.title || "口播视频",
              totalDuration: 0,
              segments: (parsed.segments || []).map((s: Record<string, unknown>, i: number) => ({
                index: i,
                text: String(s.text || ""),
                duration: Number(s.duration) || 8,
                expression: String(s.expression || ""),
                action: String(s.action || ""),
                cameraMove: String(s.cameraMove || ""),
                backgroundMotion: String(s.backgroundMotion || ""),
                videoPrompt: String(s.videoPrompt || ""),
              })),
              fullText: "",
            };
            script.totalDuration = script.segments.reduce((a, s) => a + s.duration, 0);
            script.fullText = script.segments.map((s) => s.text).join("\n");

            const scriptPath = path.join(outDir, `script_${Date.now()}.json`);
            await fs.writeFile(scriptPath, JSON.stringify(script, null, 2), "utf-8");

            pipelineLog.push(`✅ 脚本生成完成: ${script.title}`);
            pipelineLog.push(`   ${script.segments.length}个段落，总时长~${script.totalDuration}秒`);
            pipelineLog.push(`   保存: ${scriptPath}`);
          } catch (err) {
            return {
              success: false,
              message: `❌ 脚本生成失败: ${err instanceof Error ? err.message : String(err)}`,
            };
          }

          // Step 2: generate audio
          pipelineLog.push("\n🎙️ 步骤2/4: TTS语音合成...");
          const audioFiles: string[] = [];
          for (const seg of script.segments) {
            const audioPath = path.join(outDir, `audio_seg${seg.index}_${Date.now()}.mp3`);
            try {
              await edgeTts(seg.text, audioPath, voiceId);
              audioFiles.push(audioPath);
              pipelineLog.push(`   ✅ 段落${seg.index + 1} 语音生成完成`);
            } catch (err) {
              pipelineLog.push(`   ⚠️ 段落${seg.index + 1} 语音生成失败: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // Step 3: prepare character image
          pipelineLog.push("\n🧑 步骤3/4: 准备人物形象...");
          let imageDataUrl: string | undefined;
          if (filePath) {
            try {
              const resolved = path.resolve(filePath);
              await fs.access(resolved);
              imageDataUrl = await imageToDataUri(resolved);
              pipelineLog.push(`   ✅ 使用用户上传照片: ${resolved}`);
            } catch {
              pipelineLog.push(`   ⚠️ 照片文件不存在: ${filePath}，将使用文生视频模式`);
            }
          } else if (characterDesc) {
            try {
              const imgPath = await generateCharacterImage(characterDesc);
              imageDataUrl = await imageToDataUri(imgPath);
              pipelineLog.push(`   ✅ AI生成人物形象完成: ${imgPath}`);
            } catch (err) {
              pipelineLog.push(`   ⚠️ AI生成人物形象失败: ${err instanceof Error ? err.message : String(err)}`);
              pipelineLog.push(`   将使用文生视频模式（无参考图）`);
            }
          } else {
            pipelineLog.push("   ℹ️ 未提供人物照片，将使用文生视频模式");
            pipelineLog.push("   💡 提示: 下次可通过 filePath 参数上传人物照片，效果更好");
          }

          // Step 4: submit video tasks
          pipelineLog.push(`\n🎬 步骤4/4: 提交视频生成任务 (${pipelineVideoCfg.provider} / ${pipelineVideoCfg.defaultModel})...`);
          const videoTasks: Array<{ segIndex: number; taskId: string }> = [];
          for (const seg of script.segments) {
            try {
              const result = await createVideoTask(
                seg.videoPrompt,
                imageDataUrl,
                Math.min(Math.max(seg.duration, 4), 15),
                aspectRatio,
              );
              videoTasks.push({ segIndex: seg.index, taskId: result.taskId });
              pipelineLog.push(`   ✅ 段落${seg.index + 1} 任务已提交: ${result.taskId}`);
            } catch (err) {
              pipelineLog.push(`   ❌ 段落${seg.index + 1} 提交失败: ${err instanceof Error ? err.message : String(err)}`);
            }
          }

          // Summary
          pipelineLog.push("\n━━━━━━━━━━━━━━━━━━━━");
          pipelineLog.push("📊 执行报告");
          pipelineLog.push(`   标题: ${script.title}`);
          pipelineLog.push(`   段落: ${script.segments.length}段`);
          pipelineLog.push(`   语音: ${audioFiles.length}/${script.segments.length} 完成`);
          pipelineLog.push(`   视频: ${videoTasks.length}/${script.segments.length} 任务已提交`);
          pipelineLog.push(`   输出目录: ${outDir}`);
          pipelineLog.push("");
          pipelineLog.push("⏳ 视频生成需要2-5分钟/段，请使用 query_task 查询进度。");

          if (videoTasks.length > 0) {
            pipelineLog.push("\n视频任务ID列表:");
            for (const t of videoTasks) {
              pipelineLog.push(`   段落${t.segIndex + 1}: ${t.taskId}`);
            }
          }

          return {
            success: true,
            message: pipelineLog.join("\n"),
            data: {
              script,
              audioFiles,
              videoTasks,
              outputDir: outDir,
            },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return {
        success: false,
        message: `操作异常: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
