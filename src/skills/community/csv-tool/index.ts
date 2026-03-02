import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as fs from "fs";
import * as path from "path";

function parseCSV(text: string, delimiter = ","): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else current += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === delimiter) { fields.push(current); current = ""; }
        else current += ch;
      }
    }
    fields.push(current);
    return fields;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function toCSV(headers: string[], rows: string[][], delimiter = ","): string {
  const escape = (s: string) => {
    if (s.includes(delimiter) || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(escape).join(delimiter)];
  for (const row of rows) lines.push(row.map(escape).join(delimiter));
  return lines.join("\n");
}

export const csvToolSkill: SkillDefinition = {
  name: "csv_tool",
  displayName: "表格数据处理",
  description: "CSV 文件的高级处理：统计信息(stats)、筛选(filter)、排序(sort)、去重(dedup)、选择列(select)、合并(merge)。用户说'CSV'、'csv处理'、'csv筛选'、'csv排序'、'csv去重'、'csv统计'、'表格处理'、'csv合并'时使用。",
  icon: "Table",
  category: "office",
  parameters: z.object({
    action: z.enum(["stats", "filter", "sort", "dedup", "select", "merge"]).describe("操作：stats=统计, filter=筛选, sort=排序, dedup=去重, select=选择列, merge=合并多个CSV"),
    filePath: z.string().describe("CSV 文件路径"),
    column: z.string().optional().describe("操作的列名（filter/sort/dedup 使用）"),
    operator: z.string().optional().describe("筛选运算符（filter）：eq/ne/gt/lt/gte/lte/contains/startsWith/endsWith"),
    value: z.string().optional().describe("筛选值（filter）"),
    order: z.enum(["asc", "desc"]).optional().describe("排序方向（sort），默认 asc"),
    columns: z.array(z.string()).optional().describe("要选择的列名列表（select）"),
    files: z.array(z.string()).optional().describe("其他 CSV 文件路径（merge 使用）"),
    output: z.string().optional().describe("输出文件路径（可选）"),
    delimiter: z.string().optional().describe("分隔符，默认逗号"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;
    const filePath = p.filePath as string;
    const delimiter = (p.delimiter as string) || ",";

    if (!fs.existsSync(filePath)) return { success: false, message: `❌ 文件不存在: ${filePath}` };

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const { headers, rows } = parseCSV(content, delimiter);

      if (headers.length === 0) return { success: false, message: "❌ CSV 文件为空或格式无效" };

      const outDir = path.join("C:\\Users\\Administrator\\Desktop", "output-csv");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const baseName = path.basename(filePath, path.extname(filePath));

      if (action === "stats") {
        const lines = [
          `📊 CSV 统计信息`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📁 文件: ${path.basename(filePath)}`,
          `📋 列数: ${headers.length}`,
          `📝 行数: ${rows.length}`,
          `\n📑 列信息:`,
        ];
        for (const h of headers) {
          const colIdx = headers.indexOf(h);
          const values = rows.map(r => r[colIdx] || "").filter(v => v.trim());
          const unique = new Set(values).size;
          const empty = rows.length - values.length;
          const isNumeric = values.length > 0 && values.every(v => !isNaN(Number(v)));
          let extra = `${unique} 个唯一值, ${empty} 个空值`;
          if (isNumeric && values.length > 0) {
            const nums = values.map(Number);
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            extra += `, 范围: ${min}~${max}, 平均: ${avg.toFixed(2)}`;
          }
          lines.push(`  ${h}: ${extra}`);
        }
        return { success: true, message: lines.join("\n"), data: { columns: headers.length, rows: rows.length, headers } };
      }

      if (action === "filter") {
        const col = p.column as string;
        const op = (p.operator as string) || "eq";
        const val = p.value as string;
        if (!col || val === undefined) return { success: false, message: "❌ filter 需要 column + value 参数" };

        const colIdx = headers.indexOf(col);
        if (colIdx === -1) return { success: false, message: `❌ 列 "${col}" 不存在。可用列: ${headers.join(", ")}` };

        const filtered = rows.filter(row => {
          const cell = row[colIdx] || "";
          switch (op) {
            case "eq": return cell === val;
            case "ne": return cell !== val;
            case "gt": return Number(cell) > Number(val);
            case "lt": return Number(cell) < Number(val);
            case "gte": return Number(cell) >= Number(val);
            case "lte": return Number(cell) <= Number(val);
            case "contains": return cell.includes(val);
            case "startsWith": return cell.startsWith(val);
            case "endsWith": return cell.endsWith(val);
            default: return cell === val;
          }
        });

        const outPath = (p.output as string) || path.join(outDir, `${baseName}-filtered.csv`);
        fs.writeFileSync(outPath, toCSV(headers, filtered, delimiter), "utf-8");
        return { success: true, message: `🔍 筛选完成\n━━━━━━━━━━━━━━━━━━━━\n📋 条件: ${col} ${op} ${val}\n📊 结果: ${filtered.length}/${rows.length} 行\n📁 输出: ${outPath}` };
      }

      if (action === "sort") {
        const col = p.column as string;
        if (!col) return { success: false, message: "❌ sort 需要 column 参数" };
        const colIdx = headers.indexOf(col);
        if (colIdx === -1) return { success: false, message: `❌ 列 "${col}" 不存在` };
        const order = (p.order as string) || "asc";

        const sorted = [...rows].sort((a, b) => {
          const va = a[colIdx] || "", vb = b[colIdx] || "";
          const na = Number(va), nb = Number(vb);
          if (!isNaN(na) && !isNaN(nb)) return order === "asc" ? na - nb : nb - na;
          return order === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        });

        const outPath = (p.output as string) || path.join(outDir, `${baseName}-sorted.csv`);
        fs.writeFileSync(outPath, toCSV(headers, sorted, delimiter), "utf-8");
        return { success: true, message: `🔄 排序完成\n━━━━━━━━━━━━━━━━━━━━\n📋 排序列: ${col} (${order})\n📊 行数: ${sorted.length}\n📁 输出: ${outPath}` };
      }

      if (action === "dedup") {
        const col = p.column as string;
        const colIdx = col ? headers.indexOf(col) : -1;
        if (col && colIdx === -1) return { success: false, message: `❌ 列 "${col}" 不存在` };

        const seen = new Set<string>();
        const deduped = rows.filter(row => {
          const key = col ? (row[colIdx] || "") : row.join("|");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const removed = rows.length - deduped.length;
        const outPath = (p.output as string) || path.join(outDir, `${baseName}-dedup.csv`);
        fs.writeFileSync(outPath, toCSV(headers, deduped, delimiter), "utf-8");
        return { success: true, message: `🧹 去重完成\n━━━━━━━━━━━━━━━━━━━━\n📋 去重依据: ${col || "全行"}\n📊 去除: ${removed} 行重复, 剩余 ${deduped.length} 行\n📁 输出: ${outPath}` };
      }

      if (action === "select") {
        const cols = p.columns as string[];
        if (!cols || cols.length === 0) return { success: false, message: "❌ select 需要 columns 参数" };
        const indices = cols.map(c => headers.indexOf(c));
        const invalid = cols.filter((_, i) => indices[i] === -1);
        if (invalid.length > 0) return { success: false, message: `❌ 列不存在: ${invalid.join(", ")}` };

        const newRows = rows.map(r => indices.map(i => r[i] || ""));
        const outPath = (p.output as string) || path.join(outDir, `${baseName}-selected.csv`);
        fs.writeFileSync(outPath, toCSV(cols, newRows, delimiter), "utf-8");
        return { success: true, message: `📋 列选择完成\n━━━━━━━━━━━━━━━━━━━━\n📋 选择列: ${cols.join(", ")}\n📊 行数: ${newRows.length}\n📁 输出: ${outPath}` };
      }

      if (action === "merge") {
        const files = p.files as string[];
        if (!files || files.length === 0) return { success: false, message: "❌ merge 需要 files 参数（其他CSV文件路径数组）" };

        let allRows = [...rows];
        for (const f of files) {
          if (!fs.existsSync(f)) return { success: false, message: `❌ 文件不存在: ${f}` };
          const fc = fs.readFileSync(f, "utf-8");
          const parsed = parseCSV(fc, delimiter);
          allRows = allRows.concat(parsed.rows);
        }

        const outPath = (p.output as string) || path.join(outDir, `${baseName}-merged.csv`);
        fs.writeFileSync(outPath, toCSV(headers, allRows, delimiter), "utf-8");
        return { success: true, message: `🔗 合并完成\n━━━━━━━━━━━━━━━━━━━━\n📋 文件数: ${1 + files.length}\n📊 总行数: ${allRows.length}\n📁 输出: ${outPath}` };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ CSV 处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
