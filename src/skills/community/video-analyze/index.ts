import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

const FRAMES_DIR = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".xiniu", "video-frames");

function runCmd(cmd: string, args: string[], timeout = 60000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { timeout, shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
  });
}

async function checkFfmpeg(): Promise<boolean> {
  const r = await runCmd("ffmpeg", ["-version"], 5000);
  return r.ok;
}

async function checkFfprobe(): Promise<boolean> {
  const r = await runCmd("ffprobe", ["-version"], 5000);
  return r.ok;
}

export const videoAnalyzeSkill: SkillDefinition = {
  name: "video_analyze",
  displayName: "视频分析",
  description:
    "分析本地视频文件：获取元数据、AI智能分析视频内容(自动提取关键帧+多模态识别)、提取关键帧、提取音频、裁剪片段、转换格式。依赖FFmpeg。用户说'分析视频'、'视频信息'、'提取帧'、'视频截图'、'转码'、'视频里有什么'时使用。",
  icon: "Film",
  category: "creative",
  parameters: z.object({
    filePath: z.string().describe("视频文件路径"),
    action: z.enum(["info", "ai_analyze", "extract_frames", "extract_audio", "clip", "convert", "thumbnail"])
      .describe("操作: info=获取元数据, ai_analyze=AI分析视频内容(推荐), extract_frames=提取关键帧, extract_audio=提取音频, clip=裁剪片段, convert=转码, thumbnail=生成缩略图"),
    startTime: z.string().optional().describe("clip起始时间(格式: HH:MM:SS 或秒数，如 00:01:30 或 90)"),
    endTime: z.string().optional().describe("clip结束时间"),
    outputFormat: z.string().optional().describe("convert输出格式(如 mp4/avi/mkv/mp3/gif)"),
    outputPath: z.string().optional().describe("输出文件路径"),
    frameCount: z.number().optional().describe("extract_frames/ai_analyze提取帧数量，默认5"),
    frameInterval: z.number().optional().describe("extract_frames帧间隔秒数(与frameCount二选一)"),
    question: z.string().optional().describe("ai_analyze: 关于视频的具体问题"),
  }),
  execute: async (params) => {
    const {
      filePath, action,
      startTime, endTime,
      outputFormat, outputPath,
      frameCount = 5, frameInterval,
      question,
    } = params as {
      filePath: string; action: string;
      startTime?: string; endTime?: string;
      outputFormat?: string; outputPath?: string;
      frameCount?: number; frameInterval?: number;
      question?: string;
    };

    const resolved = path.resolve(filePath);

    try {
      await fs.access(resolved);
    } catch {
      return { success: false, message: `❌ 文件不存在: ${resolved}` };
    }

    const hasFfmpeg = await checkFfmpeg();
    const hasFfprobe = await checkFfprobe();

    if (!hasFfmpeg || !hasFfprobe) {
      return {
        success: false,
        message: `❌ 需要安装 FFmpeg\n安装方法:\n  Windows: choco install ffmpeg 或 scoop install ffmpeg\n  下载地址: https://ffmpeg.org/download.html\n\n安装后重试。`,
      };
    }

    try {
      switch (action) {
        case "info": {
          const r = await runCmd("ffprobe", [
            "-v", "quiet", "-print_format", "json",
            "-show_format", "-show_streams", resolved,
          ], 30000);

          if (!r.ok) {
            return { success: false, message: `❌ 视频分析失败: ${r.stderr}` };
          }

          try {
            const probe = JSON.parse(r.stdout);
            const fmt = probe.format || {};
            const videoStream = (probe.streams || []).find((s: Record<string, unknown>) => s.codec_type === "video");
            const audioStream = (probe.streams || []).find((s: Record<string, unknown>) => s.codec_type === "audio");

            const duration = parseFloat(fmt.duration || "0");
            const mins = Math.floor(duration / 60);
            const secs = Math.floor(duration % 60);
            const sizeBytes = parseInt(fmt.size || "0");
            const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(1);
            const bitrate = fmt.bit_rate ? `${(parseInt(fmt.bit_rate) / 1000).toFixed(0)}kbps` : "N/A";

            let report = `🎬 视频信息: ${path.basename(resolved)}\n`;
            report += `━━━━━━━━━━━━━━━━━━━━\n`;
            report += `⏱️ 时长: ${mins}分${secs}秒 (${duration.toFixed(1)}s)\n`;
            report += `💾 大小: ${sizeMB}MB\n`;
            report += `📊 比特率: ${bitrate}\n`;
            report += `📁 格式: ${fmt.format_long_name || fmt.format_name}\n`;

            if (videoStream) {
              report += `\n🎥 视频轨道:\n`;
              report += `  编码: ${videoStream.codec_name} (${videoStream.codec_long_name})\n`;
              report += `  分辨率: ${videoStream.width}×${videoStream.height}\n`;
              report += `  帧率: ${videoStream.r_frame_rate}\n`;
              report += `  色彩空间: ${videoStream.pix_fmt}\n`;
            }

            if (audioStream) {
              report += `\n🔊 音频轨道:\n`;
              report += `  编码: ${audioStream.codec_name}\n`;
              report += `  采样率: ${audioStream.sample_rate}Hz\n`;
              report += `  声道: ${audioStream.channels}ch\n`;
              report += `  比特率: ${audioStream.bit_rate ? `${(parseInt(audioStream.bit_rate as string) / 1000).toFixed(0)}kbps` : "N/A"}\n`;
            }

            return {
              success: true,
              message: report,
              data: {
                path: resolved,
                duration,
                sizeMB: parseFloat(sizeMB),
                width: videoStream?.width,
                height: videoStream?.height,
                codec: videoStream?.codec_name,
                fps: videoStream?.r_frame_rate,
                audioCodec: audioStream?.codec_name,
                bitrate: fmt.bit_rate,
              },
            };
          } catch {
            return { success: true, message: `视频探测原始输出:\n${r.stdout.slice(0, 2000)}`, data: { raw: r.stdout.slice(0, 2000) } };
          }
        }

        case "ai_analyze": {
          const tmpDir = path.join(FRAMES_DIR, `ai_${Date.now()}`);
          await fs.mkdir(tmpDir, { recursive: true });

          const probeR = await runCmd("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", resolved], 15000);
          let duration = 30;
          try { duration = parseFloat(JSON.parse(probeR.stdout).format?.duration || "30"); } catch { /* ok */ }

          const count = Math.min(frameCount, 8);
          const interval = Math.max(1, Math.floor(duration / (count + 1)));

          const extractR = await runCmd("ffmpeg", [
            "-i", resolved, "-vf", `fps=1/${interval}`, "-frames:v", String(count),
            "-q:v", "2", path.join(tmpDir, "frame_%03d.jpg"),
          ], 60000);

          if (!extractR.ok) {
            return { success: false, message: `关键帧提取失败: ${extractR.stderr.slice(0, 500)}` };
          }

          const frameFiles = (await fs.readdir(tmpDir)).filter((f) => f.endsWith(".jpg")).sort();

          const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";
          if (!apiKey) {
            let msg = `视频关键帧已提取 (${frameFiles.length}帧)\n━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `视频时长: ${duration.toFixed(1)}s | 帧间隔: ${interval}s\n`;
            msg += `帧文件目录: ${tmpDir}\n\n`;
            frameFiles.forEach((f, i) => { msg += `帧${i + 1}: ${path.join(tmpDir, f)}\n`; });
            msg += `\n注意: 未配置AI API密钥，无法进行智能分析。\n请在.env.local中设置 DASHSCOPE_API_KEY`;
            return { success: true, message: msg, data: { framesDir: tmpDir, frames: frameFiles, duration } };
          }

          const frameContents: Array<{ type: string; image_url: { url: string } }> = [];
          for (const f of frameFiles.slice(0, 6)) {
            const buf = await fs.readFile(path.join(tmpDir, f));
            if (buf.length > 2 * 1024 * 1024) continue;
            frameContents.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` } });
          }

          if (frameContents.length === 0) {
            return { success: false, message: "关键帧图片过大或无法读取" };
          }

          const prompt = question || `这是一个视频的${frameContents.length}个关键帧截图（按时间顺序排列，间隔${interval}秒）。请分析:\n1. 视频的主要内容和主题\n2. 场景变化和镜头语言\n3. 画面中的人物/物体\n4. 整体风格和氛围\n5. 如果是教学/演示视频，总结关键步骤`;

          try {
            const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: "qwen-vl-plus",
                messages: [{ role: "user", content: [...frameContents, { type: "text", text: prompt }] }],
                max_tokens: 2000,
              }),
              signal: AbortSignal.timeout(90000),
            });

            if (!resp.ok) {
              const errText = await resp.text();
              return { success: false, message: `AI分析失败 (${resp.status}): ${errText.slice(0, 500)}` };
            }

            const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
            const analysis = result.choices?.[0]?.message?.content || "无法获取分析结果";

            let msg = `AI视频分析: ${path.basename(resolved)}\n━━━━━━━━━━━━━━━━━━━━\n`;
            msg += `时长: ${duration.toFixed(1)}s | 分析帧数: ${frameContents.length}\n\n`;
            msg += analysis;
            msg += `\n\n关键帧保存在: ${tmpDir}`;

            return { success: true, message: msg, data: { framesDir: tmpDir, duration, frameCount: frameContents.length, analysis } };
          } catch (err) {
            return { success: false, message: `AI分析异常: ${err instanceof Error ? err.message : String(err)}` };
          }
        }

        case "extract_frames": {
          await fs.mkdir(FRAMES_DIR, { recursive: true });
          const baseName = path.basename(resolved, path.extname(resolved));
          const outPattern = path.join(FRAMES_DIR, `${baseName}_frame_%04d.jpg`);

          let args: string[];
          if (frameInterval) {
            args = ["-i", resolved, "-vf", `fps=1/${frameInterval}`, "-q:v", "2", outPattern];
          } else {
            const probeR = await runCmd("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", resolved], 15000);
            const totalDuration = parseFloat(probeR.stdout.trim()) || 60;
            const interval = Math.max(1, Math.floor(totalDuration / frameCount));
            args = ["-i", resolved, "-vf", `fps=1/${interval}`, "-q:v", "2", "-frames:v", String(frameCount), outPattern];
          }

          const r = await runCmd("ffmpeg", ["-y", ...args], 120000);
          if (!r.ok) {
            return { success: false, message: `❌ 帧提取失败: ${r.stderr.slice(0, 500)}` };
          }

          const files = (await fs.readdir(FRAMES_DIR)).filter((f) => f.startsWith(`${baseName}_frame_`));
          return {
            success: true,
            message: `✅ 已提取 ${files.length} 帧\n📁 保存目录: ${FRAMES_DIR}\n📄 文件:\n${files.map((f) => `  - ${f}`).join("\n")}`,
            data: { framesDir: FRAMES_DIR, files, count: files.length },
          };
        }

        case "extract_audio": {
          const ext = outputFormat || "mp3";
          const outFile = outputPath || path.join(path.dirname(resolved), `${path.basename(resolved, path.extname(resolved))}.${ext}`);

          const codecMap: Record<string, string> = { mp3: "libmp3lame", wav: "pcm_s16le", aac: "aac", flac: "flac", ogg: "libvorbis" };
          const codec = codecMap[ext] || "copy";
          const args = ["-y", "-i", resolved, "-vn", "-acodec", codec];
          if (ext === "mp3" || ext === "ogg") args.push("-q:a", "2");
          args.push(outFile);
          const r = await runCmd("ffmpeg", args, 120000);
          if (!r.ok) {
            return { success: false, message: `❌ 音频提取失败: ${r.stderr.slice(0, 500)}` };
          }

          const stats = await fs.stat(outFile);
          return {
            success: true,
            message: `✅ 音频已提取: ${outFile}\n💾 大小: ${(stats.size / 1024).toFixed(0)}KB`,
            data: { outputPath: outFile, sizeKB: Math.round(stats.size / 1024) },
          };
        }

        case "clip": {
          if (!startTime) return { success: false, message: "❌ clip操作需要 startTime 参数" };

          const ext = path.extname(resolved);
          const outFile = outputPath || path.join(path.dirname(resolved), `${path.basename(resolved, ext)}_clip${ext}`);

          const args = ["-y", "-i", resolved, "-ss", startTime];
          if (endTime) args.push("-to", endTime);
          args.push("-c", "copy", outFile);

          const r = await runCmd("ffmpeg", args, 120000);
          if (!r.ok) {
            return { success: false, message: `❌ 裁剪失败: ${r.stderr.slice(0, 500)}` };
          }

          const stats = await fs.stat(outFile);
          return {
            success: true,
            message: `✅ 视频已裁剪: ${outFile}\n⏱️ ${startTime} → ${endTime || "结尾"}\n💾 大小: ${(stats.size / (1024 * 1024)).toFixed(1)}MB`,
            data: { outputPath: outFile, startTime, endTime, sizeMB: parseFloat((stats.size / (1024 * 1024)).toFixed(1)) },
          };
        }

        case "convert": {
          const fmt = outputFormat || "mp4";
          const outFile = outputPath || path.join(path.dirname(resolved), `${path.basename(resolved, path.extname(resolved))}.${fmt}`);

          let args: string[];
          if (fmt === "gif") {
            args = ["-y", "-i", resolved, "-vf", "fps=10,scale=480:-1:flags=lanczos", "-loop", "0", outFile];
          } else {
            args = ["-y", "-i", resolved, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", outFile];
          }

          const r = await runCmd("ffmpeg", args, 300000);
          if (!r.ok) {
            return { success: false, message: `❌ 转码失败: ${r.stderr.slice(0, 500)}` };
          }

          const stats = await fs.stat(outFile);
          return {
            success: true,
            message: `✅ 视频已转换为 ${fmt.toUpperCase()}: ${outFile}\n💾 大小: ${(stats.size / (1024 * 1024)).toFixed(1)}MB`,
            data: { outputPath: outFile, format: fmt, sizeMB: parseFloat((stats.size / (1024 * 1024)).toFixed(1)) },
          };
        }

        case "thumbnail": {
          await fs.mkdir(FRAMES_DIR, { recursive: true });
          const outFile = outputPath || path.join(FRAMES_DIR, `${path.basename(resolved, path.extname(resolved))}_thumb.jpg`);

          const r = await runCmd("ffmpeg", ["-y", "-i", resolved, "-vf", "thumbnail,scale=320:-1", "-frames:v", "1", "-q:v", "2", outFile], 30000);
          if (!r.ok) {
            return { success: false, message: `❌ 缩略图生成失败: ${r.stderr.slice(0, 500)}` };
          }

          return {
            success: true,
            message: `✅ 缩略图已生成: ${outFile}`,
            data: { outputPath: outFile },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `视频操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
