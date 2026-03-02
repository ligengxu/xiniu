import { z } from "zod";
import type { SkillDefinition } from "../types";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  r /= 255; g /= 255; b /= 255;
  const k = 1 - Math.max(r, g, b);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: Math.round(((1 - r - k) / (1 - k)) * 100),
    m: Math.round(((1 - g - k) / (1 - k)) * 100),
    y: Math.round(((1 - b - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }): number {
  const l1 = luminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = luminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function generatePalette(hex: string, mode: string): string[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [];
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  switch (mode) {
    case "complementary":
      return [hex, rgbToHex(...Object.values(hslToRgb((hsl.h + 180) % 360, hsl.s, hsl.l)) as [number, number, number])];
    case "triadic":
      return [hex,
        rgbToHex(...Object.values(hslToRgb((hsl.h + 120) % 360, hsl.s, hsl.l)) as [number, number, number]),
        rgbToHex(...Object.values(hslToRgb((hsl.h + 240) % 360, hsl.s, hsl.l)) as [number, number, number]),
      ];
    case "analogous":
      return [
        rgbToHex(...Object.values(hslToRgb((hsl.h - 30 + 360) % 360, hsl.s, hsl.l)) as [number, number, number]),
        hex,
        rgbToHex(...Object.values(hslToRgb((hsl.h + 30) % 360, hsl.s, hsl.l)) as [number, number, number]),
      ];
    case "shades": {
      const shades: string[] = [];
      for (let i = 0; i < 5; i++) {
        const newL = Math.max(0, Math.min(100, hsl.l - 20 + i * 10));
        const c = hslToRgb(hsl.h, hsl.s, newL);
        shades.push(rgbToHex(c.r, c.g, c.b));
      }
      return shades;
    }
    default:
      return [hex];
  }
}

const CSS_COLORS: Record<string, string> = {
  red: "#FF0000", blue: "#0000FF", green: "#008000", white: "#FFFFFF", black: "#000000",
  yellow: "#FFFF00", cyan: "#00FFFF", magenta: "#FF00FF", orange: "#FFA500", purple: "#800080",
  pink: "#FFC0CB", gray: "#808080", grey: "#808080", brown: "#A52A2A", gold: "#FFD700",
  silver: "#C0C0C0", navy: "#000080", teal: "#008080", maroon: "#800000", olive: "#808000",
  lime: "#00FF00", aqua: "#00FFFF", coral: "#FF7F50", salmon: "#FA8072", tomato: "#FF6347",
  skyblue: "#87CEEB", violet: "#EE82EE", indigo: "#4B0082", crimson: "#DC143C", khaki: "#F0E68C",
};

export const colorPickerSkill: SkillDefinition = {
  name: "color_picker",
  displayName: "颜色工具",
  description: "颜色格式转换（HEX/RGB/HSL/CMYK互转）、对比度检测（WCAG标准）、配色方案生成（互补色/三色/类似色/深浅色）、CSS颜色名解析。用户说'颜色转换'、'取色'、'配色方案'、'color'时使用。",
  icon: "Sparkles",
  category: "creative",
  parameters: z.object({
    action: z.enum(["convert", "contrast", "palette", "parse"])
      .describe("操作: convert=格式转换, contrast=对比度检测, palette=配色方案, parse=解析颜色名"),
    color: z.string().describe("颜色值: HEX(#FF5500)、RGB(rgb(255,85,0))、HSL(hsl(20,100%,50%))、CSS名(red)"),
    targetFormat: z.string().optional().describe("convert目标格式: hex/rgb/hsl/cmyk，不填则输出所有"),
    color2: z.string().optional().describe("contrast操作的第二个颜色"),
    paletteMode: z.string().optional().describe("palette模式: complementary(互补)/triadic(三色)/analogous(类似)/shades(深浅)"),
  }),
  execute: async (params) => {
    const { action, color, targetFormat, color2, paletteMode = "complementary" } = params as {
      action: string; color: string; targetFormat?: string; color2?: string; paletteMode?: string;
    };

    try {
      let rgb: { r: number; g: number; b: number } | null = null;
      let srcFormat = "";

      const cleanColor = color.trim().toLowerCase();

      if (CSS_COLORS[cleanColor]) {
        rgb = hexToRgb(CSS_COLORS[cleanColor]);
        srcFormat = `CSS(${cleanColor})`;
      } else if (/^#?[0-9a-f]{6}$/i.test(cleanColor)) {
        rgb = hexToRgb(cleanColor.startsWith("#") ? cleanColor : "#" + cleanColor);
        srcFormat = "HEX";
      } else {
        const rgbMatch = cleanColor.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
        if (rgbMatch) {
          rgb = { r: parseInt(rgbMatch[1]), g: parseInt(rgbMatch[2]), b: parseInt(rgbMatch[3]) };
          srcFormat = "RGB";
        }
        const hslMatch = cleanColor.match(/hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)/);
        if (!rgb && hslMatch) {
          rgb = hslToRgb(parseInt(hslMatch[1]), parseInt(hslMatch[2]), parseInt(hslMatch[3]));
          srcFormat = "HSL";
        }
      }

      if (!rgb) return { success: false, message: `无法解析颜色: ${color}\n支持格式: #FF5500, rgb(255,85,0), hsl(20,100%,50%), red` };

      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);

      switch (action) {
        case "convert": {
          let msg = `颜色转换 (来源: ${srcFormat})\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `HEX:  ${hex}\n`;
          msg += `RGB:  rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\n`;
          msg += `HSL:  hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)\n`;
          msg += `CMYK: cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)\n`;

          const textColor = luminance(rgb.r, rgb.g, rgb.b) > 0.179 ? "#000000" : "#FFFFFF";
          msg += `\n推荐文字色: ${textColor} (确保可读性)`;

          return {
            success: true, message: msg,
            data: { hex, rgb: `rgb(${rgb.r},${rgb.g},${rgb.b})`, hsl: `hsl(${hsl.h},${hsl.s}%,${hsl.l}%)`, cmyk },
          };
        }

        case "contrast": {
          if (!color2) return { success: false, message: "对比度检测需要 color2 参数" };

          let rgb2: { r: number; g: number; b: number } | null = null;
          const c2 = color2.trim().toLowerCase();
          if (CSS_COLORS[c2]) rgb2 = hexToRgb(CSS_COLORS[c2]);
          else if (/^#?[0-9a-f]{6}$/i.test(c2)) rgb2 = hexToRgb(c2.startsWith("#") ? c2 : "#" + c2);
          else {
            const m = c2.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
            if (m) rgb2 = { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
          }

          if (!rgb2) return { success: false, message: `无法解析第二个颜色: ${color2}` };

          const ratio = contrastRatio(rgb, rgb2);
          const aaLarge = ratio >= 3;
          const aaNormal = ratio >= 4.5;
          const aaaLarge = ratio >= 4.5;
          const aaaNormal = ratio >= 7;

          let msg = `对比度检测\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `颜色1: ${hex}\n颜色2: ${rgbToHex(rgb2.r, rgb2.g, rgb2.b)}\n`;
          msg += `对比度: ${ratio.toFixed(2)}:1\n\n`;
          msg += `WCAG标准:\n`;
          msg += `  AA 大文本:  ${aaLarge ? "通过" : "不通过"} (>=3:1)\n`;
          msg += `  AA 正常文本: ${aaNormal ? "通过" : "不通过"} (>=4.5:1)\n`;
          msg += `  AAA 大文本: ${aaaLarge ? "通过" : "不通过"} (>=4.5:1)\n`;
          msg += `  AAA 正常文本: ${aaaNormal ? "通过" : "不通过"} (>=7:1)`;

          return { success: true, message: msg, data: { ratio: ratio.toFixed(2), aaLarge, aaNormal, aaaLarge, aaaNormal } };
        }

        case "palette": {
          const colors = generatePalette(hex, paletteMode);
          let msg = `配色方案 (${paletteMode})\n━━━━━━━━━━━━━━━━━━━━\n基准色: ${hex}\n\n`;
          colors.forEach((c, i) => {
            const cRgb = hexToRgb(c);
            msg += `${i + 1}. ${c}`;
            if (cRgb) msg += ` | rgb(${cRgb.r},${cRgb.g},${cRgb.b})`;
            msg += "\n";
          });

          return { success: true, message: msg, data: { baseColor: hex, mode: paletteMode, palette: colors } };
        }

        case "parse": {
          const found = Object.entries(CSS_COLORS)
            .filter(([, v]) => {
              const vRgb = hexToRgb(v);
              if (!vRgb) return false;
              return Math.abs(vRgb.r - rgb!.r) + Math.abs(vRgb.g - rgb!.g) + Math.abs(vRgb.b - rgb!.b) < 50;
            })
            .slice(0, 5);

          let msg = `颜色解析: ${hex}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `RGB: rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\n`;
          msg += `HSL: hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)\n\n`;

          if (found.length > 0) {
            msg += `近似CSS颜色名:\n`;
            found.forEach(([name, v]) => { msg += `  ${name}: ${v}\n`; });
          } else {
            msg += `无精确匹配的CSS颜色名`;
          }

          return { success: true, message: msg, data: { hex, nearestColors: found.map(([n, v]) => ({ name: n, hex: v })) } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `颜色处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
