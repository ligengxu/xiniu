import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

function padNumber(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatDate(date: Date, fmt: string): string {
  const y = date.getFullYear();
  const m = padNumber(date.getMonth() + 1, 2);
  const d = padNumber(date.getDate(), 2);
  const h = padNumber(date.getHours(), 2);
  const min = padNumber(date.getMinutes(), 2);
  const s = padNumber(date.getSeconds(), 2);
  return fmt
    .replace("YYYY", String(y)).replace("MM", m).replace("DD", d)
    .replace("HH", h).replace("mm", min).replace("ss", s);
}

export const batchRenameSkill: SkillDefinition = {
  name: "batch_rename",
  displayName: "文件批量重命名",
  description: "批量重命名目录中的文件。支持多种模式：序号重命名、正则替换、添加前后缀、日期重命名、大小写转换。支持预览模式（不实际修改）。用户说'批量重命名'、'文件重命名'、'rename'时使用。",
  icon: "FileText",
  category: "office",
  parameters: z.object({
    directory: z.string().describe("目标目录路径"),
    mode: z.enum(["sequence", "regex", "prefix_suffix", "date", "case", "extension"])
      .describe("模式: sequence=序号, regex=正则替换, prefix_suffix=加前后缀, date=日期, case=大小写, extension=改扩展名"),
    pattern: z.string().optional().describe("文件匹配模式(如 *.jpg, *.txt)，不填则匹配所有文件"),
    regex: z.string().optional().describe("regex模式的正则表达式"),
    replacement: z.string().optional().describe("regex模式的替换字符串"),
    prefix: z.string().optional().describe("添加的前缀"),
    suffix: z.string().optional().describe("添加的后缀(扩展名前)"),
    startNum: z.number().optional().describe("sequence模式的起始编号，默认1"),
    step: z.number().optional().describe("sequence模式的步长，默认1"),
    padWidth: z.number().optional().describe("sequence模式的数字位宽(如3→001)，默认3"),
    template: z.string().optional().describe("sequence/date模式的模板，如 'photo_{NUM}' 或 '{YYYY}{MM}{DD}_{NAME}'"),
    caseMode: z.string().optional().describe("case模式: upper=全大写, lower=全小写, capitalize=首字母大写, camel=驼峰"),
    newExtension: z.string().optional().describe("extension模式的新扩展名(如 .webp)"),
    preview: z.boolean().optional().describe("预览模式(不实际修改)，默认true"),
    sortBy: z.string().optional().describe("排序方式: name=按名称, date=按修改时间, size=按大小，默认name"),
  }),
  execute: async (params) => {
    const {
      directory, mode, pattern,
      regex, replacement = "",
      prefix = "", suffix = "",
      startNum = 1, step = 1, padWidth = 3,
      template, caseMode = "lower",
      newExtension, preview = true,
      sortBy = "name",
    } = params as {
      directory: string; mode: string; pattern?: string;
      regex?: string; replacement?: string;
      prefix?: string; suffix?: string;
      startNum?: number; step?: number; padWidth?: number;
      template?: string; caseMode?: string;
      newExtension?: string; preview?: boolean;
      sortBy?: string;
    };

    try {
      const dir = path.resolve(directory);
      let stat;
      try { stat = await fs.stat(dir); } catch { return { success: false, message: `目录不存在: ${dir}` }; }
      if (!stat.isDirectory()) return { success: false, message: `不是目录: ${dir}` };

      const allFiles = await fs.readdir(dir);

      const extMatch = (pattern || "").replace("*", "").toLowerCase();
      let files = allFiles.filter((f) => {
        if (!pattern) return true;
        return f.toLowerCase().endsWith(extMatch);
      });

      const fileStats = await Promise.all(files.map(async (f) => {
        const s = await fs.stat(path.join(dir, f));
        return { name: f, mtime: s.mtimeMs, size: s.size, isFile: s.isFile() };
      }));

      const onlyFiles = fileStats.filter((f) => f.isFile);

      switch (sortBy) {
        case "date": onlyFiles.sort((a, b) => a.mtime - b.mtime); break;
        case "size": onlyFiles.sort((a, b) => a.size - b.size); break;
        default: onlyFiles.sort((a, b) => a.name.localeCompare(b.name));
      }

      files = onlyFiles.map((f) => f.name);

      if (files.length === 0) {
        return { success: false, message: `目录中没有匹配的文件 (模式: ${pattern || "*"})` };
      }

      const renames: Array<{ from: string; to: string }> = [];
      let num = startNum;

      for (const file of files) {
        const ext = path.extname(file);
        const nameNoExt = path.basename(file, ext);
        let newName: string;

        switch (mode) {
          case "sequence": {
            const numStr = padNumber(num, padWidth);
            if (template) {
              newName = template
                .replace("{NUM}", numStr)
                .replace("{NAME}", nameNoExt)
                .replace("{EXT}", ext.slice(1))
                + ext;
            } else {
              newName = numStr + ext;
            }
            num += step;
            break;
          }

          case "regex": {
            if (!regex) { renames.push({ from: file, to: file }); continue; }
            try {
              const re = new RegExp(regex, "g");
              newName = file.replace(re, replacement);
            } catch (err) {
              return { success: false, message: "正则表达式无效: " + (err instanceof Error ? err.message : String(err)) };
            }
            break;
          }

          case "prefix_suffix": {
            newName = prefix + nameNoExt + suffix + ext;
            break;
          }

          case "date": {
            const fileStat = onlyFiles.find((f) => f.name === file);
            const mtime = fileStat ? new Date(fileStat.mtime) : new Date();
            const fmt = template || "{YYYY}{MM}{DD}_{NAME}";
            newName = formatDate(mtime, fmt).replace("{NAME}", nameNoExt).replace("{EXT}", ext.slice(1)) + ext;
            break;
          }

          case "case": {
            switch (caseMode) {
              case "upper": newName = nameNoExt.toUpperCase() + ext; break;
              case "lower": newName = nameNoExt.toLowerCase() + ext; break;
              case "capitalize": newName = nameNoExt.charAt(0).toUpperCase() + nameNoExt.slice(1).toLowerCase() + ext; break;
              case "camel": {
                newName = nameNoExt.replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase()).replace(/^./, (c) => c.toLowerCase()) + ext;
                break;
              }
              default: newName = file;
            }
            break;
          }

          case "extension": {
            if (!newExtension) { renames.push({ from: file, to: file }); continue; }
            const ne = newExtension.startsWith(".") ? newExtension : "." + newExtension;
            newName = nameNoExt + ne;
            break;
          }

          default:
            newName = file;
        }

        renames.push({ from: file, to: newName });
      }

      const changed = renames.filter((r) => r.from !== r.to);

      if (changed.length === 0) {
        return { success: true, message: "没有需要重命名的文件（所有文件名无变化）" };
      }

      let msg = `${preview ? "预览" : "执行"}批量重命名 (${changed.length}/${files.length}个文件)\n`;
      msg += `目录: ${dir}\n模式: ${mode}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n`;

      if (preview) {
        for (const r of changed.slice(0, 50)) {
          msg += `${r.from} → ${r.to}\n`;
        }
        if (changed.length > 50) msg += `... 还有 ${changed.length - 50} 个\n`;
        msg += `\n将 preview 设为 false 执行实际重命名。`;
      } else {
        let successCount = 0;
        for (const r of changed) {
          try {
            const fromPath = path.join(dir, r.from);
            const toPath = path.join(dir, r.to);

            if (fromPath !== toPath) {
              try { await fs.access(toPath); msg += `跳过(目标已存在): ${r.from} → ${r.to}\n`; continue; } catch {}
              await fs.rename(fromPath, toPath);
              msg += `${r.from} → ${r.to}\n`;
              successCount++;
            }
          } catch (err) {
            msg += `失败: ${r.from} → ${r.to} (${err instanceof Error ? err.message : String(err)})\n`;
          }
        }
        msg += `\n完成: ${successCount}/${changed.length} 个文件重命名成功`;
      }

      return {
        success: true, message: msg,
        data: { total: files.length, changed: changed.length, preview, renames: changed.slice(0, 100) },
      };
    } catch (err) {
      return { success: false, message: `批量重命名异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
