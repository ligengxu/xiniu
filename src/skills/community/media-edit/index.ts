import { z } from "zod";
import type { SkillDefinition } from "../types";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";

const execAsync = promisify(exec);
const DESKTOP = "C:\\Users\\Administrator\\Desktop";

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function ffprobeAvailable(): Promise<boolean> {
  try {
    await execAsync("ffprobe -version", { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

interface MediaInfo {
  format: string;
  duration: string;
  size: string;
  bitrate: string;
  videoCodec?: string;
  videoResolution?: string;
  videoFps?: string;
  audioCodec?: string;
  audioSampleRate?: string;
  audioChannels?: string;
}

async function getMediaInfo(filePath: string): Promise<MediaInfo | null> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`,
      { timeout: 30000 },
    );
    const data = JSON.parse(stdout) as {
      format?: {
        format_name?: string; duration?: string; size?: string; bit_rate?: string;
      };
      streams?: Array<{
        codec_type?: string; codec_name?: string; width?: number; height?: number;
        r_frame_rate?: string; sample_rate?: string; channels?: number;
      }>;
    };

    const fmt = data.format || {};
    const videoStream = data.streams?.find(s => s.codec_type === "video");
    const audioStream = data.streams?.find(s => s.codec_type === "audio");

    const durationSec = parseFloat(fmt.duration || "0");
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const s = Math.floor(durationSec % 60);
    const durationStr = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;

    const sizeBytes = parseInt(fmt.size || "0");
    let sizeStr: string;
    if (sizeBytes > 1_073_741_824) sizeStr = (sizeBytes / 1_073_741_824).toFixed(2) + " GB";
    else if (sizeBytes > 1_048_576) sizeStr = (sizeBytes / 1_048_576).toFixed(2) + " MB";
    else sizeStr = (sizeBytes / 1024).toFixed(1) + " KB";

    let fps: string | undefined;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
      if (den && den > 0) fps = (num / den).toFixed(2);
    }

    return {
      format: fmt.format_name || "unknown",
      duration: durationStr,
      size: sizeStr,
      bitrate: fmt.bit_rate ? (parseInt(fmt.bit_rate) / 1000).toFixed(0) + " kbps" : "unknown",
      videoCodec: videoStream?.codec_name,
      videoResolution: videoStream ? `${videoStream.width}x${videoStream.height}` : undefined,
      videoFps: fps,
      audioCodec: audioStream?.codec_name,
      audioSampleRate: audioStream?.sample_rate ? audioStream.sample_rate + " Hz" : undefined,
      audioChannels: audioStream?.channels ? String(audioStream.channels) : undefined,
    };
  } catch {
    return null;
  }
}

function ensureOutputDir(name: string): string {
  const dir = path.join(DESKTOP, `output-${name}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function generateOutputPath(inputPath: string, suffix: string, ext?: string): string {
  const dir = ensureOutputDir("media");
  const base = path.basename(inputPath, path.extname(inputPath));
  const finalExt = ext || path.extname(inputPath);
  return path.join(dir, `${base}-${suffix}${finalExt}`);
}

async function runFFmpeg(args: string, timeoutMs = 300_000): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(`ffmpeg -y ${args}`, { timeout: timeoutMs });
    return { ok: true, output: stdout || stderr };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, output: msg };
  }
}

function parseTimeRange(time: string): string {
  if (/^\d+(\.\d+)?$/.test(time)) return time;
  if (/^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(time)) return time;
  return time;
}

export const mediaEditSkill: SkillDefinition = {
  name: "media_edit",
  displayName: "音视频编辑",
  description: `FFmpeg 驱动的音视频编辑工具。支持：获取媒体信息(info)、剪切片段(cut)、合并多个文件(merge)、转码/格式转换(convert)、提取音频(extract_audio)、提取视频/去音(remove_audio)、加字幕(add_subtitle)、调整速度(speed)、调整音量(volume)、截取封面/缩略图(thumbnail)、GIF生成(gif)、添加水印(watermark)、旋转/翻转(rotate)、调整分辨率(resize)。用户说'剪视频'、'合并视频'、'转码'、'提取音频'、'加字幕'、'视频编辑'、'音频编辑'、'ffmpeg'、'格式转换'、'视频转mp4'、'音频转mp3'、'视频加速'、'GIF'、'水印'时使用。`,
  icon: "Film",
  category: "creative",
  parameters: z.object({
    action: z.enum([
      "info", "cut", "merge", "convert", "extract_audio", "remove_audio",
      "add_subtitle", "speed", "volume", "thumbnail", "gif", "watermark",
      "rotate", "resize",
    ]).describe("操作类型"),
    input: z.string().describe("输入文件路径"),
    output: z.string().optional().describe("输出文件路径（可选，自动生成）"),
    startTime: z.string().optional().describe("开始时间（cut/gif），格式: 秒数 或 HH:MM:SS"),
    endTime: z.string().optional().describe("结束时间（cut/gif），格式: 秒数 或 HH:MM:SS"),
    duration: z.string().optional().describe("持续时长（cut/gif），格式: 秒数 或 HH:MM:SS"),
    format: z.string().optional().describe("输出格式（convert），如 mp4/mp3/wav/avi/mkv/flac/webm"),
    files: z.array(z.string()).optional().describe("多个输入文件路径（merge 操作）"),
    subtitleFile: z.string().optional().describe("字幕文件路径（add_subtitle），支持 .srt/.ass/.ssa"),
    speedFactor: z.number().optional().describe("速度倍率（speed），0.5=半速 2=两倍速"),
    volumeFactor: z.string().optional().describe("音量调整（volume），如 '2.0'=两倍 '0.5'=一半 或 dB值如 '+10dB'"),
    time: z.string().optional().describe("截取时间点（thumbnail），格式: 秒数 或 HH:MM:SS"),
    fps: z.number().optional().describe("帧率（gif），默认10"),
    width: z.number().optional().describe("宽度（gif/resize/watermark）"),
    height: z.number().optional().describe("高度（resize），-1=自动保持比例"),
    watermarkFile: z.string().optional().describe("水印图片路径（watermark）"),
    position: z.string().optional().describe("水印位置（watermark）：topleft/topright/bottomleft/bottomright/center"),
    angle: z.number().optional().describe("旋转角度（rotate）：90/180/270"),
    codec: z.string().optional().describe("指定编码器（convert），如 libx264/libx265/aac/libmp3lame"),
    bitrate: z.string().optional().describe("指定码率（convert），如 '2M'/'128k'"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;
    const input = p.input as string;

    if (!(await ffmpegAvailable())) {
      return {
        success: false,
        message: "❌ FFmpeg 未安装或不在 PATH 中\n\n安装方法：\n1. 下载: https://ffmpeg.org/download.html\n2. Windows: 解压后将 bin 目录添加到系统 PATH\n3. 或使用 choco install ffmpeg / scoop install ffmpeg",
      };
    }

    try {
      if (action === "info") {
        if (!(await ffprobeAvailable())) {
          return { success: false, message: "❌ ffprobe 未安装（通常随 FFmpeg 一起安装）" };
        }
        if (!fs.existsSync(input)) {
          return { success: false, message: `❌ 文件不存在: ${input}` };
        }
        const info = await getMediaInfo(input);
        if (!info) return { success: false, message: "❌ 无法获取媒体信息" };

        const lines = [
          `🎬 媒体信息`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📁 文件: ${path.basename(input)}`,
          `📦 格式: ${info.format}`,
          `⏱️ 时长: ${info.duration}`,
          `💾 大小: ${info.size}`,
          `📊 码率: ${info.bitrate}`,
        ];
        if (info.videoCodec) {
          lines.push(``, `🎥 视频流:`, `  编码: ${info.videoCodec}`, `  分辨率: ${info.videoResolution}`, `  帧率: ${info.videoFps} fps`);
        }
        if (info.audioCodec) {
          lines.push(``, `🔊 音频流:`, `  编码: ${info.audioCodec}`, `  采样率: ${info.audioSampleRate}`, `  声道: ${info.audioChannels}`);
        }
        return { success: true, message: lines.join("\n"), data: info as unknown as Record<string, unknown> };
      }

      if (!fs.existsSync(input)) {
        return { success: false, message: `❌ 输入文件不存在: ${input}` };
      }

      if (action === "cut") {
        const start = p.startTime as string | undefined;
        const end = p.endTime as string | undefined;
        const dur = p.duration as string | undefined;
        if (!start) return { success: false, message: "❌ 剪切操作需要 startTime 参数" };
        if (!end && !dur) return { success: false, message: "❌ 剪切操作需要 endTime 或 duration 参数" };

        const outPath = (p.output as string) || generateOutputPath(input, "cut");
        let args = `-i "${input}" -ss ${parseTimeRange(start)}`;
        if (end) args += ` -to ${parseTimeRange(end)}`;
        else if (dur) args += ` -t ${parseTimeRange(dur)}`;
        args += ` -c copy "${outPath}"`;

        const result = await runFFmpeg(args);
        if (!result.ok) return { success: false, message: `❌ 剪切失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `✂️ 剪切完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n⏱️ 范围: ${start} → ${end || `+${dur}`}` };
      }

      if (action === "merge") {
        const files = p.files as string[] | undefined;
        const allFiles = files && files.length > 0 ? [input, ...files] : [input];
        if (allFiles.length < 2) return { success: false, message: "❌ 合并操作至少需要 2 个文件（input + files 数组）" };

        for (const f of allFiles) {
          if (!fs.existsSync(f)) return { success: false, message: `❌ 文件不存在: ${f}` };
        }

        const outPath = (p.output as string) || generateOutputPath(input, "merged");
        const listFile = path.join(ensureOutputDir("media"), "_merge_list.txt");
        const listContent = allFiles.map(f => `file '${f.replace(/\\/g, "/")}'`).join("\n");
        fs.writeFileSync(listFile, listContent, "utf-8");

        const result = await runFFmpeg(`-f concat -safe 0 -i "${listFile}" -c copy "${outPath}"`);
        try { fs.unlinkSync(listFile); } catch { /* ignore */ }
        if (!result.ok) return { success: false, message: `❌ 合并失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔗 合并完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${allFiles.length} 个文件\n📤 输出: ${outPath}` };
      }

      if (action === "convert") {
        const format = p.format as string | undefined;
        if (!format) return { success: false, message: "❌ 转码操作需要 format 参数（如 mp4/mp3/wav/avi）" };

        const outPath = (p.output as string) || generateOutputPath(input, "converted", `.${format}`);
        let args = `-i "${input}"`;
        if (p.codec) args += ` -c:v ${p.codec}`;
        if (p.bitrate) args += ` -b:v ${p.bitrate}`;
        args += ` "${outPath}"`;

        const result = await runFFmpeg(args, 600_000);
        if (!result.ok) return { success: false, message: `❌ 转码失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔄 转码完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n🎯 格式: ${format}` };
      }

      if (action === "extract_audio") {
        const format = (p.format as string) || "mp3";
        const outPath = (p.output as string) || generateOutputPath(input, "audio", `.${format}`);
        const result = await runFFmpeg(`-i "${input}" -vn -q:a 2 "${outPath}"`);
        if (!result.ok) return { success: false, message: `❌ 提取音频失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔊 音频提取完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}` };
      }

      if (action === "remove_audio") {
        const outPath = (p.output as string) || generateOutputPath(input, "noaudio");
        const result = await runFFmpeg(`-i "${input}" -an -c:v copy "${outPath}"`);
        if (!result.ok) return { success: false, message: `❌ 去除音频失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔇 去除音频完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}` };
      }

      if (action === "add_subtitle") {
        const subFile = p.subtitleFile as string | undefined;
        if (!subFile) return { success: false, message: "❌ 加字幕需要 subtitleFile 参数" };
        if (!fs.existsSync(subFile)) return { success: false, message: `❌ 字幕文件不存在: ${subFile}` };

        const outPath = (p.output as string) || generateOutputPath(input, "subtitled");
        const ext = path.extname(subFile).toLowerCase();
        let args: string;
        if (ext === ".ass" || ext === ".ssa") {
          args = `-i "${input}" -vf "ass='${subFile.replace(/\\/g, "/").replace(/'/g, "\\'")}'" "${outPath}"`;
        } else {
          args = `-i "${input}" -vf "subtitles='${subFile.replace(/\\/g, "/").replace(/'/g, "\\'")}'" "${outPath}"`;
        }
        const result = await runFFmpeg(args, 600_000);
        if (!result.ok) return { success: false, message: `❌ 加字幕失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `💬 字幕添加完成\n━━━━━━━━━━━━━━━━━━━━\n📥 视频: ${path.basename(input)}\n📝 字幕: ${path.basename(subFile)}\n📤 输出: ${outPath}` };
      }

      if (action === "speed") {
        const factor = p.speedFactor as number | undefined;
        if (!factor || factor <= 0) return { success: false, message: "❌ 速度倍率 speedFactor 必须大于 0（如 0.5=半速, 2=两倍速）" };

        const outPath = (p.output as string) || generateOutputPath(input, `speed${factor}x`);
        const videoFilter = `setpts=${(1 / factor).toFixed(4)}*PTS`;
        const audioFilter = `atempo=${factor <= 0.5 ? 0.5 : factor >= 2 ? 2 : factor}`;
        let aFilter = audioFilter;
        if (factor > 2) {
          const times = Math.ceil(Math.log2(factor));
          aFilter = Array(times).fill("atempo=2.0").join(",");
        } else if (factor < 0.5) {
          const times = Math.ceil(Math.log2(1 / factor));
          aFilter = Array(times).fill("atempo=0.5").join(",");
        }

        const result = await runFFmpeg(`-i "${input}" -filter:v "${videoFilter}" -filter:a "${aFilter}" "${outPath}"`, 600_000);
        if (!result.ok) return { success: false, message: `❌ 变速失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `⏩ 变速完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n🎚️ 速度: ${factor}x` };
      }

      if (action === "volume") {
        const vol = p.volumeFactor as string | undefined;
        if (!vol) return { success: false, message: "❌ 需要 volumeFactor 参数（如 '2.0'=两倍, '0.5'=一半, '+10dB'）" };

        const outPath = (p.output as string) || generateOutputPath(input, "vol");
        const result = await runFFmpeg(`-i "${input}" -af "volume=${vol}" -c:v copy "${outPath}"`);
        if (!result.ok) return { success: false, message: `❌ 音量调整失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔊 音量调整完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n🎚️ 音量: ${vol}` };
      }

      if (action === "thumbnail") {
        const time = (p.time as string) || "1";
        const outPath = (p.output as string) || generateOutputPath(input, "thumb", ".png");
        const result = await runFFmpeg(`-i "${input}" -ss ${parseTimeRange(time)} -vframes 1 "${outPath}"`);
        if (!result.ok) return { success: false, message: `❌ 截取缩略图失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🖼️ 缩略图截取完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n⏱️ 时间点: ${time}` };
      }

      if (action === "gif") {
        const start = p.startTime as string | undefined;
        const dur = p.duration as string | undefined;
        const fps = (p.fps as number) || 10;
        const width = (p.width as number) || 480;

        const outPath = (p.output as string) || generateOutputPath(input, "gif", ".gif");
        let args = `-i "${input}"`;
        if (start) args += ` -ss ${parseTimeRange(start)}`;
        if (dur) args += ` -t ${parseTimeRange(dur)}`;
        args += ` -vf "fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${outPath}"`;

        const result = await runFFmpeg(args, 120_000);
        if (!result.ok) return { success: false, message: `❌ GIF 生成失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🎞️ GIF 生成完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n🎯 帧率: ${fps}fps, 宽度: ${width}px` };
      }

      if (action === "watermark") {
        const wmFile = p.watermarkFile as string | undefined;
        if (!wmFile) return { success: false, message: "❌ 需要 watermarkFile 水印图片路径" };
        if (!fs.existsSync(wmFile)) return { success: false, message: `❌ 水印文件不存在: ${wmFile}` };

        const pos = (p.position as string) || "bottomright";
        const posMap: Record<string, string> = {
          topleft: "10:10",
          topright: "main_w-overlay_w-10:10",
          bottomleft: "10:main_h-overlay_h-10",
          bottomright: "main_w-overlay_w-10:main_h-overlay_h-10",
          center: "(main_w-overlay_w)/2:(main_h-overlay_h)/2",
        };
        const overlay = posMap[pos] || posMap.bottomright;

        const outPath = (p.output as string) || generateOutputPath(input, "watermarked");
        const result = await runFFmpeg(`-i "${input}" -i "${wmFile}" -filter_complex "overlay=${overlay}" "${outPath}"`, 600_000);
        if (!result.ok) return { success: false, message: `❌ 水印添加失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `💧 水印添加完成\n━━━━━━━━━━━━━━━━━━━━\n📥 视频: ${path.basename(input)}\n🖼️ 水印: ${path.basename(wmFile)}\n📍 位置: ${pos}\n📤 输出: ${outPath}` };
      }

      if (action === "rotate") {
        const angle = p.angle as number | undefined;
        if (!angle || ![90, 180, 270].includes(angle)) {
          return { success: false, message: "❌ 旋转角度必须是 90/180/270" };
        }

        const transposeMap: Record<number, string> = {
          90: "transpose=1",
          180: "transpose=1,transpose=1",
          270: "transpose=2",
        };
        const outPath = (p.output as string) || generateOutputPath(input, `rot${angle}`);
        const result = await runFFmpeg(`-i "${input}" -vf "${transposeMap[angle]}" "${outPath}"`, 600_000);
        if (!result.ok) return { success: false, message: `❌ 旋转失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `🔄 旋转完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n📐 角度: ${angle}°` };
      }

      if (action === "resize") {
        const w = p.width as number | undefined;
        const h = p.height as number | undefined;
        if (!w) return { success: false, message: "❌ 调整分辨率需要 width 参数（height 可选，-1=自动）" };

        const hVal = h || -1;
        const outPath = (p.output as string) || generateOutputPath(input, `${w}x${hVal === -1 ? "auto" : hVal}`);
        const result = await runFFmpeg(`-i "${input}" -vf "scale=${w}:${hVal}" -c:a copy "${outPath}"`, 600_000);
        if (!result.ok) return { success: false, message: `❌ 调整分辨率失败:\n${result.output.slice(0, 500)}` };
        return { success: true, message: `📐 分辨率调整完成\n━━━━━━━━━━━━━━━━━━━━\n📥 输入: ${path.basename(input)}\n📤 输出: ${outPath}\n🎯 分辨率: ${w}x${hVal === -1 ? "auto" : hVal}` };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ 媒体编辑异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
