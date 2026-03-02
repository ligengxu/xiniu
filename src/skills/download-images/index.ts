import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import * as cheerio from "cheerio";
import type { SkillDefinition } from "../types";

export const downloadImagesSkill: SkillDefinition = {
  name: "download_images",
  displayName: "下载网页图片",
  description:
    "从指定网页中提取所有图片链接并下载到本地文件夹。用户可能会说'下载图片'、'保存网页上的图'等。",
  icon: "ImageDown",
  parameters: z.object({
    url: z.string().url().describe("要下载图片的网页URL"),
    savePath: z
      .string()
      .describe("图片保存到的本地文件夹路径"),
  }),
  execute: async (params) => {
    const { url, savePath } = params as {
      url: string;
      savePath: string;
    };

    const resolved = path.resolve(savePath);
    await fs.mkdir(resolved, { recursive: true });

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    const html = await res.text();
    const $ = cheerio.load(html);

    const imgUrls: string[] = [];
    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src");
      if (src) {
        try {
          const absolute = new URL(src, url).href;
          if (/\.(jpe?g|png|gif|webp|svg|bmp)/i.test(absolute)) {
            imgUrls.push(absolute);
          }
        } catch { /* skip malformed URLs */ }
      }
    });

    const unique = [...new Set(imgUrls)].slice(0, 50);
    let downloaded = 0;

    const tasks = unique.map(async (imgUrl, i) => {
      try {
        const imgRes = await fetch(imgUrl);
        if (!imgRes.ok) return;
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const ext = path.extname(new URL(imgUrl).pathname) || ".jpg";
        const filename = `image_${String(i + 1).padStart(3, "0")}${ext}`;
        await fs.writeFile(path.join(resolved, filename), buffer);
        downloaded++;
      } catch { /* skip failed downloads */ }
    });

    await Promise.allSettled(tasks);

    return {
      success: true,
      message: `已下载 ${downloaded}/${unique.length} 张图片到 ${resolved}`,
      data: {
        path: resolved,
        total: unique.length,
        downloaded,
      },
    };
  },
};
