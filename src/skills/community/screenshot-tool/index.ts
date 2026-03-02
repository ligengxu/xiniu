import { z } from "zod";
import type { SkillDefinition } from "../types";

export const screenshotToolSkill: SkillDefinition = {
  name: "screenshot_tool",
  displayName: "网页长截图",
  description:
    "对网页进行全页面长截图，捕获完整页面内容（包括需要滚动才能看到的部分）。" +
    "用户说'长截图'、'网页截图'、'全页面截图'、'滚动截图'时使用。",
  icon: "Camera",
  category: "dev",
  parameters: z.object({
    url: z.string().describe("要截图的网页URL"),
    savePath: z.string().optional().describe("保存路径，默认桌面"),
    width: z.number().optional().describe("视口宽度，默认1280"),
    fullPage: z.boolean().optional().describe("是否全页面截图(含滚动区域)，默认true"),
    waitTime: z.number().optional().describe("等待页面加载的毫秒数，默认3000"),
    deviceScale: z.number().optional().describe("设备像素比，默认2(Retina)"),
  }),
  execute: async (params) => {
    const { url, savePath, width, fullPage, waitTime, deviceScale } = params as {
      url: string; savePath?: string; width?: number; fullPage?: boolean;
      waitTime?: number; deviceScale?: number;
    };

    if (!url?.trim()) return { success: false, message: "❌ 请提供网页URL" };

    try {
      const path = await import("path");
      const fs = await import("fs");

      let puppeteer: typeof import("puppeteer");
      try {
        puppeteer = await import("puppeteer");
      } catch {
        return {
          success: false,
          message: "❌ 需要安装 puppeteer:\n  npm install puppeteer\n\n首次安装会自动下载 Chromium 浏览器内核。",
        };
      }

      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", `screenshot_${Date.now()}.png`);
      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const vw = width || 1280;
      const scale = deviceScale || 2;
      const isFullPage = fullPage !== false;
      const wait = waitTime || 3000;

      const browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", `--force-device-scale-factor=${scale}`],
      });

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: vw, height: 800, deviceScaleFactor: scale });
        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

        if (wait > 0) await new Promise((r) => setTimeout(r, wait));

        await page.screenshot({ path: outputPath, fullPage: isFullPage, type: "png" });

        const dimensions = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          title: document.title,
        }));

        await browser.close();

        const stat = fs.statSync(outputPath);
        const sizeMB = (stat.size / 1024 / 1024).toFixed(2);

        let msg = `📸 网页截图完成\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🌐 URL: ${url}\n`;
        msg += `📝 标题: ${dimensions.title || "(无标题)"}\n`;
        msg += `📐 页面尺寸: ${dimensions.width}x${dimensions.height}px\n`;
        msg += `🖥️ 视口: ${vw}px | 缩放: ${scale}x | 全页: ${isFullPage ? "是" : "否"}\n`;
        msg += `📊 文件大小: ${sizeMB}MB\n`;
        msg += `📁 保存: ${outputPath}`;

        return { success: true, message: msg, data: { path: outputPath, size: stat.size, ...dimensions } };
      } catch (err) {
        await browser.close();
        throw err;
      }
    } catch (err) {
      return { success: false, message: `❌ 截图失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
