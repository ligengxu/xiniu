import { z } from "zod";
import type { SkillDefinition } from "../types";

const VOICE_MAP: Record<string, { voice: string; label: string }> = {
  "男声": { voice: "zh-CN-YunxiNeural", label: "云希（男声）" },
  "女声": { voice: "zh-CN-XiaoxiaoNeural", label: "晓晓（女声）" },
  "男播音": { voice: "zh-CN-YunjianNeural", label: "云健（男播音）" },
  "女播音": { voice: "zh-CN-XiaoyiNeural", label: "晓伊（女播音）" },
  "粤语": { voice: "zh-HK-HiuMaanNeural", label: "晓曼（粤语）" },
  "台湾": { voice: "zh-TW-HsiaoChenNeural", label: "晓臻（台湾）" },
  "英语男": { voice: "en-US-GuyNeural", label: "Guy（英语男）" },
  "英语女": { voice: "en-US-JennyNeural", label: "Jenny（英语女）" },
  "日语": { voice: "ja-JP-NanamiNeural", label: "Nanami（日语）" },
  "韩语": { voice: "ko-KR-SunHiNeural", label: "SunHi（韩语）" },
};

export const textToSpeechSkill: SkillDefinition = {
  name: "text_to_speech",
  displayName: "文字转语音",
  description:
    "将文字转换为语音MP3文件，使用Edge TTS引擎。支持多种中英文声音、语速和音调调节。" +
    "用户说'朗读'、'语音合成'、'转语音'、'TTS'、'读出来'时使用。",
  icon: "Volume2",
  category: "creative",
  parameters: z.object({
    text: z.string().describe("要转换的文字内容"),
    voice: z.string().optional().describe("声音选择: 男声/女声/男播音/女播音/粤语/台湾/英语男/英语女/日语/韩语，默认'女声'"),
    rate: z.string().optional().describe("语速调节，如'+20%'、'-10%'，默认'+0%'"),
    pitch: z.string().optional().describe("音调调节，如'+5Hz'、'-10Hz'，默认'+0Hz'"),
    savePath: z.string().optional().describe("保存路径（含文件名），默认桌面"),
  }),
  execute: async (params) => {
    const { text, voice: voiceKey, rate, pitch, savePath } = params as {
      text: string; voice?: string; rate?: string; pitch?: string; savePath?: string;
    };

    if (!text?.trim()) return { success: false, message: "❌ 请提供要转换的文字" };

    try {
      const path = await import("path");
      const fs = await import("fs");
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);

      const voiceEntry = VOICE_MAP[voiceKey || "女声"] || VOICE_MAP["女声"];
      const voiceName = voiceEntry.voice;
      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", `tts_${Date.now()}.mp3`);

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const rateStr = rate || "+0%";
      const pitchStr = pitch || "+0Hz";

      try {
        await execFileAsync("edge-tts", [
          "--voice", voiceName,
          "--rate", rateStr,
          "--pitch", pitchStr,
          "--text", text,
          "--write-media", outputPath,
        ], { timeout: 60000, windowsHide: true });
      } catch {
        await execFileAsync("npx", [
          "-y", "edge-tts-cli",
          "--voice", voiceName,
          "--rate", rateStr,
          "--pitch", pitchStr,
          "--text", text,
          "--write-media", outputPath,
        ], { timeout: 120000, windowsHide: true, shell: true });
      }

      if (!fs.existsSync(outputPath)) {
        return { success: false, message: "❌ 语音生成失败，输出文件未创建" };
      }

      const stat = fs.statSync(outputPath);
      const sizeKB = (stat.size / 1024).toFixed(1);
      const charCount = text.length;

      let msg = `🔊 语音合成完成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📝 文字: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}\n`;
      msg += `🎙️ 声音: ${voiceEntry.label}\n`;
      msg += `⚡ 语速: ${rateStr} | 音调: ${pitchStr}\n`;
      msg += `📊 字符数: ${charCount} | 文件: ${sizeKB}KB\n`;
      msg += `📁 保存: ${outputPath}`;

      return { success: true, message: msg, data: { path: outputPath, size: stat.size, chars: charCount } };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `❌ 语音合成失败: ${errMsg}\n\n💡 请先安装 edge-tts:\n  pip install edge-tts\n或\n  npm install -g edge-tts-cli`,
      };
    }
  },
};
