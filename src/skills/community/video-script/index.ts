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

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 100);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export const videoScriptSkill: SkillDefinition = {
  name: "video_script",
  displayName: "视频拍摄脚本",
  description:
    "从视频中提取拍摄脚本/分镜：自动按场景切割视频，提取每个场景的起止时间、关键帧、时长，生成分镜脚本文档。也可用于直接生成拍摄脚本模板（不需要视频输入）。用户说'拍摄脚本'、'分镜'、'视频脚本'、'场景分析'时使用。",
  icon: "Clapperboard",
  category: "creative",
  parameters: z.object({
    action: z.enum(["extract_scenes", "generate_template", "subtitle_to_script"])
      .describe("操作: extract_scenes=从视频提取场景分镜, generate_template=生成拍摄脚本模板, subtitle_to_script=从字幕文件生成脚本"),
    filePath: z.string().optional().describe("视频文件路径(extract_scenes时必填)"),
    subtitlePath: z.string().optional().describe("字幕文件路径(subtitle_to_script时使用，支持SRT/ASS)"),
    theme: z.string().optional().describe("视频主题(generate_template时使用，如'产品评测'/'美食制作'/'旅行Vlog')"),
    duration: z.number().optional().describe("目标视频时长秒数(generate_template时使用)"),
    sceneThreshold: z.number().optional().describe("场景切换检测阈值(0-1)，越小越敏感，默认0.3"),
    outputPath: z.string().optional().describe("脚本输出路径"),
    maxScenes: z.number().optional().describe("最大场景数量，默认20"),
  }),
  execute: async (params) => {
    const {
      action, filePath, subtitlePath, theme, duration,
      sceneThreshold = 0.3, outputPath, maxScenes = 20,
    } = params as {
      action: string; filePath?: string; subtitlePath?: string;
      theme?: string; duration?: number; sceneThreshold?: number;
      outputPath?: string; maxScenes?: number;
    };

    try {
      switch (action) {
        case "extract_scenes": {
          if (!filePath) return { success: false, message: "❌ extract_scenes需要提供 filePath" };

          const resolved = path.resolve(filePath);
          try { await fs.access(resolved); } catch { return { success: false, message: `❌ 文件不存在: ${resolved}` }; }

          const ffprobeR = await runCmd("ffprobe", ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", resolved], 15000);
          if (!ffprobeR.ok) {
            return { success: false, message: `❌ 需要安装FFmpeg。安装: choco install ffmpeg` };
          }
          const totalDuration = parseFloat(ffprobeR.stdout.trim()) || 0;

          const sceneR = await runCmd("ffprobe", [
            "-v", "quiet", "-f", "lavfi",
            "-i", `movie='${resolved.replace(/\\/g, "/").replace(/'/g, "\\'")}',select='gt(scene,${sceneThreshold})'`,
            "-show_entries", "frame=pts_time",
            "-of", "csv=p=0",
          ], 120000);

          let sceneTimes: number[] = [0];
          if (sceneR.ok && sceneR.stdout.trim()) {
            const times = sceneR.stdout.trim().split("\n").map((t) => parseFloat(t.trim())).filter((t) => !isNaN(t) && t > 0);
            sceneTimes = [0, ...times.slice(0, maxScenes - 1)];
          } else {
            const interval = Math.max(5, totalDuration / Math.min(maxScenes, Math.ceil(totalDuration / 10)));
            for (let t = interval; t < totalDuration - 2; t += interval) {
              sceneTimes.push(t);
            }
          }

          await fs.mkdir(FRAMES_DIR, { recursive: true });
          const baseName = path.basename(resolved, path.extname(resolved));

          const scenes: {
            index: number;
            startTime: string;
            endTime: string;
            durationSec: number;
            framePath: string | null;
          }[] = [];

          for (let i = 0; i < sceneTimes.length; i++) {
            const start = sceneTimes[i];
            const end = i < sceneTimes.length - 1 ? sceneTimes[i + 1] : totalDuration;
            const framePath = path.join(FRAMES_DIR, `${baseName}_scene${i + 1}.jpg`);

            const midPoint = (start + Math.min(start + 2, end)) / 2;
            await runCmd("ffmpeg", [
              "-y", "-ss", String(midPoint), "-i", resolved,
              "-frames:v", "1", "-q:v", "2", framePath,
            ], 15000);

            let hasFrame = false;
            try { await fs.access(framePath); hasFrame = true; } catch {}

            scenes.push({
              index: i + 1,
              startTime: formatTimestamp(start),
              endTime: formatTimestamp(end),
              durationSec: parseFloat((end - start).toFixed(1)),
              framePath: hasFrame ? framePath : null,
            });
          }

          let script = `# 视频分镜脚本\n\n`;
          script += `**源文件**: ${path.basename(resolved)}\n`;
          script += `**总时长**: ${formatTimestamp(totalDuration)} (${totalDuration.toFixed(1)}秒)\n`;
          script += `**场景数**: ${scenes.length}\n`;
          script += `**检测阈值**: ${sceneThreshold}\n\n`;
          script += `---\n\n`;

          for (const s of scenes) {
            script += `## 场景 ${s.index}\n\n`;
            script += `| 项目 | 内容 |\n|---|---|\n`;
            script += `| 时间 | ${s.startTime} → ${s.endTime} |\n`;
            script += `| 时长 | ${s.durationSec}秒 |\n`;
            script += `| 关键帧 | ${s.framePath || "未提取"} |\n`;
            script += `| 画面描述 | *(待填写)* |\n`;
            script += `| 旁白/台词 | *(待填写)* |\n`;
            script += `| 背景音乐 | *(待填写)* |\n`;
            script += `| 转场方式 | *(待填写)* |\n\n`;
          }

          const outPath = outputPath || path.join(path.dirname(resolved), `${baseName}_分镜脚本.md`);
          await fs.writeFile(outPath, script, "utf-8");

          return {
            success: true,
            message: `✅ 分镜脚本已生成\n📄 脚本: ${outPath}\n🎬 共 ${scenes.length} 个场景\n🖼️ 关键帧保存在: ${FRAMES_DIR}`,
            data: {
              scriptPath: outPath,
              scenes: scenes.map((s) => ({ ...s })),
              totalDuration,
              sceneCount: scenes.length,
              framesDir: FRAMES_DIR,
            },
          };
        }

        case "generate_template": {
          const videoTheme = theme || "通用视频";
          const targetDuration = duration || 120;
          const sceneCount = Math.max(3, Math.min(15, Math.ceil(targetDuration / 15)));
          const sceneDuration = Math.round(targetDuration / sceneCount);

          const templates: Record<string, { scenes: string[]; tips: string[] }> = {
            "产品评测": {
              scenes: ["开场白/产品展示全景", "产品外观细节特写", "开箱/拆解过程", "功能演示A", "功能演示B", "对比测试", "使用场景实拍", "优缺点总结", "价格分析与推荐", "结尾互动引导"],
              tips: ["产品展示使用三点布光", "特写镜头使用微距", "转场使用快速平移", "背景音乐节奏轻快"],
            },
            "美食制作": {
              scenes: ["成品展示(诱人特写)", "食材准备/全景", "食材处理(切菜/腌制)", "烹饪步骤1", "烹饪步骤2", "烹饪步骤3", "出锅/装盘", "成品多角度展示", "品尝反应", "菜谱总结字幕"],
              tips: ["食物拍摄用暖色调", "蒸汽用逆光拍摄", "切菜特写用慢动作", "配音自然，忌做作"],
            },
            "旅行Vlog": {
              scenes: ["目的地全景/航拍", "出发/交通过程", "到达第一个地点", "当地美食/市场", "景点游览A", "景点游览B", "当地人互动/体验", "日落/夜景", "酒店/民宿展示", "旅行感悟/结尾"],
              tips: ["多用稳定器/防抖", "交替使用广角和特写", "收集环境音", "加入旅行路线字幕"],
            },
          };

          const tmpl = templates[videoTheme] || {
            scenes: Array.from({ length: sceneCount }, (_, i) => `场景${i + 1}: (待规划)`),
            tips: ["注意光线", "保持画面稳定", "收音清晰", "转场流畅"],
          };

          let script = `# 拍摄脚本 - ${videoTheme}\n\n`;
          script += `**目标时长**: ${Math.floor(targetDuration / 60)}分${targetDuration % 60}秒\n`;
          script += `**场景数量**: ${tmpl.scenes.length}\n`;
          script += `**每场景约**: ${sceneDuration}秒\n\n`;
          script += `---\n\n`;

          let timeAcc = 0;
          for (let i = 0; i < tmpl.scenes.length; i++) {
            const sd = i === tmpl.scenes.length - 1 ? targetDuration - timeAcc : sceneDuration;
            script += `## 场景 ${i + 1}: ${tmpl.scenes[i]}\n\n`;
            script += `| 项目 | 内容 |\n|---|---|\n`;
            script += `| 时间 | ${formatTimestamp(timeAcc)} → ${formatTimestamp(timeAcc + sd)} |\n`;
            script += `| 时长 | ${sd}秒 |\n`;
            script += `| 镜头 | *(中景/特写/全景/俯拍/跟拍)* |\n`;
            script += `| 画面描述 | ${tmpl.scenes[i]} |\n`;
            script += `| 台词/旁白 | *(待填写)* |\n`;
            script += `| 音乐/音效 | *(待填写)* |\n`;
            script += `| 转场 | *(淡入/淡出/硬切/滑动)* |\n`;
            script += `| 拍摄提示 | *(待填写)* |\n\n`;
            timeAcc += sd;
          }

          script += `---\n\n## 拍摄建议\n\n`;
          for (const tip of tmpl.tips) {
            script += `- ${tip}\n`;
          }

          script += `\n## 器材清单\n\n`;
          script += `- [ ] 相机/手机\n- [ ] 三脚架/稳定器\n- [ ] 收音麦克风\n- [ ] 补光灯\n- [ ] 存储卡(≥64GB)\n- [ ] 充电宝/备用电池\n`;

          const outPath = outputPath || path.join(
            process.env.USERPROFILE || process.env.HOME || ".",
            "Desktop",
            `${videoTheme}_拍摄脚本.md`,
          );
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          await fs.writeFile(outPath, script, "utf-8");

          return {
            success: true,
            message: `✅ 拍摄脚本已生成\n📄 文件: ${outPath}\n🎬 主题: ${videoTheme}\n📋 ${tmpl.scenes.length} 个场景，约 ${Math.floor(targetDuration / 60)}分${targetDuration % 60}秒`,
            data: { scriptPath: outPath, theme: videoTheme, sceneCount: tmpl.scenes.length, duration: targetDuration },
          };
        }

        case "subtitle_to_script": {
          if (!subtitlePath) return { success: false, message: "❌ 需要提供 subtitlePath" };

          const subResolved = path.resolve(subtitlePath);
          try { await fs.access(subResolved); } catch { return { success: false, message: `❌ 字幕文件不存在: ${subResolved}` }; }

          const content = await fs.readFile(subResolved, "utf-8");
          const ext = path.extname(subResolved).toLowerCase();

          interface SubEntry { index: number; start: string; end: string; text: string }
          const entries: SubEntry[] = [];

          if (ext === ".srt") {
            const blocks = content.split(/\n\n+/);
            for (const block of blocks) {
              const lines = block.trim().split("\n");
              if (lines.length < 3) continue;
              const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})/);
              if (timeMatch) {
                entries.push({
                  index: parseInt(lines[0]) || entries.length + 1,
                  start: timeMatch[1].replace(",", "."),
                  end: timeMatch[2].replace(",", "."),
                  text: lines.slice(2).join(" ").replace(/<[^>]+>/g, "").trim(),
                });
              }
            }
          } else if (ext === ".ass" || ext === ".ssa") {
            const dialogueLines = content.split("\n").filter((l) => l.startsWith("Dialogue:"));
            for (let i = 0; i < dialogueLines.length; i++) {
              const parts = dialogueLines[i].split(",");
              if (parts.length >= 10) {
                const text = parts.slice(9).join(",").replace(/\{[^}]+\}/g, "").replace(/\\N/g, " ").trim();
                entries.push({
                  index: i + 1,
                  start: parts[1].trim(),
                  end: parts[2].trim(),
                  text,
                });
              }
            }
          } else {
            return { success: false, message: `❌ 不支持的字幕格式: ${ext}，支持 .srt/.ass/.ssa` };
          }

          let script = `# 字幕转分镜脚本\n\n`;
          script += `**字幕文件**: ${path.basename(subResolved)}\n`;
          script += `**条目数**: ${entries.length}\n\n---\n\n`;

          for (const e of entries) {
            script += `### ${e.index}. [${e.start} → ${e.end}]\n`;
            script += `**台词**: ${e.text}\n`;
            script += `**画面描述**: *(待填写)*\n`;
            script += `**镜头**: *(待填写)*\n\n`;
          }

          const outPath = outputPath || path.join(path.dirname(subResolved), `${path.basename(subResolved, ext)}_脚本.md`);
          await fs.writeFile(outPath, script, "utf-8");

          return {
            success: true,
            message: `✅ 字幕已转换为分镜脚本\n📄 文件: ${outPath}\n📋 ${entries.length} 条台词/场景`,
            data: { scriptPath: outPath, entryCount: entries.length },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
