import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

function getFileType(ext: string): string {
  const types: Record<string, string> = {
    ".txt": "文本文件", ".md": "Markdown", ".json": "JSON",
    ".csv": "CSV表格", ".xml": "XML", ".yaml": "YAML", ".yml": "YAML",
    ".js": "JavaScript", ".ts": "TypeScript", ".py": "Python",
    ".java": "Java", ".go": "Go", ".rs": "Rust", ".cpp": "C++", ".c": "C",
    ".html": "HTML", ".css": "CSS", ".sql": "SQL",
    ".jpg": "JPEG图片", ".jpeg": "JPEG图片", ".png": "PNG图片",
    ".gif": "GIF图片", ".svg": "SVG", ".webp": "WebP图片",
    ".mp4": "MP4视频", ".mp3": "MP3音频", ".wav": "WAV音频",
    ".pdf": "PDF", ".docx": "Word", ".xlsx": "Excel", ".pptx": "PowerPoint",
    ".zip": "ZIP压缩包", ".rar": "RAR压缩包", ".7z": "7Z压缩包",
  };
  return types[ext] || "未知类型";
}

function extractJsStructure(code: string): {
  functions: Array<{ name: string; line: number; params: string }>;
  classes: Array<{ name: string; line: number }>;
  exports: Array<{ name: string; line: number; type: string }>;
  globals: string[];
  imports: string[];
  strings: string[];
  apis: string[];
  crypto: string[];
} {
  const lines = code.split("\n");
  const functions: Array<{ name: string; line: number; params: string }> = [];
  const classes: Array<{ name: string; line: number }> = [];
  const exports: Array<{ name: string; line: number; type: string }> = [];
  const globals: string[] = [];
  const imports: string[] = [];
  const stringsSet = new Set<string>();
  const apisSet = new Set<string>();
  const cryptoSet = new Set<string>();

  const funcRe = /(?:function\s+(\w+)\s*\(([^)]*)\)|(\w+)\s*[=:]\s*(?:async\s+)?function\s*\(([^)]*)\)|(\w+)\s*[=:]\s*\(([^)]*)\)\s*=>)/g;
  const classRe = /class\s+(\w+)/g;
  const exportRe = /(?:export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)|module\.exports\s*[=.]|exports\.(\w+))/g;
  const importRe = /(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  const apiRe = /(?:fetch|XMLHttpRequest|\.ajax|\.get|\.post|\.put|\.delete|\.request|axios)\s*\(/gi;
  const urlRe = /['"]https?:\/\/[^'"]{10,}['"]/g;
  const cryptoRe = /(?:CryptoJS|crypto|md5|sha\d+|aes|rsa|hmac|base64|btoa|atob|encrypt|decrypt|hash|sign|messagePack|anti[_-]?content)/gi;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    funcRe.lastIndex = 0;
    while ((m = funcRe.exec(line)) !== null) {
      const name = m[1] || m[3] || m[5];
      const params = m[2] || m[4] || m[6] || "";
      if (name && name.length > 1) functions.push({ name, line: i + 1, params: params.trim() });
    }

    classRe.lastIndex = 0;
    while ((m = classRe.exec(line)) !== null) {
      classes.push({ name: m[1], line: i + 1 });
    }

    exportRe.lastIndex = 0;
    while ((m = exportRe.exec(line)) !== null) {
      const name = m[1] || m[2] || "default";
      exports.push({ name, line: i + 1, type: line.includes("function") ? "function" : line.includes("class") ? "class" : "value" });
    }

    importRe.lastIndex = 0;
    while ((m = importRe.exec(line)) !== null) {
      imports.push(m[1] || m[2]);
    }

    if (/^(?:var|let|const|window\.|globalThis\.)/.test(line.trim()) && i < 50) {
      const gm = line.trim().match(/^(?:var|let|const)\s+(\w+)/);
      if (gm) globals.push(gm[1]);
    }

    apiRe.lastIndex = 0;
    if (apiRe.test(line)) apisSet.add(line.trim().slice(0, 120));

    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(line)) !== null) {
      apisSet.add(m[0].slice(1, -1));
    }

    cryptoRe.lastIndex = 0;
    while ((m = cryptoRe.exec(line)) !== null) {
      cryptoSet.add(m[0]);
    }

    const strRe = /['"]([A-Za-z0-9+/=_-]{20,})['"]/g;
    while ((m = strRe.exec(line)) !== null && stringsSet.size < 30) {
      stringsSet.add(`行${i + 1}: ${m[1].slice(0, 80)}`);
    }
  }

  return {
    functions, classes, exports,
    globals: globals.slice(0, 30),
    imports: [...new Set(imports)],
    strings: [...stringsSet],
    apis: [...apisSet].slice(0, 30),
    crypto: [...cryptoSet],
  };
}

export const analyzeFileSkill: SkillDefinition = {
  name: "analyze_file",
  displayName: "文件深度分析",
  description:
    "深度分析文件内容：支持大文件分段读取（最大20MB）、JS/TS结构提取（函数/类/导出/导入/加密算法/API端点）、全文正则搜索、分块读取。用户说'分析文件'、'分析JS'、'看这个文件'、'提取函数'、'找加密'时使用。",
  icon: "FileSearch",
  category: "dev",
  parameters: z.object({
    filePath: z.string().describe("文件完整路径"),
    action: z.enum(["overview", "structure", "search", "read_chunk", "read_lines", "read_around"])
      .optional().default("overview")
      .describe("操作: overview=文件概览+摘要, structure=提取JS结构(函数/类/加密/API), search=全文正则搜索, read_chunk=分块读取, read_lines=按行范围读取, read_around=读取关键词周围上下文"),
    pattern: z.string().optional().describe("search: 正则表达式; read_around: 搜索关键词"),
    chunkIndex: z.number().optional().describe("read_chunk: 块序号(从0开始)，每块约50KB"),
    startLine: z.number().optional().describe("read_lines: 起始行(从1开始)"),
    endLine: z.number().optional().describe("read_lines: 结束行"),
    contextLines: z.number().optional().describe("read_around/search: 匹配行前后显示的上下文行数，默认5"),
    maxResults: z.number().optional().describe("search/read_around: 最大结果数，默认30"),
  }),
  execute: async (params) => {
    const {
      filePath, action = "overview",
      pattern, chunkIndex = 0,
      startLine, endLine,
      contextLines = 5, maxResults = 30,
    } = params as {
      filePath: string; action?: string;
      pattern?: string; chunkIndex?: number;
      startLine?: number; endLine?: number;
      contextLines?: number; maxResults?: number;
    };

    const resolved = path.resolve(filePath);

    try {
      await fs.access(resolved);
    } catch {
      return { success: false, message: `文件不存在: ${resolved}` };
    }

    const stats = await fs.stat(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const sizeKB = stats.size / 1024;
    const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(2)}MB` : `${sizeKB.toFixed(1)}KB`;
    const basename = path.basename(resolved);

    if (stats.isDirectory()) {
      const entries = await fs.readdir(resolved);
      return { success: true, message: `目录: ${basename} (${entries.length}项)\n${entries.slice(0, 30).join("\n")}`, data: { type: "directory", entries: entries.length } };
    }

    if (stats.size > 20 * 1024 * 1024) {
      return { success: false, message: `文件过大 (${sizeStr} > 20MB)，请用其他工具处理` };
    }

    try {
      const content = await fs.readFile(resolved, "utf-8");
      const allLines = content.split("\n");
      const totalLines = allLines.length;

      switch (action) {
        case "overview": {
          let msg = `文件分析: ${basename}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `路径: ${resolved}\n大小: ${sizeStr}\n类型: ${getFileType(ext)}\n行数: ${totalLines}\n修改: ${stats.mtime.toLocaleString()}\n\n`;

          const chunkSize = 50 * 1024;
          const totalChunks = Math.ceil(content.length / chunkSize);
          msg += `分块: ${totalChunks}块 (每块约50KB)\n`;

          if ([".js", ".ts", ".jsx", ".tsx", ".mjs"].includes(ext)) {
            const struct = extractJsStructure(content);
            msg += `\n【JS结构概要】\n`;
            msg += `  函数: ${struct.functions.length}个\n`;
            msg += `  类: ${struct.classes.length}个\n`;
            msg += `  导出: ${struct.exports.length}个\n`;
            msg += `  导入: ${struct.imports.length}个\n`;
            msg += `  加密/签名关键词: ${struct.crypto.length > 0 ? struct.crypto.join(", ") : "未检测到"}\n`;
            msg += `  API端点: ${struct.apis.length}个\n`;
            if (struct.crypto.length > 0) {
              msg += `\n⚠ 检测到加密/签名相关代码，建议用 structure 查看详情\n`;
            }
          }

          const previewLines = Math.min(20, totalLines);
          msg += `\n【前${previewLines}行预览】\n`;
          for (let i = 0; i < previewLines; i++) {
            msg += `${String(i + 1).padStart(6)} | ${allLines[i]}\n`;
          }
          if (totalLines > previewLines) msg += `  ... (还有 ${totalLines - previewLines} 行)\n`;
          msg += `\n【下一步操作】\n`;
          msg += `- structure: 提取完整JS结构(函数/类/加密/API)\n`;
          msg += `- search + pattern: 全文正则搜索关键代码\n`;
          msg += `- read_chunk + chunkIndex: 分块读取(0~${totalChunks - 1})\n`;
          msg += `- read_lines + startLine + endLine: 精确读取行范围\n`;
          msg += `- read_around + pattern: 读取关键词周围上下文`;

          return { success: true, message: msg, data: { totalLines, totalChunks, size: stats.size, ext } };
        }

        case "structure": {
          if (![".js", ".ts", ".jsx", ".tsx", ".mjs"].includes(ext)) {
            return { success: false, message: `structure 仅支持 JS/TS 文件，当前: ${ext}` };
          }

          const struct = extractJsStructure(content);
          let msg = `JS结构分析: ${basename} (${sizeStr})\n━━━━━━━━━━━━━━━━━━━━\n\n`;

          msg += `【函数 (${struct.functions.length}个)】\n`;
          for (const f of struct.functions.slice(0, 60)) {
            msg += `  行${String(f.line).padStart(6)}: ${f.name}(${f.params.slice(0, 60)})\n`;
          }
          if (struct.functions.length > 60) msg += `  ... 还有 ${struct.functions.length - 60} 个\n`;

          msg += `\n【类 (${struct.classes.length}个)】\n`;
          for (const c of struct.classes) msg += `  行${String(c.line).padStart(6)}: class ${c.name}\n`;

          msg += `\n【导出 (${struct.exports.length}个)】\n`;
          for (const e of struct.exports) msg += `  行${String(e.line).padStart(6)}: ${e.name} (${e.type})\n`;

          msg += `\n【导入 (${struct.imports.length}个)】\n`;
          for (const imp of struct.imports) msg += `  ${imp}\n`;

          if (struct.crypto.length > 0) {
            msg += `\n【🔐 加密/签名关键词】\n  ${struct.crypto.join(", ")}\n`;
            const cryptoLines: string[] = [];
            const cryptoRe = new RegExp(struct.crypto.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
            for (let i = 0; i < allLines.length && cryptoLines.length < 20; i++) {
              if (cryptoRe.test(allLines[i])) {
                cryptoLines.push(`  行${String(i + 1).padStart(6)}: ${allLines[i].trim().slice(0, 150)}`);
              }
              cryptoRe.lastIndex = 0;
            }
            msg += `\n【加密相关代码行】\n${cryptoLines.join("\n")}\n`;
          }

          if (struct.apis.length > 0) {
            msg += `\n【API端点/网络请求】\n`;
            for (const api of struct.apis) msg += `  ${api.slice(0, 150)}\n`;
          }

          if (struct.strings.length > 0) {
            msg += `\n【可疑长字符串】\n`;
            for (const s of struct.strings.slice(0, 15)) msg += `  ${s}\n`;
          }

          msg += `\n提示: 用 search + pattern 搜索具体函数/变量; 用 read_lines 查看具体行`;

          return { success: true, message: msg, data: { functions: struct.functions.length, classes: struct.classes.length, crypto: struct.crypto, apis: struct.apis.length } };
        }

        case "search": {
          if (!pattern) return { success: false, message: "需要提供 pattern (正则表达式)" };
          let regex: RegExp;
          try { regex = new RegExp(pattern, "gi"); } catch (e) {
            return { success: false, message: `正则语法错误: ${e instanceof Error ? e.message : String(e)}` };
          }

          const matches: Array<{ line: number; text: string; context: string[] }> = [];
          for (let i = 0; i < allLines.length && matches.length < maxResults; i++) {
            regex.lastIndex = 0;
            if (regex.test(allLines[i])) {
              const ctxStart = Math.max(0, i - contextLines);
              const ctxEnd = Math.min(allLines.length, i + contextLines + 1);
              const context: string[] = [];
              for (let j = ctxStart; j < ctxEnd; j++) {
                const prefix = j === i ? ">>>" : "   ";
                context.push(`${prefix}${String(j + 1).padStart(6)} | ${allLines[j]}`);
              }
              matches.push({ line: i + 1, text: allLines[i].trim().slice(0, 200), context });
            }
          }

          let msg = `搜索结果: /${pattern}/gi in ${basename}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `匹配: ${matches.length}处${matches.length >= maxResults ? "+" : ""}\n\n`;
          for (const m of matches) {
            msg += `--- 行 ${m.line} ---\n${m.context.join("\n")}\n\n`;
          }
          if (matches.length === 0) msg += "未找到匹配项\n";
          msg += `\n提示: 用 read_lines 查看更多上下文`;

          return { success: true, message: msg, data: { matchCount: matches.length, matches: matches.map((m) => ({ line: m.line, text: m.text })) } };
        }

        case "read_chunk": {
          const chunkSize = 50 * 1024;
          const totalChunks = Math.ceil(content.length / chunkSize);
          const idx = Math.max(0, Math.min(chunkIndex, totalChunks - 1));
          const start = idx * chunkSize;
          const end = Math.min(start + chunkSize, content.length);
          const chunk = content.slice(start, end);

          const chunkStartLine = content.slice(0, start).split("\n").length;
          const chunkLines = chunk.split("\n");

          let msg = `分块读取: ${basename} 块${idx}/${totalChunks - 1} (${(start / 1024).toFixed(0)}KB~${(end / 1024).toFixed(0)}KB)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
          for (let i = 0; i < chunkLines.length; i++) {
            msg += `${String(chunkStartLine + i).padStart(6)} | ${chunkLines[i]}\n`;
          }
          if (idx < totalChunks - 1) msg += `\n... 下一块: chunkIndex=${idx + 1}`;

          return { success: true, message: msg, data: { chunkIndex: idx, totalChunks, startByte: start, endByte: end, startLine: chunkStartLine } };
        }

        case "read_lines": {
          const s = Math.max(1, startLine || 1);
          const e = Math.min(totalLines, endLine || Math.min(s + 200, totalLines));
          const lines = allLines.slice(s - 1, e);

          let msg = `${basename} 行${s}-${e} (共${totalLines}行)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
          for (let i = 0; i < lines.length; i++) {
            msg += `${String(s + i).padStart(6)} | ${lines[i]}\n`;
          }
          if (e < totalLines) msg += `\n... 继续: startLine=${e + 1}`;

          return { success: true, message: msg, data: { startLine: s, endLine: e, totalLines, linesRead: lines.length } };
        }

        case "read_around": {
          if (!pattern) return { success: false, message: "需要提供 pattern (搜索关键词)" };
          const ctx = contextLines || 10;
          const matches: Array<{ line: number; context: string }> = [];

          for (let i = 0; i < allLines.length && matches.length < maxResults; i++) {
            if (allLines[i].includes(pattern)) {
              const ctxStart = Math.max(0, i - ctx);
              const ctxEnd = Math.min(allLines.length, i + ctx + 1);
              let context = "";
              for (let j = ctxStart; j < ctxEnd; j++) {
                const prefix = j === i ? ">>>" : "   ";
                context += `${prefix}${String(j + 1).padStart(6)} | ${allLines[j]}\n`;
              }
              matches.push({ line: i + 1, context });
            }
          }

          let msg = `关键词搜索: "${pattern}" in ${basename}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `匹配: ${matches.length}处 (上下文±${ctx}行)\n\n`;
          for (const m of matches) {
            msg += `--- 行 ${m.line} ---\n${m.context}\n`;
          }
          if (matches.length === 0) msg += "未找到\n";

          return { success: true, message: msg, data: { matchCount: matches.length, lines: matches.map((m) => m.line) } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `文件分析异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
