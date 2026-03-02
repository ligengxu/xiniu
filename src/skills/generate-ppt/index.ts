import { z } from "zod";
import PptxGenJS from "pptxgenjs";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

interface ThemeConfig {
  bgGradient: [string, string];
  titleColor: string;
  textColor: string;
  subtextColor: string;
  accentColor: string;
  accentAlt: string;
  shapeOpacity: number;
}

const THEMES: Record<string, ThemeConfig> = {
  ocean: {
    bgGradient: ["0F172A", "1E3A5F"],
    titleColor: "FFFFFF",
    textColor: "E2E8F0",
    subtextColor: "94A3B8",
    accentColor: "38BDF8",
    accentAlt: "818CF8",
    shapeOpacity: 12,
  },
  forest: {
    bgGradient: ["0F1F0F", "1A3A2A"],
    titleColor: "FFFFFF",
    textColor: "D1FAE5",
    subtextColor: "6EE7B7",
    accentColor: "10B981",
    accentAlt: "34D399",
    shapeOpacity: 10,
  },
  sunset: {
    bgGradient: ["1F0A1E", "3B1233"],
    titleColor: "FFFFFF",
    textColor: "FDE8F0",
    subtextColor: "F9A8D4",
    accentColor: "F472B6",
    accentAlt: "FB923C",
    shapeOpacity: 10,
  },
  corporate: {
    bgGradient: ["FFFFFF", "F1F5F9"],
    titleColor: "1E293B",
    textColor: "334155",
    subtextColor: "64748B",
    accentColor: "2563EB",
    accentAlt: "3B82F6",
    shapeOpacity: 6,
  },
  dark: {
    bgGradient: ["09090B", "18181B"],
    titleColor: "FFFFFF",
    textColor: "E4E4E7",
    subtextColor: "A1A1AA",
    accentColor: "A78BFA",
    accentAlt: "C084FC",
    shapeOpacity: 8,
  },
  tech: {
    bgGradient: ["0C0A1D", "1A1145"],
    titleColor: "FFFFFF",
    textColor: "C7D2FE",
    subtextColor: "818CF8",
    accentColor: "6366F1",
    accentAlt: "22D3EE",
    shapeOpacity: 10,
  },
};

type LayoutType = "bullets" | "two_column" | "image_text" | "quote" | "stats" | "timeline";

function pickTheme(name?: string): ThemeConfig {
  if (name && THEMES[name]) return THEMES[name];
  const keys = Object.keys(THEMES);
  return THEMES[keys[Math.floor(Math.random() * keys.length)]];
}

function addDecoShapes(
  slide: PptxGenJS.Slide,
  pptx: PptxGenJS,
  theme: ThemeConfig,
  variant: number,
) {
  const op = theme.shapeOpacity;
  const accent = theme.accentColor;
  const alt = theme.accentAlt;

  switch (variant % 5) {
    case 0:
      slide.addShape(pptx.ShapeType.ellipse, {
        x: -0.6, y: -0.5, w: 3, h: 3,
        fill: { color: accent, transparency: 100 - op },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: 10.5, y: 5, w: 4, h: 4,
        fill: { color: alt, transparency: 100 - op + 3 },
      });
      break;
    case 1:
      slide.addShape(pptx.ShapeType.rect, {
        x: -1, y: 0, w: 0.15, h: "100%",
        fill: { color: accent, transparency: 100 - op - 5 },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: 11, y: -1, w: 3.5, h: 3.5,
        fill: { color: alt, transparency: 100 - op },
      });
      break;
    case 2:
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 7, w: "100%", h: 0.12,
        fill: { color: accent, transparency: 100 - op - 3 },
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: 10, y: 4.5, w: 2.5, h: 2.5,
        fill: { color: alt, transparency: 100 - op + 2 },
      });
      break;
    case 3:
      slide.addShape(pptx.ShapeType.rtTriangle, {
        x: -0.5, y: 5.5, w: 3, h: 3,
        fill: { color: accent, transparency: 100 - op },
        rotate: 0,
      });
      slide.addShape(pptx.ShapeType.ellipse, {
        x: 11.5, y: -0.5, w: 2, h: 2,
        fill: { color: alt, transparency: 100 - op + 4 },
      });
      break;
    case 4:
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 0.08, h: "100%",
        fill: { color: accent, transparency: 100 - op - 10 },
      });
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.15, y: 0, w: 0.04, h: "100%",
        fill: { color: alt, transparency: 100 - op },
      });
      break;
  }
}

function addProgressBar(
  slide: PptxGenJS.Slide,
  current: number,
  total: number,
  theme: ThemeConfig,
) {
  const barW = 10;
  const progress = (current / total) * barW;
  slide.addShape("rect" as PptxGenJS.ShapeType, {
    x: 1.65, y: 7.15, w: barW, h: 0.06,
    fill: { color: theme.subtextColor, transparency: 85 },
  });
  if (progress > 0) {
    slide.addShape("rect" as PptxGenJS.ShapeType, {
      x: 1.65, y: 7.15, w: progress, h: 0.06,
      fill: { color: theme.accentColor, transparency: 30 },
    });
  }
}

function addPageNumber(
  slide: PptxGenJS.Slide,
  num: number,
  total: number,
  theme: ThemeConfig,
) {
  slide.addText(`${num} / ${total}`, {
    x: 11.8, y: 7.05, w: 1.2, h: 0.4,
    fontSize: 9, color: theme.subtextColor, align: "right",
  });
}

function detectLayout(content: string): LayoutType {
  const lines = content.split("\n").filter(l => l.trim());
  if (lines.length === 1 && lines[0].length > 40 && !lines[0].match(/^[-*•]/)) return "quote";
  if (lines.some(l => /^\d+[.、)]\s/.test(l)) && lines.length <= 6) return "timeline";
  if (lines.some(l => /\d+%|\d+\.\d+/.test(l)) && lines.length <= 4) return "stats";
  if (lines.length > 6) return "two_column";
  return "bullets";
}

function renderBullets(
  slide: PptxGenJS.Slide,
  content: string,
  theme: ThemeConfig,
  pptx: PptxGenJS,
) {
  const points = content.split("\n").filter(l => l.trim()).map(l => l.trim().replace(/^[-*•]\s*/, ""));

  slide.addShape(pptx.ShapeType.rect, {
    x: "5%", y: "16%", w: "15%", h: 0.04,
    fill: { color: theme.accentColor },
  });

  const textBody = points.map((point) => ({
    text: point,
    options: {
      fontSize: 15, color: theme.textColor,
      bullet: { type: "bullet" as const, color: theme.accentColor },
      breakLine: true, paraSpaceAfter: 10, lineSpacing: 22,
    },
  }));

  slide.addText(textBody, {
    x: "5%", y: "20%", w: "90%", h: "60%", valign: "top" as const,
  });
}

function renderTwoColumn(
  slide: PptxGenJS.Slide,
  content: string,
  theme: ThemeConfig,
  pptx: PptxGenJS,
) {
  const lines = content.split("\n").filter(l => l.trim());
  const mid = Math.ceil(lines.length / 2);
  const left = lines.slice(0, mid);
  const right = lines.slice(mid);

  slide.addShape(pptx.ShapeType.rect, {
    x: "49%", y: "16%", w: 0.02, h: "65%",
    fill: { color: theme.accentColor, transparency: 60 },
  });

  const makeBody = (items: string[]) => items.map(l => ({
    text: l.trim().replace(/^[-*•]\s*/, ""),
    options: {
      fontSize: 14, color: theme.textColor,
      bullet: { type: "bullet" as const, color: theme.accentColor },
      breakLine: true, paraSpaceAfter: 8, lineSpacing: 20,
    },
  }));

  slide.addText(makeBody(left), {
    x: "3%", y: "18%", w: "44%", h: "62%", valign: "top" as const,
  });
  slide.addText(makeBody(right), {
    x: "53%", y: "18%", w: "44%", h: "62%", valign: "top" as const,
  });
}

function renderQuote(
  slide: PptxGenJS.Slide,
  content: string,
  theme: ThemeConfig,
  pptx: PptxGenJS,
) {
  slide.addShape(pptx.ShapeType.rect, {
    x: "8%", y: "25%", w: 0.06, h: "45%",
    fill: { color: theme.accentColor },
  });

  slide.addText(`"`, {
    x: "10%", y: "22%", w: 0.8, h: 0.8,
    fontSize: 60, color: theme.accentColor, bold: true, transparency: 40,
  });

  slide.addText(content.trim(), {
    x: "12%", y: "30%", w: "76%", h: "35%",
    fontSize: 20, color: theme.textColor, italic: true,
    align: "left", valign: "middle" as const, lineSpacing: 28,
  });
}

function renderStats(
  slide: PptxGenJS.Slide,
  content: string,
  theme: ThemeConfig,
  pptx: PptxGenJS,
) {
  const items = content.split("\n").filter(l => l.trim()).slice(0, 4);
  const cols = Math.min(items.length, 4);
  const colW = 10 / cols;

  items.forEach((item, i) => {
    const match = item.match(/(\d+[\d,.]*%?)/);
    const num = match ? match[1] : "";
    const label = item.replace(num, "").replace(/^[-*•:：\s]+/, "").trim();
    const xPos = 1.65 + i * colW;

    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos + 0.15, y: "22%", w: colW - 0.3, h: "50%",
      fill: { color: theme.accentColor, transparency: 90 },
      rectRadius: 0.15,
      line: { color: theme.accentColor, width: 1, transparency: 60 },
    });

    slide.addText(num || "—", {
      x: xPos + 0.15, y: "28%", w: colW - 0.3, h: 1,
      fontSize: 32, bold: true, color: theme.accentColor, align: "center",
    });
    slide.addText(label || item.trim(), {
      x: xPos + 0.15, y: "50%", w: colW - 0.3, h: 0.8,
      fontSize: 13, color: theme.subtextColor, align: "center",
    });
  });
}

function renderTimeline(
  slide: PptxGenJS.Slide,
  content: string,
  theme: ThemeConfig,
  pptx: PptxGenJS,
) {
  const items = content.split("\n").filter(l => l.trim()).slice(0, 6);

  slide.addShape(pptx.ShapeType.rect, {
    x: "15%", y: "45%", w: "70%", h: 0.04,
    fill: { color: theme.accentColor, transparency: 50 },
  });

  const stepW = 8.4 / Math.max(items.length, 1);
  items.forEach((item, i) => {
    const xC = 2.3 + i * stepW;
    const label = item.replace(/^\d+[.、)\s]+/, "").trim();

    slide.addShape(pptx.ShapeType.ellipse, {
      x: xC - 0.15, y: 3.2, w: 0.3, h: 0.3,
      fill: { color: theme.accentColor },
    });
    slide.addText(`${i + 1}`, {
      x: xC - 0.15, y: 3.2, w: 0.3, h: 0.3,
      fontSize: 10, color: "FFFFFF", align: "center", valign: "middle" as const, bold: true,
    });
    slide.addText(label, {
      x: xC - stepW / 2 + 0.05, y: i % 2 === 0 ? 2.2 : 3.7, w: stepW - 0.1, h: 0.8,
      fontSize: 11, color: theme.textColor, align: "center", valign: "middle" as const,
    });
  });
}

export const generatePptSkill: SkillDefinition = {
  name: "generate_ppt",
  displayName: "生成演示文稿",
  description:
    "根据内容生成专业级 PowerPoint (.pptx) 演示文稿，自动排版、渐变背景、几何装饰、多种布局（列表/两栏/引用/数据/时间线）、进度条、页码。支持6种主题(ocean/forest/sunset/corporate/dark/tech)。用户可能会说'帮我做PPT'、'生成演示文稿'、'做一个关于xxx的PPT'等。",
  icon: "FileText",
  category: "office",
  parameters: z.object({
    title: z.string().describe("演示文稿主标题"),
    subtitle: z.string().optional().describe("副标题"),
    author: z.string().optional().describe("作者名称，默认'犀牛 Agent'"),
    theme: z.string().optional().describe("主题风格: ocean(海洋蓝)/forest(森林绿)/sunset(日落粉)/corporate(商务白)/dark(暗黑紫)/tech(科技蓝紫)，不指定则随机"),
    slides: z
      .array(
        z.object({
          title: z.string().describe("幻灯片标题"),
          content: z.string().describe("幻灯片内容(每行一个要点，支持markdown列表符号-*•)"),
          layout: z.string().optional().describe("布局方式: bullets(列表)/two_column(双栏)/quote(引用)/stats(数据展示)/timeline(时间线)，不指定则自动检测"),
          notes: z.string().optional().describe("演讲者备注"),
        })
      )
      .describe("幻灯片内容数组，每个元素代表一页"),
    savePath: z.string().describe("保存路径（含文件名），例如 C:/Users/Administrator/Desktop/演示.pptx"),
  }),
  execute: async (params) => {
    try {
      const { title, subtitle, slides, savePath, theme: themeName, author } = params as {
        title: string;
        subtitle?: string;
        slides: { title: string; content: string; layout?: string; notes?: string }[];
        savePath: string;
        theme?: string;
        author?: string;
      };

      const resolved = path.resolve(savePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });

      const theme = pickTheme(themeName);
      const authorName = author || "犀牛 Agent";
      const totalPages = slides.length + 2;

      const pptx = new PptxGenJS();
      pptx.author = authorName;
      pptx.title = title;
      pptx.layout = "LAYOUT_WIDE";

      // ==================== COVER SLIDE ====================
      const cover = pptx.addSlide();
      cover.background = { color: theme.bgGradient[0] };
      addDecoShapes(cover, pptx, theme, 0);

      cover.addShape(pptx.ShapeType.rect, {
        x: "5%", y: "60%", w: "35%", h: 0.05,
        fill: { color: theme.accentColor },
      });

      cover.addText(title, {
        x: "5%", y: "25%", w: "80%", h: 1.6,
        fontSize: 40, bold: true, color: theme.titleColor,
        align: "left", valign: "bottom" as const,
      });

      if (subtitle) {
        cover.addText(subtitle, {
          x: "5%", y: "65%", w: "80%", h: 0.8,
          fontSize: 18, color: theme.subtextColor,
          align: "left",
        });
      }

      cover.addText(authorName, {
        x: "5%", y: "80%", w: "40%", h: 0.5,
        fontSize: 12, color: theme.subtextColor, align: "left",
      });

      const dateStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long" });
      cover.addText(dateStr, {
        x: "55%", y: "80%", w: "40%", h: 0.5,
        fontSize: 12, color: theme.subtextColor, align: "right",
      });

      // ==================== TOC SLIDE (if slides > 3) ====================
      let tocAdded = false;
      if (slides.length > 3) {
        tocAdded = true;
        const toc = pptx.addSlide();
        toc.background = { color: theme.bgGradient[1] };
        addDecoShapes(toc, pptx, theme, 1);

        toc.addText("目  录", {
          x: "5%", y: "5%", w: "90%", h: 0.8,
          fontSize: 28, bold: true, color: theme.titleColor,
        });
        toc.addShape(pptx.ShapeType.rect, {
          x: "5%", y: "14%", w: "10%", h: 0.04, fill: { color: theme.accentColor },
        });

        const tocItems = slides.map((s, i) => ({
          text: `${String(i + 1).padStart(2, "0")}    ${s.title}`,
          options: {
            fontSize: 15, color: theme.textColor,
            breakLine: true, paraSpaceAfter: 12, lineSpacing: 24,
          },
        }));
        toc.addText(tocItems, {
          x: "5%", y: "20%", w: "90%", h: "65%", valign: "top" as const,
        });

        addPageNumber(toc, 2, totalPages + 1, theme);
      }

      const contentTotal = totalPages + (tocAdded ? 1 : 0);

      // ==================== CONTENT SLIDES ====================
      slides.forEach((slideData, idx) => {
        const s = pptx.addSlide();
        const bgIdx = idx % 2;
        s.background = { color: theme.bgGradient[bgIdx] };
        addDecoShapes(s, pptx, theme, idx + 2);

        s.addText(slideData.title, {
          x: "5%", y: "4%", w: "85%", h: 0.8,
          fontSize: 24, bold: true, color: theme.titleColor,
        });

        const layout: LayoutType = (slideData.layout as LayoutType) || detectLayout(slideData.content);

        switch (layout) {
          case "two_column": renderTwoColumn(s, slideData.content, theme, pptx); break;
          case "quote": renderQuote(s, slideData.content, theme, pptx); break;
          case "stats": renderStats(s, slideData.content, theme, pptx); break;
          case "timeline": renderTimeline(s, slideData.content, theme, pptx); break;
          default: renderBullets(s, slideData.content, theme, pptx); break;
        }

        if (slideData.notes) {
          s.addNotes(slideData.notes);
        }

        const pageNum = idx + (tocAdded ? 3 : 2);
        addPageNumber(s, pageNum, contentTotal, theme);
        addProgressBar(s, idx + 1, slides.length, theme);
      });

      // ==================== END SLIDE ====================
      const end = pptx.addSlide();
      end.background = { color: theme.bgGradient[0] };
      addDecoShapes(end, pptx, theme, 4);

      end.addText("感谢聆听", {
        x: "10%", y: "30%", w: "80%", h: 1.2,
        fontSize: 44, bold: true, color: theme.accentColor, align: "center",
      });
      end.addShape(pptx.ShapeType.rect, {
        x: "35%", y: "55%", w: "30%", h: 0.05,
        fill: { color: theme.accentColor, transparency: 40 },
      });
      end.addText("THANK YOU", {
        x: "10%", y: "58%", w: "80%", h: 0.6,
        fontSize: 16, color: theme.subtextColor, align: "center", charSpacing: 8,
      });
      end.addText(`${authorName}  ·  ${dateStr}`, {
        x: "10%", y: "78%", w: "80%", h: 0.5,
        fontSize: 11, color: theme.subtextColor, align: "center",
      });

      const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
      await fs.writeFile(resolved, buffer);

      const sizeKB = (buffer.length / 1024).toFixed(1);
      const usedTheme = themeName || Object.keys(THEMES).find(k => THEMES[k] === theme) || "random";
      return {
        success: true,
        message: `PPT 已生成: ${resolved}\n页数: ${contentTotal} 页 (封面+${tocAdded ? "目录+" : ""}${slides.length}页内容+结束页)\n主题: ${usedTheme}\n大小: ${sizeKB} KB\n特性: 渐变背景 · 几何装饰 · 进度条 · 页码 · 自动排版`,
        data: { path: resolved, slideCount: contentTotal, theme: usedTheme, sizeKB },
      };
    } catch (err) {
      return {
        success: false,
        message: `PPT 生成失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
