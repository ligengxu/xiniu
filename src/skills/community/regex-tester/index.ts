import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

interface RegexPreset {
  name: string;
  pattern: string;
  flags: string;
  description: string;
  examples: string[];
}

const PRESETS: RegexPreset[] = [
  { name: "手机号", pattern: "^1[3-9]\\d{9}$", flags: "", description: "中国大陆手机号", examples: ["13800138000", "15912345678"] },
  { name: "邮箱", pattern: "^[\\w.+-]+@[\\w-]+\\.[\\w.]+$", flags: "i", description: "电子邮箱地址", examples: ["test@qq.com", "user.name@company.co"] },
  { name: "身份证", pattern: "^\\d{17}[\\dXx]$", flags: "", description: "18位身份证号", examples: ["110101199003074518"] },
  { name: "URL", pattern: "https?://[\\w\\-]+(\\.[\\w\\-]+)+[\\w\\-.,@?^=%&:/~+#]*", flags: "gi", description: "HTTP/HTTPS网址", examples: ["https://www.baidu.com/s?wd=test"] },
  { name: "IP地址", pattern: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", flags: "g", description: "IPv4地址", examples: ["192.168.1.1", "10.0.0.1"] },
  { name: "日期", pattern: "\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}", flags: "g", description: "日期格式 YYYY-MM-DD", examples: ["2026-03-01", "2026/1/15"] },
  { name: "中文", pattern: "[\\u4e00-\\u9fff]+", flags: "g", description: "匹配中文字符", examples: ["你好世界", "测试123"] },
  { name: "数字", pattern: "-?\\d+\\.?\\d*", flags: "g", description: "整数或小数", examples: ["3.14", "-100", "0.5"] },
  { name: "HTML标签", pattern: "<[^>]+>", flags: "gi", description: "匹配HTML标签", examples: ["<div class='test'>", "</p>"] },
  { name: "颜色HEX", pattern: "#[0-9a-fA-F]{3,8}", flags: "g", description: "CSS颜色HEX值", examples: ["#FF5500", "#fff", "#00FF00FF"] },
  { name: "密码强度", pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*]).{8,}$", flags: "", description: "至少含大小写+数字+符号，8位以上", examples: ["Abc123!@"] },
  { name: "车牌号", pattern: "^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁][A-Z][A-Z0-9]{5}$", flags: "", description: "中国车牌号", examples: ["京A12345", "粤B88888"] },
];

export const regexTesterSkill: SkillDefinition = {
  name: "regex_tester",
  displayName: "正则表达式测试",
  description: "正则表达式测试工具：匹配测试、提取内容、替换操作、常用正则预设（手机号/邮箱/身份证/URL/IP等12种）。用户说'正则'、'regex'、'匹配'、'提取'时使用。",
  icon: "Code",
  category: "dev",
  parameters: z.object({
    action: z.enum(["test", "match", "replace", "presets", "explain"])
      .describe("操作: test=测试匹配, match=提取所有匹配, replace=正则替换, presets=常用预设, explain=解释正则"),
    pattern: z.string().optional().describe("正则表达式(不含分隔符)"),
    flags: z.string().optional().describe("正则标志: g(全局) i(不区分大小写) m(多行) s(dotAll)，默认空"),
    text: z.string().optional().describe("要测试的文本"),
    filePath: z.string().optional().describe("从文件读取文本(支持大文件，优先于text参数)，如 C:/Users/Administrator/Desktop/react_pdd.js"),
    replacement: z.string().optional().describe("replace操作的替换字符串(支持$1等捕获组引用)"),
    presetName: z.string().optional().describe("使用预设正则(手机号/邮箱/身份证/URL/IP/日期/中文/数字/HTML标签/颜色HEX/密码强度/车牌号)"),
  }),
  execute: async (params) => {
    const { action, pattern: inputPattern, flags: inputFlags = "", text: rawText, filePath, replacement = "", presetName } = params as {
      action: string; pattern?: string; flags?: string; text?: string; filePath?: string; replacement?: string; presetName?: string;
    };

    try {
      if (action === "presets") {
        let msg = `常用正则预设 (${PRESETS.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const p of PRESETS) {
          msg += `[${p.name}]\n  正则: /${p.pattern}/${p.flags}\n  说明: ${p.description}\n  示例: ${p.examples.join(", ")}\n\n`;
        }
        msg += `使用方式: presetName="手机号" + text="你的文本"\n提示: 也可用 filePath 直接对大文件进行正则搜索`;
        return { success: true, message: msg, data: { presets: PRESETS.map((p) => ({ name: p.name, pattern: p.pattern, flags: p.flags })) } };
      }

      let pattern = inputPattern || "";
      let flags = inputFlags;

      if (presetName) {
        const preset = PRESETS.find((p) => p.name === presetName || p.name.includes(presetName));
        if (preset) {
          pattern = preset.pattern;
          flags = flags || preset.flags;
        } else {
          return { success: false, message: `未找到预设"${presetName}"，可用: ${PRESETS.map((p) => p.name).join("/")}` };
        }
      }

      if (!pattern) return { success: false, message: "需要提供 pattern 或 presetName 参数" };

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, flags);
      } catch (err) {
        return { success: false, message: `正则表达式语法错误: ${err instanceof Error ? err.message : String(err)}` };
      }

      if (action === "explain") {
        let msg = `正则表达式解析\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `表达式: /${pattern}/${flags}\n\n`;

        const tokens: string[] = [];
        const explanations: Record<string, string> = {
          "^": "字符串开头", "$": "字符串结尾",
          "\\d": "数字(0-9)", "\\D": "非数字", "\\w": "单词字符(字母/数字/_)", "\\W": "非单词字符",
          "\\s": "空白字符", "\\S": "非空白字符", "\\b": "单词边界",
          ".": "任意字符(除换行)", "*": "重复0+次", "+": "重复1+次", "?": "可选(0或1次)",
          "(?=": "正向前瞻", "(?!": "负向前瞻", "(?:": "非捕获组",
        };
        for (const [token, desc] of Object.entries(explanations)) {
          if (pattern.includes(token)) tokens.push(`${token} → ${desc}`);
        }

        const quantifiers = pattern.match(/\{(\d+)(,\d*)?\}/g);
        if (quantifiers) {
          quantifiers.forEach((q) => {
            const m = q.match(/\{(\d+)(,(\d*))?\}/);
            if (m) {
              if (m[3] !== undefined) tokens.push(`${q} → 重复${m[1]}到${m[3] || "∞"}次`);
              else tokens.push(`${q} → 精确重复${m[1]}次`);
            }
          });
        }

        const groups = pattern.match(/\((?!\?)/g);
        if (groups) tokens.push(`() → ${groups.length}个捕获组`);

        const charClasses = pattern.match(/\[[^\]]+\]/g);
        if (charClasses) charClasses.forEach((cc) => tokens.push(`${cc} → 字符集`));

        if (flags) {
          const flagDesc: Record<string, string> = { g: "全局匹配", i: "不区分大小写", m: "多行模式", s: "dotAll模式" };
          const flagExplain = flags.split("").map((f) => flagDesc[f] || f).join(", ");
          tokens.push(`flags: ${flagExplain}`);
        }

        msg += `组成分析:\n${tokens.map((t) => `  ${t}`).join("\n")}`;

        return { success: true, message: msg, data: { pattern, flags, tokens } };
      }

      let text = rawText || "";
      let fileInfo = "";

      if (filePath) {
        const resolved = path.resolve(filePath);
        try {
          await fs.access(resolved);
          const stats = await fs.stat(resolved);
          if (stats.size > 20 * 1024 * 1024) {
            return { success: false, message: `文件过大 (${(stats.size / 1024 / 1024).toFixed(1)}MB)，最大支持20MB` };
          }
          text = await fs.readFile(resolved, "utf-8");
          fileInfo = `文件: ${path.basename(resolved)} (${(stats.size / 1024).toFixed(1)}KB, ${text.split("\n").length}行)\n`;
        } catch (err) {
          return { success: false, message: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` };
        }
      }

      if (!text) return { success: false, message: "需要提供 text 或 filePath 参数" };

      const contextRadius = 80;
      function getContext(src: string, idx: number, len: number): string {
        const start = Math.max(0, idx - contextRadius);
        const end = Math.min(src.length, idx + len + contextRadius);
        let ctx = "";
        if (start > 0) ctx += "...";
        ctx += src.slice(start, idx) + ">>>" + src.slice(idx, idx + len) + "<<<" + src.slice(idx + len, end);
        if (end < src.length) ctx += "...";
        return ctx.replace(/\n/g, "\\n");
      }

      function getLineCol(src: string, idx: number): { line: number; col: number } {
        const before = src.slice(0, idx);
        const line = before.split("\n").length;
        const lastNl = before.lastIndexOf("\n");
        const col = idx - lastNl;
        return { line, col };
      }

      switch (action) {
        case "test": {
          const isMatch = regex.test(text);
          const allMatches = text.match(new RegExp(pattern, flags.includes("g") ? flags : flags + "g")) || [];

          let msg = `正则匹配测试\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += fileInfo;
          msg += `正则: /${pattern}/${flags}\n`;
          if (!filePath) msg += `文本: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}\n`;
          msg += `结果: ${isMatch ? "匹配" : "不匹配"}\n`;
          if (allMatches.length > 0) msg += `匹配数: ${allMatches.length}\n匹配内容: ${allMatches.slice(0, 20).join(", ")}`;

          return { success: true, message: msg, data: { isMatch, matchCount: allMatches.length, matches: allMatches.slice(0, 50) } };
        }

        case "match": {
          const globalRegex = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
          const matches: Array<{ full: string; groups: string[]; index: number; line: number; col: number; context: string }> = [];
          let m;
          while ((m = globalRegex.exec(text)) !== null && matches.length < 200) {
            const lc = getLineCol(text, m.index);
            matches.push({
              full: m[0].length > 500 ? m[0].slice(0, 500) + `...(${m[0].length}字符)` : m[0],
              groups: m.slice(1).map((g) => g == null ? "" : g.length > 200 ? g.slice(0, 200) + "..." : g),
              index: m.index,
              line: lc.line,
              col: lc.col,
              context: getContext(text, m.index, m[0].length),
            });
            if (!flags.includes("g")) break;
          }

          let msg = `正则提取结果\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += fileInfo;
          msg += `正则: /${pattern}/${flags}\n`;
          msg += `匹配数: ${matches.length}${matches.length >= 200 ? "+" : ""}\n\n`;

          matches.slice(0, 50).forEach((match, i) => {
            msg += `${i + 1}. [行${match.line}:列${match.col}] "${match.full}"`;
            if (match.groups.length > 0 && match.groups.some((g) => g)) {
              msg += `\n   捕获组: [${match.groups.join(", ")}]`;
            }
            msg += `\n   上下文: ${match.context}\n\n`;
          });
          if (matches.length > 50) msg += `... 还有 ${matches.length - 50} 个匹配（data字段含全部）`;

          return { success: true, message: msg, data: { matchCount: matches.length, matches } };
        }

        case "replace": {
          const changeCount = (text.match(new RegExp(pattern, flags.includes("g") ? flags : flags + "g")) || []).length;

          if (filePath && changeCount > 0) {
            const result = text.replace(regex, replacement);
            const resolved = path.resolve(filePath);
            const backupPath = resolved + ".bak";
            await fs.writeFile(backupPath, text, "utf-8");
            await fs.writeFile(resolved, result, "utf-8");

            let msg = `正则替换结果\n━━━━━━━━━━━━━━━━━━━━\n`;
            msg += fileInfo;
            msg += `正则: /${pattern}/${flags}\n`;
            msg += `替换为: "${replacement}"\n`;
            msg += `替换数: ${changeCount}\n`;
            msg += `备份: ${path.basename(backupPath)}\n`;
            msg += `已写入原文件`;

            return { success: true, message: msg, data: { changeCount, backupPath, filePath: resolved } };
          }

          const result = text.replace(regex, replacement);
          let msg = `正则替换结果\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `正则: /${pattern}/${flags}\n`;
          msg += `替换为: "${replacement}"\n`;
          msg += `替换数: ${changeCount}\n\n`;
          msg += `原文:\n${text.slice(0, 500)}\n\n`;
          msg += `结果:\n${result.slice(0, 500)}`;

          return { success: true, message: msg, data: { original: text, result, changeCount } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `正则处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
