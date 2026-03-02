import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import type { SkillDefinition } from "../types";

const UPLOAD_DIR = path.join(process.env.USERPROFILE || process.env.HOME || ".", ".xiniu", "uploads");

async function getImageMeta(filePath: string): Promise<{
  width: number; height: number; format: string; sizeKB: number;
} | null> {
  try {
    const buf = await fs.readFile(filePath);
    const sizeKB = Math.round(buf.length / 1024);
    let width = 0, height = 0, format = "unknown";

    if (buf[0] === 0xFF && buf[1] === 0xD8) {
      format = "JPEG";
      let offset = 2;
      while (offset < buf.length - 1) {
        if (buf[offset] !== 0xFF) break;
        const marker = buf[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          height = buf.readUInt16BE(offset + 5);
          width = buf.readUInt16BE(offset + 7);
          break;
        }
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    } else if (buf[0] === 0x89 && buf[1] === 0x50) {
      format = "PNG"; width = buf.readUInt32BE(16); height = buf.readUInt32BE(20);
    } else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      format = "GIF"; width = buf.readUInt16LE(6); height = buf.readUInt16LE(8);
    } else if (buf[0] === 0x42 && buf[1] === 0x4D) {
      format = "BMP"; width = buf.readInt32LE(18); height = Math.abs(buf.readInt32LE(22));
    } else if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
      format = "WebP";
      if (buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
        width = (buf.readUInt16LE(26) & 0x3FFF) + 1;
        height = (buf.readUInt16LE(28) & 0x3FFF) + 1;
      }
    }
    return { width, height, format, sizeKB };
  } catch { return null; }
}

function runMagick(args: string[], timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("magick", args, { timeout: timeoutMs });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout?.on("data", (d) => out.push(d));
    proc.stderr?.on("data", (d) => err.push(d));
    proc.on("close", (code) => resolve({
      ok: code === 0,
      stdout: Buffer.concat(out).toString("utf-8"),
      stderr: Buffer.concat(err).toString("utf-8"),
    }));
    proc.on("error", (e) => resolve({ ok: false, stdout: "", stderr: e.message }));
  });
}

export const uploadImageSkill: SkillDefinition = {
  name: "upload_image",
  displayName: "图片分析与编辑",
  description:
    "分析和编辑本地图片文件：获取详细信息(尺寸/格式/色彩/EXIF)、AI内容分析(识别物体/场景/文字OCR)、图片编辑(裁剪/旋转/翻转/水印/滤镜/调色)、复制到工作目录。支持JPG/PNG/GIF/BMP/WebP。用户说'上传图片'、'分析图片'、'图片编辑'、'OCR'、'识别图片'、'加水印'、'裁剪图片'时使用。",
  icon: "ImagePlus",
  category: "creative",
  parameters: z.object({
    filePath: z.string().describe("图片文件路径"),
    action: z.enum(["info", "analyze", "edit", "copy", "base64_preview", "ocr", "compare"])
      .optional().describe("操作: info=详细信息, analyze=AI内容分析, edit=图片编辑, copy=复制, base64_preview=Base64预览, ocr=文字识别, compare=对比两张图"),
    editOperation: z.string().optional()
      .describe("edit操作: crop=裁剪, rotate=旋转, flip=翻转, watermark=加水印, filter=滤镜, brightness=亮度, contrast=对比度, blur=模糊, sharpen=锐化, border=加边框, text=添加文字"),
    editParams: z.string().optional()
      .describe("edit参数(JSON): crop={x,y,w,h}, rotate={angle}, flip={direction:horizontal/vertical}, watermark={text,position,color,size}, filter={type:grayscale/sepia/negate/edge}, brightness={value:-100~100}, contrast={value}, blur={radius}, text={content,x,y,color,size}"),
    outputPath: z.string().optional().describe("edit/copy操作的输出路径"),
    comparePath: z.string().optional().describe("compare操作: 第二张图片路径"),
    targetDir: z.string().optional().describe("copy操作的目标目录"),
    question: z.string().optional().describe("analyze: 关于图片的具体问题(如'图中有几个人','这是什么品牌')"),
  }),
  execute: async (params) => {
    const {
      filePath, action = "info",
      editOperation, editParams,
      outputPath, comparePath,
      targetDir, question,
    } = params as {
      filePath: string; action?: string;
      editOperation?: string; editParams?: string;
      outputPath?: string; comparePath?: string;
      targetDir?: string; question?: string;
    };

    const resolved = path.resolve(filePath);

    try {
      await fs.access(resolved);
    } catch {
      return { success: false, message: `文件不存在: ${resolved}` };
    }

    const meta = await getImageMeta(resolved);
    if (!meta) return { success: false, message: `无法解析图片: ${resolved}` };

    const fileName = path.basename(resolved);
    const ext = path.extname(resolved).toLowerCase();

    switch (action) {
      case "info": {
        const detail = await runMagick(["identify", "-verbose", resolved]);
        let extraInfo = "";
        if (detail.ok) {
          const lines = detail.stdout.split("\n");
          const colorspace = lines.find((l) => l.includes("Colorspace:"))?.split(":")[1]?.trim() || "";
          const depth = lines.find((l) => l.includes("Depth:"))?.split(":")[1]?.trim() || "";
          const compression = lines.find((l) => l.includes("Compression:"))?.split(":")[1]?.trim() || "";
          const dpi = lines.find((l) => l.includes("Resolution:"))?.split(":")[1]?.trim() || "";
          const channelCount = lines.find((l) => l.includes("Channel depth"))?.split(":")[1]?.trim() || "";
          if (colorspace) extraInfo += `色彩空间: ${colorspace}\n`;
          if (depth) extraInfo += `位深: ${depth}\n`;
          if (compression) extraInfo += `压缩: ${compression}\n`;
          if (dpi) extraInfo += `分辨率: ${dpi}\n`;
          if (channelCount) extraInfo += `通道: ${channelCount}\n`;
        }

        return {
          success: true,
          message: `图片信息: ${fileName}\n━━━━━━━━━━━━━━━━━━━━\n尺寸: ${meta.width}x${meta.height}\n格式: ${meta.format}\n大小: ${meta.sizeKB}KB\n${extraInfo}路径: ${resolved}\n\n可用操作:\n- analyze: AI分析图片内容\n- edit: 裁剪/旋转/水印/滤镜\n- ocr: 识别图中文字\n- compare: 对比两张图`,
          data: { path: resolved, fileName, ...meta },
        };
      }

      case "analyze": {
        const buf = await fs.readFile(resolved);
        if (buf.length > 10 * 1024 * 1024) {
          return { success: false, message: "图片超过10MB，请先用 image_compress 压缩" };
        }

        const mimeMap: Record<string, string> = {
          ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
          ".png": "image/png", ".gif": "image/gif",
          ".bmp": "image/bmp", ".webp": "image/webp",
        };
        const mime = mimeMap[ext] || "image/png";
        const b64 = buf.toString("base64");

        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";
        if (!apiKey) {
          return {
            success: true,
            message: `图片基础分析: ${fileName}\n━━━━━━━━━━━━━━━━━━━━\n尺寸: ${meta.width}x${meta.height}\n格式: ${meta.format}\n大小: ${meta.sizeKB}KB\n宽高比: ${(meta.width / meta.height).toFixed(2)}\n总像素: ${(meta.width * meta.height / 1000000).toFixed(1)}MP\n\n注意: 未配置AI API密钥，无法进行内容识别。\n请在.env.local中设置 DASHSCOPE_API_KEY 启用AI图片分析。`,
            data: { path: resolved, ...meta },
          };
        }

        try {
          const prompt = question || "请详细描述这张图片的内容，包括：1)主要物体/人物 2)场景/环境 3)颜色/风格 4)如果有文字请识别出来 5)整体氛围";

          const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "qwen-vl-plus",
              messages: [{
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                  { type: "text", text: prompt },
                ],
              }],
              max_tokens: 1500,
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (!resp.ok) {
            const errText = await resp.text();
            return { success: false, message: `AI分析失败 (${resp.status}): ${errText.slice(0, 500)}` };
          }

          const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
          const analysis = result.choices?.[0]?.message?.content || "无法获取分析结果";

          return {
            success: true,
            message: `AI图片分析: ${fileName}\n━━━━━━━━━━━━━━━━━━━━\n尺寸: ${meta.width}x${meta.height} | ${meta.format} | ${meta.sizeKB}KB\n\n${analysis}`,
            data: { path: resolved, ...meta, analysis },
          };
        } catch (err) {
          return { success: false, message: `AI分析异常: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "ocr": {
        const buf = await fs.readFile(resolved);
        const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp" };
        const mime = mimeMap[ext] || "image/png";
        const b64 = buf.toString("base64");
        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || "";

        if (!apiKey) return { success: false, message: "未配置AI API密钥，无法进行OCR。请在.env.local中设置 DASHSCOPE_API_KEY" };

        try {
          const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "qwen-vl-plus",
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
                { type: "text", text: "请识别图片中所有的文字内容，按照从上到下、从左到右的顺序排列。如果有表格，请保持表格结构。如果是手写体也请尝试识别。输出格式：直接输出识别到的文字内容，不需要额外说明。" },
              ] }],
              max_tokens: 2000,
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (!resp.ok) return { success: false, message: `OCR失败 (${resp.status})` };
          const result = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
          const text = result.choices?.[0]?.message?.content || "未识别到文字";

          return {
            success: true,
            message: `OCR识别结果: ${fileName}\n━━━━━━━━━━━━━━━━━━━━\n${text}`,
            data: { path: resolved, ocrText: text },
          };
        } catch (err) {
          return { success: false, message: `OCR异常: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      case "edit": {
        if (!editOperation) return { success: false, message: "需要提供 editOperation 参数: crop/rotate/flip/watermark/filter/brightness/contrast/blur/sharpen/border/text" };

        const outPath = path.resolve(outputPath || resolved.replace(/(\.\w+)$/, `_edited$1`));
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        let editArgs: string[] = [resolved];
        let opDesc = "";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let ep: Record<string, any> = {};
        if (editParams) {
          try { ep = JSON.parse(editParams); } catch { return { success: false, message: `editParams 不是合法的JSON: ${editParams}` }; }
        }

        switch (editOperation) {
          case "crop":
            editArgs.push("-crop", `${ep.w || 200}x${ep.h || 200}+${ep.x || 0}+${ep.y || 0}`, "+repage");
            opDesc = `裁剪: ${ep.w}x${ep.h}+${ep.x}+${ep.y}`;
            break;
          case "rotate":
            editArgs.push("-rotate", String(ep.angle || 90), "-background", "none");
            opDesc = `旋转: ${ep.angle || 90}度`;
            break;
          case "flip":
            editArgs.push(ep.direction === "horizontal" ? "-flop" : "-flip");
            opDesc = `翻转: ${ep.direction || "vertical"}`;
            break;
          case "watermark":
            editArgs.push(
              "-gravity", ep.position || "SouthEast",
              "-fill", ep.color || "rgba(255,255,255,0.5)",
              "-pointsize", String(ep.size || 24),
              "-annotate", "+10+10", ep.text || "Watermark",
            );
            opDesc = `水印: "${ep.text || "Watermark"}"`;
            break;
          case "filter":
            if (ep.type === "grayscale") editArgs.push("-colorspace", "Gray");
            else if (ep.type === "sepia") editArgs.push("-sepia-tone", "80%");
            else if (ep.type === "negate") editArgs.push("-negate");
            else if (ep.type === "edge") editArgs.push("-edge", "1");
            else editArgs.push("-colorspace", "Gray");
            opDesc = `滤镜: ${ep.type || "grayscale"}`;
            break;
          case "brightness":
            editArgs.push("-brightness-contrast", `${ep.value || 20}x0`);
            opDesc = `亮度: ${ep.value || 20}`;
            break;
          case "contrast":
            editArgs.push("-brightness-contrast", `0x${ep.value || 20}`);
            opDesc = `对比度: ${ep.value || 20}`;
            break;
          case "blur":
            editArgs.push("-blur", `0x${ep.radius || 3}`);
            opDesc = `模糊: 半径${ep.radius || 3}`;
            break;
          case "sharpen":
            editArgs.push("-sharpen", `0x${ep.radius || 2}`);
            opDesc = `锐化: 半径${ep.radius || 2}`;
            break;
          case "border":
            editArgs.push("-bordercolor", ep.color || "#000000", "-border", `${ep.width || 5}x${ep.width || 5}`);
            opDesc = `边框: ${ep.width || 5}px ${ep.color || "#000000"}`;
            break;
          case "text":
            editArgs.push(
              "-gravity", "NorthWest",
              "-fill", ep.color || "#FF0000",
              "-pointsize", String(ep.size || 32),
              "-annotate", `+${ep.x || 10}+${ep.y || 30}`, ep.content || "Hello",
            );
            opDesc = `文字: "${ep.content || "Hello"}"`;
            break;
          default:
            return { success: false, message: `未知编辑操作: ${editOperation}` };
        }

        editArgs.push(outPath);
        const result = await runMagick(["convert", ...editArgs]);

        if (!result.ok) return { success: false, message: `编辑失败: ${result.stderr}` };

        const outMeta = await getImageMeta(outPath);
        return {
          success: true,
          message: `图片编辑完成: ${opDesc}\n━━━━━━━━━━━━━━━━━━━━\n原图: ${meta.width}x${meta.height} ${meta.sizeKB}KB\n结果: ${outMeta?.width || "?"}x${outMeta?.height || "?"} ${outMeta?.sizeKB || "?"}KB\n输出: ${outPath}`,
          data: { inputPath: resolved, outputPath: outPath, operation: editOperation, params: ep },
        };
      }

      case "compare": {
        if (!comparePath) return { success: false, message: "需要提供 comparePath 参数(第二张图片路径)" };
        const resolved2 = path.resolve(comparePath);
        try { await fs.access(resolved2); } catch { return { success: false, message: `第二张图片不存在: ${resolved2}` }; }

        const meta2 = await getImageMeta(resolved2);
        const outDiff = resolved.replace(/(\.\w+)$/, "_diff.png");

        const result = await runMagick(["compare", "-metric", "RMSE", resolved, resolved2, outDiff]);

        let msg = `图片对比\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `图1: ${fileName} ${meta.width}x${meta.height} ${meta.sizeKB}KB\n`;
        msg += `图2: ${path.basename(comparePath)} ${meta2?.width || "?"}x${meta2?.height || "?"} ${meta2?.sizeKB || "?"}KB\n`;

        if (meta.width !== meta2?.width || meta.height !== meta2?.height) {
          msg += `\n尺寸不同!\n`;
        }

        const diffInfo = result.stderr || result.stdout;
        msg += `\n差异度量(RMSE): ${diffInfo.trim()}\n`;
        if (result.ok) msg += `差异图: ${outDiff}\n`;

        return { success: true, message: msg, data: { image1: resolved, image2: resolved2, diff: diffInfo } };
      }

      case "copy": {
        const dest = path.resolve(targetDir || UPLOAD_DIR);
        await fs.mkdir(dest, { recursive: true });
        const destFile = path.join(dest, fileName);
        await fs.copyFile(resolved, destFile);
        return {
          success: true,
          message: `图片已复制到: ${destFile}\n${meta.width}x${meta.height} ${meta.format} ${meta.sizeKB}KB`,
          data: { sourcePath: resolved, destPath: destFile, ...meta },
        };
      }

      case "base64_preview": {
        const buf = await fs.readFile(resolved);
        const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp" };
        const mime = mimeMap[ext] || "image/png";
        if (buf.length > 5 * 1024 * 1024) {
          return { success: false, message: `图片过大(${meta.sizeKB}KB)，预览仅支持5MB以内` };
        }
        const b64 = buf.toString("base64");
        return {
          success: true,
          message: `${fileName} (${meta.width}x${meta.height} ${meta.format} ${meta.sizeKB}KB)\nBase64长度: ${b64.length}字符\nMIME: ${mime}\nData URI: data:${mime};base64,${b64.slice(0, 100)}...`,
          data: { path: resolved, mime, ...meta, base64Length: b64.length },
        };
      }

      default:
        return { success: false, message: `未知操作: ${action}` };
    }
  },
};
