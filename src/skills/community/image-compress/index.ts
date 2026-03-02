import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

function runCmd(cmd: string, args: string[], timeoutMs = 60000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { timeout: timeoutMs, shell: true, windowsHide: true });
    let stdout = "", stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(2) + "MB";
}

async function hasMagick(): Promise<boolean> {
  const r = await runCmd("magick", ["--version"], 5000);
  return r.ok;
}

export const imageCompressSkill: SkillDefinition = {
  name: "image_compress",
  displayName: "图片压缩转换",
  description: "压缩图片或转换格式（PNG/JPG/WebP/GIF/BMP/TIFF互转）。支持单文件和批量处理（整个目录）。可设置质量、最大宽高、DPI。用户说'压缩图片'、'图片转格式'、'PNG转JPG'、'图片变小'时使用。依赖ImageMagick。",
  icon: "ImageDown",
  category: "office",
  parameters: z.object({
    action: z.enum(["compress", "convert", "resize", "batch", "info"])
      .describe("操作: compress=压缩, convert=格式转换, resize=调整尺寸, batch=批量处理目录, info=查看图片信息"),
    inputPath: z.string().describe("输入图片路径(batch模式为目录路径)"),
    outputPath: z.string().optional().describe("输出路径(不填则覆盖原文件旁生成_compressed后缀)"),
    format: z.string().optional().describe("目标格式: png/jpg/webp/gif/bmp/tiff (convert操作必填)"),
    quality: z.number().optional().describe("压缩质量 1-100，默认75（越低文件越小）"),
    maxWidth: z.number().optional().describe("最大宽度(像素)，超过则等比缩放"),
    maxHeight: z.number().optional().describe("最大高度(像素)"),
    dpi: z.number().optional().describe("设置DPI，默认不变"),
    pattern: z.string().optional().describe("batch模式的文件匹配模式，默认 *.png,*.jpg,*.jpeg,*.webp"),
  }),
  execute: async (params) => {
    const {
      action, inputPath, outputPath, format,
      quality = 75, maxWidth, maxHeight, dpi, pattern,
    } = params as {
      action: string; inputPath: string; outputPath?: string; format?: string;
      quality?: number; maxWidth?: number; maxHeight?: number; dpi?: number; pattern?: string;
    };

    try {
      if (!(await hasMagick())) {
        return {
          success: false,
          message: "未检测到ImageMagick。请安装:\n下载: https://imagemagick.org/script/download.php\nWindows直接下载安装包，安装时勾选'Add to PATH'\n安装后重启终端即可。",
        };
      }

      const resolved = path.resolve(inputPath);

      if (action === "info") {
        const r = await runCmd("magick", ["identify", "-verbose", resolved], 15000);
        if (!r.ok) return { success: false, message: `读取图片信息失败: ${r.stderr}` };

        const lines = r.stdout.split("\n");
        const infoLines = lines.filter((l) =>
          /^\s*(Filename|Format|Geometry|Resolution|Filesize|Colorspace|Type|Depth|Quality)/i.test(l)
        );

        return {
          success: true,
          message: `图片信息: ${resolved}\n━━━━━━━━━━━━━━━━━━━━\n${infoLines.join("\n")}`,
          data: { path: resolved, info: r.stdout.slice(0, 2000) },
        };
      }

      if (action === "batch") {
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) return { success: false, message: "batch模式需要提供目录路径" };

        const exts = (pattern || "*.png,*.jpg,*.jpeg,*.webp").split(",").map((e) => e.trim().replace("*.", ".").toLowerCase());
        const files = await fs.readdir(resolved);
        const targets = files.filter((f) => exts.some((ext) => f.toLowerCase().endsWith(ext)));

        if (targets.length === 0) return { success: false, message: `目录中没有匹配的图片文件 (${exts.join(", ")})` };

        const outDir = outputPath ? path.resolve(outputPath) : path.join(resolved, "compressed");
        await fs.mkdir(outDir, { recursive: true });

        let totalBefore = 0, totalAfter = 0, successCount = 0;
        const results: string[] = [];

        for (const file of targets) {
          const inFile = path.join(resolved, file);
          const ext = format ? `.${format}` : path.extname(file);
          const outFile = path.join(outDir, path.basename(file, path.extname(file)) + ext);

          const beforeStat = await fs.stat(inFile);
          totalBefore += beforeStat.size;

          const args: string[] = [inFile];
          args.push("-quality", String(quality));
          if (maxWidth || maxHeight) args.push("-resize", `${maxWidth || ""}x${maxHeight || ""}>`);
          if (dpi) args.push("-density", String(dpi));
          args.push("-strip", outFile);

          const r = await runCmd("magick", args, 30000);
          if (r.ok) {
            const afterStat = await fs.stat(outFile);
            totalAfter += afterStat.size;
            const ratio = ((1 - afterStat.size / beforeStat.size) * 100).toFixed(1);
            results.push(`${file}: ${formatSize(beforeStat.size)} → ${formatSize(afterStat.size)} (-${ratio}%)`);
            successCount++;
          } else {
            results.push(`${file}: 失败 - ${r.stderr.slice(0, 100)}`);
          }
        }

        const totalRatio = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : "0";
        let msg = `批量处理完成 (${successCount}/${targets.length})\n`;
        msg += `总计: ${formatSize(totalBefore)} → ${formatSize(totalAfter)} (-${totalRatio}%)\n`;
        msg += `输出: ${outDir}\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += results.join("\n");

        return { success: true, message: msg, data: { total: targets.length, success: successCount, savedBytes: totalBefore - totalAfter } };
      }

      try { await fs.access(resolved); } catch { return { success: false, message: `文件不存在: ${resolved}` }; }

      const beforeStat = await fs.stat(resolved);
      const ext = format ? `.${format}` : path.extname(resolved);
      const defaultOut = path.join(
        path.dirname(resolved),
        path.basename(resolved, path.extname(resolved)) + (action === "convert" ? ext : `_compressed${ext}`),
      );
      const outFile = outputPath ? path.resolve(outputPath) : defaultOut;
      await fs.mkdir(path.dirname(outFile), { recursive: true });

      const args: string[] = [resolved];

      switch (action) {
        case "compress":
          args.push("-quality", String(quality), "-strip");
          if (maxWidth || maxHeight) args.push("-resize", `${maxWidth || ""}x${maxHeight || ""}>`);
          if (dpi) args.push("-density", String(dpi));
          break;
        case "convert":
          if (!format) return { success: false, message: "convert操作需要 format 参数" };
          args.push("-quality", String(quality), "-strip");
          break;
        case "resize":
          if (!maxWidth && !maxHeight) return { success: false, message: "resize操作需要 maxWidth 或 maxHeight 参数" };
          args.push("-resize", `${maxWidth || ""}x${maxHeight || ""}>`, "-strip");
          break;
      }

      args.push(outFile);
      const r = await runCmd("magick", args, 30000);

      if (!r.ok) return { success: false, message: `处理失败: ${r.stderr}` };

      const afterStat = await fs.stat(outFile);
      const ratio = ((1 - afterStat.size / beforeStat.size) * 100).toFixed(1);

      let msg = `图片${action === "convert" ? "转换" : action === "resize" ? "缩放" : "压缩"}完成\n`;
      msg += `输入: ${resolved} (${formatSize(beforeStat.size)})\n`;
      msg += `输出: ${outFile} (${formatSize(afterStat.size)})\n`;
      msg += `变化: ${Number(ratio) > 0 ? "-" : "+"}${Math.abs(Number(ratio))}%`;
      if (quality !== 75) msg += ` | 质量: ${quality}`;
      if (maxWidth || maxHeight) msg += ` | 尺寸限制: ${maxWidth || "auto"}x${maxHeight || "auto"}`;

      return {
        success: true, message: msg,
        data: { input: resolved, output: outFile, beforeSize: beforeStat.size, afterSize: afterStat.size, ratio },
      };
    } catch (err) {
      return { success: false, message: `图片处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
