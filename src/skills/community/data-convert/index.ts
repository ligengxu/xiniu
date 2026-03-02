import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

function jsonToCsv(data: unknown[]): string {
  if (!Array.isArray(data) || data.length === 0) return "";
  const headers = new Set<string>();
  data.forEach((row) => { if (typeof row === "object" && row) Object.keys(row).forEach((k) => headers.add(k)); });
  const cols = Array.from(headers);

  const escapeCell = (val: unknown): string => {
    const str = val === null || val === undefined ? "" : String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const lines = [cols.join(",")];
  for (const row of data) {
    const obj = row as Record<string, unknown>;
    lines.push(cols.map((col) => escapeCell(obj[col])).join(","));
  }
  return lines.join("\n");
}

function csvToJson(csv: string): Record<string, string>[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let current = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuote = true; }
        else if (ch === ",") { cells.push(current.trim()); current = ""; }
        else { current += ch; }
      }
    }
    cells.push(current.trim());
    return cells;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ""; });
    return obj;
  });
}

function jsonToXml(data: unknown, rootTag = "root", indent = 0): string {
  const pad = "  ".repeat(indent);

  if (Array.isArray(data)) {
    return data.map((item) => `${pad}<item>\n${jsonToXml(item, "item", indent + 1)}${pad}</item>\n`).join("");
  }

  if (typeof data === "object" && data !== null) {
    let xml = "";
    for (const [key, value] of Object.entries(data)) {
      const tag = key.replace(/[^a-zA-Z0-9_-]/g, "_");
      if (typeof value === "object" && value !== null) {
        xml += `${pad}<${tag}>\n${jsonToXml(value, tag, indent + 1)}${pad}</${tag}>\n`;
      } else {
        const escaped = String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        xml += `${pad}<${tag}>${escaped}</${tag}>\n`;
      }
    }
    return xml;
  }

  return `${pad}${String(data ?? "")}\n`;
}

function xmlToJson(xml: string): unknown {
  const cleaned = xml.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return parseXmlNode(cleaned);
}

function parseXmlNode(xml: string): unknown {
  const tagMatch = xml.match(/^<([a-zA-Z_][\w.-]*)([^>]*)>([\s\S]*)<\/\1>$/);
  if (!tagMatch) return xml.trim();

  const content = tagMatch[3].trim();
  const children = extractChildren(content);

  if (children.length === 0) return content;

  const result: Record<string, unknown> = {};
  for (const child of children) {
    const childTag = child.match(/^<([a-zA-Z_][\w.-]*)/);
    if (!childTag) continue;
    const key = childTag[1];
    const parsed = parseXmlNode(child);

    if (result[key] !== undefined) {
      if (Array.isArray(result[key])) (result[key] as unknown[]).push(parsed);
      else result[key] = [result[key], parsed];
    } else {
      result[key] = parsed;
    }
  }

  return result;
}

function extractChildren(content: string): string[] {
  const children: string[] = [];
  let i = 0;

  while (i < content.length) {
    const start = content.indexOf("<", i);
    if (start === -1) break;

    const tagNameMatch = content.slice(start).match(/^<([a-zA-Z_][\w.-]*)/);
    if (!tagNameMatch) { i = start + 1; continue; }

    const tagName = tagNameMatch[1];
    const closeTag = `</${tagName}>`;
    let depth = 0;
    let j = start;

    while (j < content.length) {
      const openIdx = content.indexOf(`<${tagName}`, j);
      const closeIdx = content.indexOf(closeTag, j);

      if (closeIdx === -1) break;

      if (openIdx !== -1 && openIdx < closeIdx) {
        const afterOpen = content.indexOf(">", openIdx);
        if (afterOpen !== -1 && afterOpen < closeIdx) {
          depth++;
          j = afterOpen + 1;
          continue;
        }
      }

      if (depth === 0) {
        children.push(content.slice(start, closeIdx + closeTag.length));
        i = closeIdx + closeTag.length;
        break;
      }

      depth--;
      j = closeIdx + closeTag.length;
    }

    if (j >= content.length) i = content.length;
  }

  return children;
}

function yamlLikeToJson(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([^:#]+)\s*:\s*(.*)$/);
    if (match) {
      result[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

export const dataConvertSkill: SkillDefinition = {
  name: "data_convert",
  displayName: "数据格式转换",
  description: "数据格式互转：JSON/CSV/XML/YAML相互转换。支持直接文本输入或读取文件，可输出到文件。用户说'JSON转CSV'、'CSV转JSON'、'XML转JSON'、'格式转换'、'数据转换'时使用。",
  icon: "ArrowLeftRight",
  category: "office",
  parameters: z.object({
    from: z.enum(["json", "csv", "xml", "yaml"]).describe("源格式"),
    to: z.enum(["json", "csv", "xml", "yaml"]).describe("目标格式"),
    data: z.string().optional().describe("要转换的数据文本"),
    inputFile: z.string().optional().describe("输入文件路径(替代data参数)"),
    outputFile: z.string().optional().describe("输出文件路径(不填则只返回结果)"),
    pretty: z.boolean().optional().describe("JSON输出是否格式化，默认true"),
    xmlRoot: z.string().optional().describe("XML根元素名，默认'root'"),
  }),
  execute: async (params) => {
    const {
      from: srcFormat, to: tgtFormat,
      data: inputData, inputFile, outputFile,
      pretty = true, xmlRoot = "root",
    } = params as {
      from: string; to: string;
      data?: string; inputFile?: string; outputFile?: string;
      pretty?: boolean; xmlRoot?: string;
    };

    try {
      let raw = inputData || "";
      if (inputFile) {
        const resolved = path.resolve(inputFile);
        try { raw = await fs.readFile(resolved, "utf-8"); } catch {
          return { success: false, message: `读取文件失败: ${resolved}` };
        }
      }

      if (!raw.trim()) return { success: false, message: "没有数据可转换，请提供 data 或 inputFile" };

      let intermediate: unknown;

      switch (srcFormat) {
        case "json":
          try { intermediate = JSON.parse(raw); } catch (e) {
            return { success: false, message: `JSON解析失败: ${e instanceof Error ? e.message : String(e)}` };
          }
          break;
        case "csv":
          intermediate = csvToJson(raw);
          break;
        case "xml":
          intermediate = xmlToJson(raw);
          break;
        case "yaml":
          intermediate = yamlLikeToJson(raw);
          break;
        default:
          return { success: false, message: `不支持的源格式: ${srcFormat}` };
      }

      let result: string;

      switch (tgtFormat) {
        case "json":
          result = pretty ? JSON.stringify(intermediate, null, 2) : JSON.stringify(intermediate);
          break;
        case "csv": {
          const arr = Array.isArray(intermediate) ? intermediate : [intermediate];
          result = jsonToCsv(arr);
          if (!result) return { success: false, message: "数据无法转为CSV（需要对象数组）" };
          break;
        }
        case "xml":
          result = `<?xml version="1.0" encoding="UTF-8"?>\n<${xmlRoot}>\n${jsonToXml(intermediate, xmlRoot, 1)}</${xmlRoot}>`;
          break;
        case "yaml": {
          const obj = typeof intermediate === "object" && intermediate ? intermediate : { value: intermediate };
          result = Object.entries(obj as Record<string, unknown>)
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
            .join("\n");
          break;
        }
        default:
          return { success: false, message: `不支持的目标格式: ${tgtFormat}` };
      }

      if (outputFile) {
        const outPath = path.resolve(outputFile);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, result, "utf-8");
      }

      const preview = result.length > 2000 ? result.slice(0, 2000) + `\n... (共${result.length}字符)` : result;

      let msg = `格式转换完成 (${srcFormat.toUpperCase()} → ${tgtFormat.toUpperCase()})\n`;
      msg += `输入: ${inputFile || `${raw.length}字符文本`}\n`;
      if (outputFile) msg += `输出: ${path.resolve(outputFile)}\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━\n${preview}`;

      return {
        success: true, message: msg,
        data: { from: srcFormat, to: tgtFormat, resultLength: result.length, outputFile: outputFile ? path.resolve(outputFile) : undefined },
      };
    } catch (err) {
      return { success: false, message: `格式转换异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
