import { z } from "zod";
import type { SkillDefinition } from "../types";

function generatePlaceholderSvg(
  width: number, height: number, bgColor: string, textColor: string, text: string, fontSize: number,
): string {
  const displayText = text || `${width}×${height}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" fill="${bgColor}"/>
<line x1="0" y1="0" x2="${width}" y2="${height}" stroke="${textColor}" stroke-opacity="0.15" stroke-width="1"/>
<line x1="${width}" y1="0" x2="0" y2="${height}" stroke="${textColor}" stroke-opacity="0.15" stroke-width="1"/>
<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Arial,sans-serif" font-size="${fontSize}" fill="${textColor}">${displayText}</text>
</svg>`;
}

export const placeholderImgSkill: SkillDefinition = {
  name: "placeholder_img",
  displayName: "占位图生成",
  description:
    "生成开发用占位图片(SVG格式)，自定义尺寸/颜色/文字，用于UI设计和前端开发。" +
    "用户说'占位图'、'placeholder'、'假图'、'测试图片'时使用。",
  icon: "ImagePlus",
  category: "dev",
  parameters: z.object({
    width: z.number().describe("图片宽度(px)"),
    height: z.number().describe("图片高度(px)"),
    bgColor: z.string().optional().describe("背景颜色，默认#CCCCCC"),
    textColor: z.string().optional().describe("文字颜色，默认#969696"),
    text: z.string().optional().describe("显示文字，默认为尺寸如'300×200'"),
    fontSize: z.number().optional().describe("字号，默认自动"),
    count: z.number().optional().describe("批量生成数量，默认1"),
    savePath: z.string().optional().describe("保存目录"),
  }),
  execute: async (params) => {
    const { width, height, bgColor, textColor, text, fontSize, count, savePath } = params as {
      width: number; height: number; bgColor?: string; textColor?: string;
      text?: string; fontSize?: number; count?: number; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");

      const bg = bgColor || "#CCCCCC";
      const tc = textColor || "#969696";
      const autoFontSize = fontSize || Math.max(12, Math.min(width, height) / 6);
      const n = Math.min(count || 1, 20);

      const dir = savePath || path.join("C:\\Users\\Administrator\\Desktop");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const files: string[] = [];
      for (let i = 0; i < n; i++) {
        const svg = generatePlaceholderSvg(width, height, bg, tc, text || "", autoFontSize);
        const fileName = n > 1 ? `placeholder_${width}x${height}_${i + 1}.svg` : `placeholder_${width}x${height}.svg`;
        const filePath = path.join(dir, fileName);
        fs.writeFileSync(filePath, svg, "utf-8");
        files.push(filePath);
      }

      let msg = `✅ 占位图已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📐 尺寸: ${width}×${height}px | 数量: ${n}\n`;
      msg += `🎨 背景: ${bg} | 文字: ${tc}\n`;
      for (const f of files) msg += `📁 ${f}\n`;

      return { success: true, message: msg, data: { files, width, height } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
