import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const VOICE_MAP: Record<string, string> = {
  mandarin:    "zh-CN-XiaoxiaoNeural",
  cantonese:   "zh-HK-HiuGaaiNeural",
  taiwanese:   "zh-TW-HsiaoChenNeural",
  sichuanese:  "zh-CN-XiaoxiaoNeural",
  shanghainese:"zh-CN-XiaoxiaoNeural",
  hokkien:     "zh-TW-HsiaoChenNeural",
  english:     "en-US-JennyNeural",
  japanese:    "ja-JP-NanamiNeural",
  korean:      "ko-KR-SunHiNeural",
};

const CACHE_DIR = path.join(os.tmpdir(), "xiniu-tts-cache");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheKey(text: string, voice: string, rate: string): string {
  const hash = crypto.createHash("md5").update(`${voice}|${rate}|${text}`).digest("hex");
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);
}

function edgeTtsGenerate(text: string, voice: string, rate: string, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-m", "edge_tts",
      "--text", text,
      "--voice", voice,
      "--rate", rate,
      "--write-media", outFile,
    ];

    const proc = spawn("python", args, {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });

    let stderr = "";
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && fs.existsSync(outFile) && fs.statSync(outFile).size > 0) {
        resolve();
      } else {
        reject(new Error(`edge-tts exited ${code}: ${stderr}`));
      }
    });

    proc.on("error", reject);

    setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error("TTS generation timed out (30s)"));
    }, 30000);
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, dialectId, rate } = body as {
      text?: string;
      dialectId?: string;
      rate?: number;
    };

    if (!text || !text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const cleanedText = cleanText(text);
    if (!cleanedText) {
      return NextResponse.json({ error: "text is empty after cleaning" }, { status: 400 });
    }

    const voice = VOICE_MAP[dialectId || "mandarin"] || VOICE_MAP.mandarin;
    const rateStr = rate && rate !== 1.0
      ? `${rate > 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`
      : "+0%";

    ensureCacheDir();
    const cacheFile = getCacheKey(cleanedText, voice, rateStr);

    if (!fs.existsSync(cacheFile)) {
      await edgeTtsGenerate(cleanedText, voice, rateStr, cacheFile);
    }

    const audioBuffer = fs.readFileSync(cacheFile);

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[TTS API Error]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
