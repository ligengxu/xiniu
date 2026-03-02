import { z } from "zod";
import type { SkillDefinition } from "../types";

function generateFaviconSvg(
  text: string, bgColor: string, textColor: string, shape: string, fontSize: number,
): string {
  const size = 512;
  let bg = "";

  switch (shape) {
    case "circle":
      bg = `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bgColor}"/>`;
      break;
    case "rounded":
      bg = `<rect width="${size}" height="${size}" rx="100" fill="${bgColor}"/>`;
      break;
    default:
      bg = `<rect width="${size}" height="${size}" fill="${bgColor}"/>`;
  }

  const displayText = text.slice(0, 2);
  const textEl = `<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="${fontSize}" fill="${textColor}">${displayText}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}${textEl}</svg>`;
}

function generateHtmlSnippet(files: string[]): string {
  const lines = files.map((f) => {
    const name = f.split(/[/\\]/).pop() || "";
    if (name.includes(".ico")) return `<link rel="icon" href="/${name}">`;
    if (name.includes("180")) return `<link rel="apple-touch-icon" sizes="180x180" href="/${name}">`;
    if (name.includes("32")) return `<link rel="icon" type="image/png" sizes="32x32" href="/${name}">`;
    if (name.includes("16")) return `<link rel="icon" type="image/png" sizes="16x16" href="/${name}">`;
    return `<link rel="icon" href="/${name}">`;
  });
  return lines.join("\n");
}

export const faviconGenSkill: SkillDefinition = {
  name: "favicon_gen",
  displayName: "网站图标生成",
  description:
    "生成网站favicon图标（SVG格式），支持文字图标、自定义颜色和形状。" +
    "用户说'favicon'、'网站图标'、'站点图标'、'ico图标'时使用。",
  icon: "Image",
  category: "dev",
  parameters: z.object({
    text: z.string().describe("图标文字（取前2个字符，如'犀牛'、'XN'）"),
    bgColor: z.string().optional().describe("背景颜色，默认#4F46E5"),
    textColor: z.string().optional().describe("文字颜色，默认#FFFFFF"),
    shape: z.enum(["square", "rounded", "circle"]).optional().describe("形状: square/rounded/circle，默认rounded"),
    fontSize: z.number().optional().describe("字号，默认280"),
    savePath: z.string().optional().describe("保存目录"),
  }),
  execute: async (params) => {
    const { text, bgColor, textColor, shape, fontSize, savePath } = params as {
      text: string; bgColor?: string; textColor?: string; shape?: string; fontSize?: number; savePath?: string;
    };

    if (!text?.trim()) return { success: false, message: "❌ 请提供图标文字 (text 参数)" };

    try {
      const fs = await import("fs");
      const path = await import("path");

      const bg = bgColor || "#4F46E5";
      const tc = textColor || "#FFFFFF";
      const sh = shape || "rounded";
      const fs2 = fontSize || 280;

      const dir = savePath || path.join("C:\\Users\\Administrator\\Desktop", `favicon_${Date.now()}`);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const svg = generateFaviconSvg(text, bg, tc, sh, fs2);
      const svgPath = path.join(dir, "favicon.svg");
      fs.writeFileSync(svgPath, svg, "utf-8");

      const files = [svgPath];
      const htmlSnippet = generateHtmlSnippet(files);
      const htmlPath = path.join(dir, "usage.html");
      fs.writeFileSync(htmlPath, `<!-- 将以下代码放入 HTML <head> 中 -->\n${htmlSnippet}\n\n<!-- SVG favicon (现代浏览器推荐) -->\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n`, "utf-8");

      let msg = `✅ 网站图标已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `🎨 文字: "${text.slice(0, 2)}" | 背景: ${bg} | 文字色: ${tc}\n`;
      msg += `📐 形状: ${sh} | 字号: ${fs2}\n`;
      msg += `📁 输出目录: ${dir}\n`;
      msg += `📄 文件:\n  • favicon.svg (矢量图标)\n  • usage.html (使用说明)\n\n`;
      msg += `💡 在HTML中引用:\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">`;

      return { success: true, message: msg, data: { dir, files: ["favicon.svg", "usage.html"] } };
    } catch (err) {
      return { success: false, message: `❌ 图标生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
