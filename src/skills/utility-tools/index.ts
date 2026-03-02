import { z } from "zod";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import QRCode from "qrcode";
import type { SkillDefinition } from "../types";

const execAsync = promisify(exec);

// ==================== 1. 哈希计算 ====================

export const hashCalcSkill: SkillDefinition = {
  name: "hash_calc",
  displayName: "哈希计算",
  description: "计算文本或文件的哈希值（MD5/SHA1/SHA256/SHA512）。用于校验文件完整性、密码哈希等。",
  icon: "Hash",
  category: "dev",
  parameters: z.object({
    input: z.string().optional().describe("要计算哈希的文本"),
    filePath: z.string().optional().describe("要计算哈希的文件路径"),
    algorithm: z.enum(["md5", "sha1", "sha256", "sha512"]).optional().describe("哈希算法，默认 sha256"),
  }),
  execute: async (params) => {
    const { input, filePath, algorithm = "sha256" } = params as { input?: string; filePath?: string; algorithm?: string };
    try {
      let data: Buffer | string;
      if (filePath) {
        data = await fs.readFile(path.resolve(filePath));
      } else if (input) {
        data = input;
      } else {
        return { success: false, message: "请提供 input 或 filePath" };
      }
      const hash = crypto.createHash(algorithm).update(data).digest("hex");
      const source = filePath ? path.basename(filePath) : `text(${(input || "").length}字符)`;
      return { success: true, message: `${algorithm.toUpperCase()}: ${hash}\n来源: ${source}`, data: { hash, algorithm } };
    } catch (err) {
      return { success: false, message: `哈希计算失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 2. Base64 编解码 ====================

export const base64Skill: SkillDefinition = {
  name: "base64_tool",
  displayName: "编码转换工具",
  description: "Base64编码或解码文本/文件。可用于数据传输编码、图片转Base64等。",
  icon: "Binary",
  category: "dev",
  parameters: z.object({
    action: z.enum(["encode", "decode"]).describe("操作：encode=编码，decode=解码"),
    text: z.string().optional().describe("要编码/解码的文本"),
    filePath: z.string().optional().describe("要编码的文件路径（仅encode时有效）"),
  }),
  execute: async (params) => {
    const { action, text, filePath } = params as { action: "encode" | "decode"; text?: string; filePath?: string };
    try {
      if (action === "encode") {
        if (filePath) {
          const data = await fs.readFile(path.resolve(filePath));
          const b64 = data.toString("base64");
          return { success: true, message: `文件编码完成 (${b64.length}字符)\n${b64.substring(0, 200)}${b64.length > 200 ? "..." : ""}`, data: { length: b64.length } };
        }
        if (!text) return { success: false, message: "请提供 text 或 filePath" };
        const b64 = Buffer.from(text, "utf-8").toString("base64");
        return { success: true, message: b64, data: { length: b64.length } };
      }
      if (!text) return { success: false, message: "decode 需要提供 text" };
      const decoded = Buffer.from(text, "base64").toString("utf-8");
      return { success: true, message: decoded, data: { length: decoded.length } };
    } catch (err) {
      return { success: false, message: `Base64操作失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 3. JSON Schema 验证 ====================

export const jsonValidatorSkill: SkillDefinition = {
  name: "json_validator",
  displayName: "数据格式校验",
  description: "验证JSON格式是否正确，支持美化格式化、压缩、提取字段路径。用于API开发调试。",
  icon: "Braces",
  category: "dev",
  parameters: z.object({
    json: z.string().describe("要验证的JSON字符串"),
    action: z.enum(["validate", "format", "minify", "paths"]).optional().describe("操作：validate=验证，format=美化，minify=压缩，paths=提取所有路径。默认validate"),
  }),
  execute: async (params) => {
    const { json, action = "validate" } = params as { json: string; action?: string };
    try {
      const parsed = JSON.parse(json);

      if (action === "format") {
        return { success: true, message: JSON.stringify(parsed, null, 2) };
      }
      if (action === "minify") {
        const minified = JSON.stringify(parsed);
        return { success: true, message: minified, data: { length: minified.length } };
      }
      if (action === "paths") {
        const paths: string[] = [];
        function walk(obj: unknown, prefix: string) {
          if (obj && typeof obj === "object") {
            for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
              const p = prefix ? `${prefix}.${k}` : k;
              paths.push(p);
              if (v && typeof v === "object") walk(v, p);
            }
          }
        }
        walk(parsed, "");
        return { success: true, message: `JSON路径 (${paths.length}个):\n${paths.join("\n")}`, data: { count: paths.length, paths } };
      }

      const type = Array.isArray(parsed) ? "array" : typeof parsed;
      const keys = typeof parsed === "object" && parsed ? Object.keys(parsed).length : 0;
      return {
        success: true,
        message: `JSON 格式正确\n类型: ${type}\n${type === "array" ? `元素数: ${(parsed as unknown[]).length}` : `键数: ${keys}`}\n大小: ${json.length}字符`,
        data: { valid: true, type, size: json.length },
      };
    } catch (err) {
      return { success: false, message: `JSON 格式错误: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 4. 端口扫描 ====================

export const portScanSkill: SkillDefinition = {
  name: "port_scan",
  displayName: "端口扫描",
  description: "扫描目标主机的多个端口开放状态。用于网络诊断、服务检测。",
  icon: "Scan",
  category: "dev",
  parameters: z.object({
    host: z.string().describe("目标主机IP或域名"),
    ports: z.string().optional().describe("要扫描的端口（逗号分隔或范围如80,443,8080-8090），默认常用端口"),
  }),
  execute: async (params) => {
    const { host, ports } = params as { host: string; ports?: string };

    const defaultPorts = [21, 22, 23, 25, 53, 80, 110, 143, 443, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443, 27017];
    let portList: number[] = defaultPorts;

    if (ports) {
      portList = [];
      for (const part of ports.split(",")) {
        const trimmed = part.trim();
        if (trimmed.includes("-")) {
          const [s, e] = trimmed.split("-").map(Number);
          for (let i = s; i <= Math.min(e, s + 100); i++) portList.push(i);
        } else {
          portList.push(Number(trimmed));
        }
      }
    }

    try {
      const results: { port: number; status: string }[] = [];

      async function checkPort(port: number): Promise<{ port: number; status: string }> {
        return new Promise((resolve) => {
          const net = require("net");
          const socket = new net.Socket();
          socket.setTimeout(2000);
          socket.on("connect", () => { socket.destroy(); resolve({ port, status: "OPEN" }); });
          socket.on("timeout", () => { socket.destroy(); resolve({ port, status: "FILTERED" }); });
          socket.on("error", () => { resolve({ port, status: "CLOSED" }); });
          socket.connect(port, host);
        });
      }

      const batchSize = 10;
      for (let i = 0; i < portList.length; i += batchSize) {
        const batch = portList.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(checkPort));
        results.push(...batchResults);
      }

      const open = results.filter((r) => r.status === "OPEN");
      const lines = results.map((r) => `  ${String(r.port).padStart(5)}  ${r.status}`);
      return {
        success: true,
        message: `扫描 ${host} 共 ${portList.length} 个端口，${open.length} 个开放:\n\n${lines.join("\n")}`,
        data: { host, scanned: portList.length, open: open.length, results },
      };
    } catch (err) {
      return { success: false, message: `端口扫描失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 5. 系统通知 ====================

export const notifySkill: SkillDefinition = {
  name: "notify",
  displayName: "系统通知",
  description: "发送Windows系统托盘通知（Toast Notification）。用于任务完成提醒、定时提醒等。",
  icon: "Bell",
  category: "life",
  parameters: z.object({
    title: z.string().describe("通知标题"),
    message: z.string().describe("通知内容"),
  }),
  execute: async (params) => {
    const { title, message } = params as { title: string; message: string };
    try {
      const ps = `powershell -command "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; $n.ShowBalloonTip(5000, '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', 'Info'); Start-Sleep -Seconds 3; $n.Dispose()"`;
      await execAsync(ps, { timeout: 10000 });
      return { success: true, message: `通知已发送: ${title}` };
    } catch (err) {
      return { success: false, message: `通知发送失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 6. 文本统计 ====================

export const textStatsSkill: SkillDefinition = {
  name: "text_stats",
  displayName: "文本统计",
  description: "统计文本的字数、词频、字符数、行数、阅读时间等。支持中英文混合文本分析。",
  icon: "BarChart3",
  category: "office",
  parameters: z.object({
    text: z.string().optional().describe("要统计的文本"),
    filePath: z.string().optional().describe("要统计的文件路径"),
  }),
  execute: async (params) => {
    const { text, filePath } = params as { text?: string; filePath?: string };
    let content = text || "";
    if (filePath) {
      try { content = await fs.readFile(path.resolve(filePath), "utf-8"); } catch (err) {
        return { success: false, message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    if (!content) return { success: false, message: "请提供 text 或 filePath" };

    const chars = content.length;
    const charsNoSpace = content.replace(/\s/g, "").length;
    const lines = content.split("\n").length;
    const cnChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const enWords = (content.match(/[a-zA-Z]+/g) || []).length;
    const numbers = (content.match(/\d+/g) || []).length;
    const sentences = (content.match(/[。！？.!?]+/g) || []).length || 1;
    const readTimeMin = Math.ceil((cnChars + enWords) / 300);
    const paragraphs = content.split(/\n\s*\n/).filter(Boolean).length;

    const wordFreq: Record<string, number> = {};
    const words = content.match(/[\u4e00-\u9fff]|[a-zA-Z]+/g) || [];
    for (const w of words) {
      const lower = w.toLowerCase();
      wordFreq[lower] = (wordFreq[lower] || 0) + 1;
    }
    const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 10);

    const stats = [
      `总字符数: ${chars}`,
      `字符数(无空格): ${charsNoSpace}`,
      `行数: ${lines}`,
      `段落数: ${paragraphs}`,
      `中文字数: ${cnChars}`,
      `英文单词数: ${enWords}`,
      `数字个数: ${numbers}`,
      `句子数: ${sentences}`,
      `预计阅读时间: ${readTimeMin} 分钟`,
      `\n高频词 TOP10:`,
      ...topWords.map(([w, c], i) => `  ${i + 1}. ${w} (${c}次)`),
    ];

    return { success: true, message: stats.join("\n"), data: { chars, lines, cnChars, enWords, readTimeMin } };
  },
};

// ==================== 7. UUID/随机数生成 ====================

export const randomGenSkill: SkillDefinition = {
  name: "random_gen",
  displayName: "随机数/UUID生成",
  description: "生成UUID、随机字符串、随机数字、随机密码等。用于开发调试、测试数据生成。",
  icon: "Dice5",
  category: "dev",
  parameters: z.object({
    type: z.enum(["uuid", "string", "number", "password", "hex"]).describe("生成类型"),
    count: z.number().optional().describe("生成个数，默认1"),
    length: z.number().optional().describe("字符串/密码长度，默认16"),
    min: z.number().optional().describe("随机数最小值，默认0"),
    max: z.number().optional().describe("随机数最大值，默认1000000"),
  }),
  execute: async (params) => {
    const { type, count = 1, length = 16, min = 0, max = 1000000 } = params as {
      type: string; count?: number; length?: number; min?: number; max?: number;
    };
    const results: string[] = [];
    const n = Math.min(count, 100);

    for (let i = 0; i < n; i++) {
      switch (type) {
        case "uuid":
          results.push(crypto.randomUUID());
          break;
        case "string":
          results.push(crypto.randomBytes(Math.ceil(length / 2)).toString("hex").substring(0, length));
          break;
        case "number":
          results.push(String(Math.floor(Math.random() * (max - min + 1)) + min));
          break;
        case "password": {
          const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=";
          let pwd = "";
          for (let j = 0; j < length; j++) pwd += charset[crypto.randomInt(charset.length)];
          results.push(pwd);
          break;
        }
        case "hex":
          results.push(crypto.randomBytes(length).toString("hex"));
          break;
      }
    }

    return { success: true, message: results.join("\n"), data: { type, count: n, values: results } };
  },
};

// ==================== 8. QR码生成 (标准qrcode库) ====================

export const qrcodeSkill: SkillDefinition = {
  name: "qrcode_gen",
  displayName: "二维码生成",
  description: "生成标准二维码图片（ISO/IEC 18004）。支持URL、文本、联系信息、WiFi等内容。可自定义颜色和纠错级别。保存为PNG图片。",
  icon: "QrCode",
  category: "life",
  parameters: z.object({
    content: z.string().describe("二维码内容（URL、文本、WiFi格式等）"),
    savePath: z.string().optional().describe("保存路径（.png），不提供则自动保存到 ~/.xiniu/qrcodes/"),
    size: z.number().optional().describe("二维码宽度(px)，默认512"),
    errorLevel: z.string().optional().describe("纠错级别: L(7%)/M(15%)/Q(25%)/H(30%)，默认M"),
    darkColor: z.string().optional().describe("前景色(hex)，默认#000000"),
    lightColor: z.string().optional().describe("背景色(hex)，默认#FFFFFF"),
  }),
  execute: async (params) => {
    const { content, savePath, size = 512, errorLevel = "M", darkColor = "#000000", lightColor = "#FFFFFF" } = params as {
      content: string; savePath?: string; size?: number; errorLevel?: string; darkColor?: string; lightColor?: string;
    };
    try {
      if (!content || content.trim().length === 0) {
        return { success: false, message: "请提供二维码内容" };
      }

      const ecLevel = (["L", "M", "Q", "H"].includes(errorLevel.toUpperCase()) ? errorLevel.toUpperCase() : "M") as "L" | "M" | "Q" | "H";

      const outPath = savePath
        ? path.resolve(savePath)
        : path.join(process.env.USERPROFILE || process.env.HOME || ".", ".xiniu", "qrcodes", `qr_${Date.now()}.png`);

      await fs.mkdir(path.dirname(outPath), { recursive: true });

      await QRCode.toFile(outPath, content, {
        width: size,
        margin: 2,
        errorCorrectionLevel: ecLevel,
        color: { dark: darkColor, light: lightColor },
      });

      const stat = await fs.stat(outPath);
      const sizeKB = (stat.size / 1024).toFixed(1);

      return {
        success: true,
        message: `二维码已生成: ${outPath}\n大小: ${sizeKB} KB · 尺寸: ${size}px · 纠错: ${ecLevel}\n内容: ${content.slice(0, 100)}${content.length > 100 ? "..." : ""}`,
        data: { path: outPath, size: stat.size, errorLevel: ecLevel },
      };
    } catch (err) {
      return { success: false, message: `二维码生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ==================== 9. 单位换算 ====================

export const unitConvertSkill: SkillDefinition = {
  name: "unit_convert",
  displayName: "单位换算",
  description: "各种单位换算：长度、重量、温度、面积、体积、数据大小、时间等。",
  icon: "ArrowLeftRight",
  category: "life",
  parameters: z.object({
    value: z.number().describe("数值"),
    from: z.string().describe("源单位（如 km, lb, celsius, GB 等）"),
    to: z.string().describe("目标单位"),
  }),
  execute: async (params) => {
    const { value, from, to } = params as { value: number; from: string; to: string };

    const conversions: Record<string, Record<string, number>> = {
      // 长度 (基准: 米)
      m: { km: 0.001, cm: 100, mm: 1000, mi: 0.000621371, ft: 3.28084, inch: 39.3701, yard: 1.09361 },
      km: { m: 1000, cm: 100000, mi: 0.621371, ft: 3280.84 },
      cm: { m: 0.01, mm: 10, inch: 0.393701, ft: 0.0328084 },
      mi: { km: 1.60934, m: 1609.34, ft: 5280 },
      ft: { m: 0.3048, cm: 30.48, inch: 12 },
      inch: { cm: 2.54, mm: 25.4, ft: 1 / 12 },
      // 重量 (基准: kg)
      kg: { g: 1000, lb: 2.20462, oz: 35.274, ton: 0.001 },
      g: { kg: 0.001, mg: 1000, lb: 0.00220462, oz: 0.035274 },
      lb: { kg: 0.453592, g: 453.592, oz: 16 },
      oz: { g: 28.3495, kg: 0.0283495, lb: 0.0625 },
      // 温度
      celsius: { fahrenheit: -1, kelvin: -2 },
      fahrenheit: { celsius: -3, kelvin: -4 },
      kelvin: { celsius: -5, fahrenheit: -6 },
      // 数据
      B: { KB: 1 / 1024, MB: 1 / 1048576, GB: 1 / 1073741824 },
      KB: { B: 1024, MB: 1 / 1024, GB: 1 / 1048576, TB: 1 / 1073741824 },
      MB: { B: 1048576, KB: 1024, GB: 1 / 1024, TB: 1 / 1048576 },
      GB: { B: 1073741824, KB: 1048576, MB: 1024, TB: 1 / 1024 },
      TB: { GB: 1024, MB: 1048576, KB: 1073741824 },
    };

    const fromLower = from.toLowerCase();
    const toLower = to.toLowerCase();

    // 温度特殊处理
    if (fromLower === "celsius" && toLower === "fahrenheit") {
      const r = value * 9 / 5 + 32;
      return { success: true, message: `${value}°C = ${r.toFixed(2)}°F`, data: { result: r } };
    }
    if (fromLower === "celsius" && toLower === "kelvin") {
      const r = value + 273.15;
      return { success: true, message: `${value}°C = ${r.toFixed(2)}K`, data: { result: r } };
    }
    if (fromLower === "fahrenheit" && toLower === "celsius") {
      const r = (value - 32) * 5 / 9;
      return { success: true, message: `${value}°F = ${r.toFixed(2)}°C`, data: { result: r } };
    }
    if (fromLower === "kelvin" && toLower === "celsius") {
      const r = value - 273.15;
      return { success: true, message: `${value}K = ${r.toFixed(2)}°C`, data: { result: r } };
    }

    const fromKey = Object.keys(conversions).find((k) => k.toLowerCase() === fromLower);
    const toKey = Object.keys(conversions).find((k) => k.toLowerCase() === toLower);

    if (fromKey && conversions[fromKey][toKey || to]) {
      const factor = conversions[fromKey][toKey || to];
      const result = value * factor;
      return { success: true, message: `${value} ${from} = ${result.toFixed(6).replace(/\.?0+$/, "")} ${to}`, data: { result } };
    }

    return { success: false, message: `不支持 ${from} → ${to} 换算。支持单位：m/km/cm/mm/mi/ft/inch, kg/g/lb/oz, celsius/fahrenheit/kelvin, B/KB/MB/GB/TB` };
  },
};

// ==================== 10. Markdown转HTML ====================

export const markdownToHtmlSkill: SkillDefinition = {
  name: "markdown_to_html",
  displayName: "文档格式转换",
  description: "将Markdown文本转换为HTML。可保存为HTML文件或返回HTML字符串。",
  icon: "FileCode",
  category: "dev",
  parameters: z.object({
    markdown: z.string().optional().describe("Markdown文本"),
    filePath: z.string().optional().describe("Markdown文件路径"),
    savePath: z.string().optional().describe("HTML保存路径（不提供则返回HTML字符串）"),
    includeStyle: z.boolean().optional().describe("是否包含默认CSS样式，默认true"),
  }),
  execute: async (params) => {
    const { markdown, filePath, savePath, includeStyle = true } = params as {
      markdown?: string; filePath?: string; savePath?: string; includeStyle?: boolean;
    };

    let md = markdown || "";
    if (filePath) {
      try { md = await fs.readFile(path.resolve(filePath), "utf-8"); } catch (err) {
        return { success: false, message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
    if (!md) return { success: false, message: "请提供 markdown 或 filePath" };

    let html = md
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/^\- (.+)$/gm, "<li>$1</li>")
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
      .replace(/^---$/gm, "<hr/>")
      .replace(/\n\n/g, "</p><p>")
      .replace(/^(?!<[hluop])/gm, "");

    html = `<p>${html}</p>`.replace(/<p><\/p>/g, "").replace(/<p>(<h[1-6])/g, "$1").replace(/(<\/h[1-6]>)<\/p>/g, "$1");

    const style = includeStyle ? `<style>
body{font-family:-apple-system,sans-serif;max-width:800px;margin:2em auto;padding:0 1em;color:#333;line-height:1.6}
h1,h2,h3{color:#1a1a1a;border-bottom:1px solid #eee;padding-bottom:.3em}
code{background:#f4f4f4;padding:.2em .4em;border-radius:3px;font-size:.9em}
a{color:#0366d6}li{margin:.3em 0}hr{border:none;border-top:1px solid #ddd}
</style>` : "";

    const fullHtml = `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>Document</title>\n${style}\n</head>\n<body>\n${html}\n</body>\n</html>`;

    if (savePath) {
      const resolved = path.resolve(savePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, fullHtml, "utf-8");
      return { success: true, message: `HTML已保存: ${resolved} (${fullHtml.length}字符)`, data: { path: resolved, size: fullHtml.length } };
    }

    return { success: true, message: fullHtml.substring(0, 2000), data: { size: fullHtml.length } };
  },
};
