import { z } from "zod";
import type { SkillDefinition } from "../types";

const PRESET_ICONS: Record<string, string> = {
  check: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" fill="none"/>',
  cross: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="2" fill="none"/>',
  star: '<polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="currentColor"/>',
  heart: '<path d="M12 21s-6.5-5.5-8.5-8.5C1.5 9.5 3 6 6 6c2 0 4 1.5 6 4 2-2.5 4-4 6-4 3 0 4.5 3.5 2.5 6.5C18.5 15.5 12 21 12 21z" fill="currentColor"/>',
  arrow_right: '<path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none"/>',
  home: '<path d="M3 12l9-9 9 9M5 10v10h4v-6h6v6h4V10" stroke="currentColor" stroke-width="2" fill="none"/>',
  user: '<circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2" fill="none"/><path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="currentColor" stroke-width="2" fill="none"/>',
  settings: '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" stroke-width="2"/>',
};

function createBasicSvg(shape: string, width: number, height: number, color: string, bgColor?: string): string {
  const bg = bgColor ? `<rect width="${width}" height="${height}" fill="${bgColor}"/>` : "";
  let content = "";

  switch (shape) {
    case "circle":
      content = `<circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2 - 4}" fill="${color}"/>`;
      break;
    case "rect":
      content = `<rect x="4" y="4" width="${width - 8}" height="${height - 8}" rx="8" fill="${color}"/>`;
      break;
    case "triangle":
      content = `<polygon points="${width / 2},4 ${width - 4},${height - 4} 4,${height - 4}" fill="${color}"/>`;
      break;
    case "diamond":
      content = `<polygon points="${width / 2},4 ${width - 4},${height / 2} ${width / 2},${height - 4} 4,${height / 2}" fill="${color}"/>`;
      break;
    case "hexagon": {
      const cx = width / 2, cy = height / 2, r = Math.min(width, height) / 2 - 4;
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 2;
        return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
      }).join(" ");
      content = `<polygon points="${pts}" fill="${color}"/>`;
      break;
    }
    default:
      content = `<rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="${color}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bg}${content}</svg>`;
}

export const svgToolSkill: SkillDefinition = {
  name: "svg_tool",
  displayName: "矢量图工具",
  description:
    "生成和编辑SVG矢量图：基础形状生成、预设图标、自定义SVG代码保存为文件。" +
    "用户说'SVG'、'矢量图'、'图标'、'生成图标'时使用。",
  icon: "Shapes",
  category: "creative",
  parameters: z.object({
    action: z.enum(["create", "icon", "custom", "list_icons"]).describe(
      "操作: create=生成基础形状, icon=使用预设图标, custom=自定义SVG代码, list_icons=列出预设图标"
    ),
    shape: z.string().optional().describe("create时的形状: circle/rect/triangle/diamond/hexagon"),
    iconName: z.string().optional().describe("icon时的预设图标名"),
    svgCode: z.string().optional().describe("custom时的SVG代码"),
    width: z.number().optional().describe("宽度，默认64"),
    height: z.number().optional().describe("高度，默认64"),
    color: z.string().optional().describe("填充颜色，默认#333333"),
    bgColor: z.string().optional().describe("背景颜色"),
    savePath: z.string().optional().describe("保存路径"),
  }),
  execute: async (params) => {
    const { action, shape, iconName, svgCode, width: w, height: h, color, bgColor, savePath } = params as {
      action: string; shape?: string; iconName?: string; svgCode?: string;
      width?: number; height?: number; color?: string; bgColor?: string; savePath?: string;
    };

    try {
      const fs = await import("fs");
      const path = await import("path");
      const width = w || 64;
      const height = h || 64;
      const fillColor = color || "#333333";

      if (action === "list_icons") {
        const names = Object.keys(PRESET_ICONS);
        return { success: true, message: `🎨 预设图标 (${names.length}个)\n━━━━━━━━━━━━━━━━━━━━\n${names.map((n) => `  • ${n}`).join("\n")}` };
      }

      let svg = "";
      let label = "";

      if (action === "create") {
        if (!shape) return { success: false, message: "❌ 请提供 shape 参数: circle/rect/triangle/diamond/hexagon" };
        svg = createBasicSvg(shape, width, height, fillColor, bgColor);
        label = `${shape} ${width}x${height}`;
      } else if (action === "icon") {
        if (!iconName || !PRESET_ICONS[iconName]) {
          return { success: false, message: `❌ 未知图标: ${iconName}\n可用: ${Object.keys(PRESET_ICONS).join(", ")}` };
        }
        svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 24" color="${fillColor}">${PRESET_ICONS[iconName]}</svg>`;
        label = `${iconName} 图标`;
      } else if (action === "custom") {
        if (!svgCode) return { success: false, message: "❌ 请提供 svgCode 参数" };
        svg = svgCode.includes("<svg") ? svgCode : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgCode}</svg>`;
        label = "自定义SVG";
      } else {
        return { success: false, message: `❌ 未知操作: ${action}` };
      }

      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", `svg_${Date.now()}.svg`);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, svg, "utf-8");

      let msg = `✅ SVG已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `🎨 类型: ${label}\n📐 尺寸: ${width}x${height}\n🎨 颜色: ${fillColor}\n`;
      msg += `📁 保存: ${outputPath}\n📊 大小: ${(Buffer.byteLength(svg) / 1024).toFixed(1)}KB`;

      return { success: true, message: msg, data: { path: outputPath, size: Buffer.byteLength(svg) } };
    } catch (err) {
      return { success: false, message: `❌ SVG生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
