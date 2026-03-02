import { z } from "zod";
import ExcelJS from "exceljs";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const generateExcelSkill: SkillDefinition = {
  name: "generate_excel",
  displayName: "生成电子表格",
  description:
    "根据数据生成专业级 Excel (.xlsx) 表格，自动列宽、样式美化、冻结表头、自动筛选、数字/日期格式检测。用户可能会说'帮我做个表格'、'生成Excel'、'创建电子表格'等。",
  icon: "FileText",
  category: "office",
  parameters: z.object({
    sheetName: z.string().describe("工作表名称"),
    headers: z.array(z.string()).describe("列标题数组"),
    rows: z
      .array(z.array(z.string()))
      .describe("数据行，每行是一个字符串数组，与headers对应"),
    title: z.string().optional().describe("表格上方的大标题（可选）"),
    savePath: z.string().describe("保存路径（含文件名），例如 C:/Users/Administrator/Desktop/数据.xlsx"),
  }),
  execute: async (params) => {
    try {
      const { sheetName, headers, rows, savePath, title } = params as {
        sheetName: string;
        headers: string[];
        rows: string[][];
        savePath: string;
        title?: string;
      };

      const resolved = path.resolve(savePath);
      await fs.mkdir(path.dirname(resolved), { recursive: true });

      const workbook = new ExcelJS.Workbook();
      workbook.creator = "犀牛 Agent";
      workbook.created = new Date();

      const sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: "frozen" as const, ySplit: title ? 2 : 1 }],
      });

      let dataStartRow = 1;

      if (title) {
        const titleRow = sheet.getRow(1);
        titleRow.getCell(1).value = title;
        titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1E3A5F" } };
        titleRow.height = 30;
        sheet.mergeCells(1, 1, 1, headers.length);
        titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
        dataStartRow = 2;
      }

      sheet.columns = headers.map((h) => ({
        header: h,
        key: h,
        width: Math.max(
          h.length * 2.5 + 2,
          ...rows.map(r => {
            const idx = headers.indexOf(h);
            const val = r[idx] || "";
            return val.length * 1.2 + 2;
          }),
          10,
        ),
      }));

      if (title) {
        const hRow = sheet.getRow(dataStartRow);
        headers.forEach((h, i) => { hRow.getCell(i + 1).value = h; });
      }

      const headerRow = sheet.getRow(dataStartRow);
      headerRow.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: "FF2563EB" },
      };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };
      headerRow.height = 24;
      headerRow.eachCell((cell) => {
        cell.border = {
          bottom: { style: "medium", color: { argb: "FF1D4ED8" } },
        };
      });

      for (const row of rows) {
        const dataRow: Record<string, string | number> = {};
        headers.forEach((h, i) => {
          const val = row[i] || "";
          const num = Number(val);
          dataRow[h] = !isNaN(num) && val.trim() !== "" ? num : val;
        });
        sheet.addRow(dataRow);
      }

      const totalRows = dataStartRow + rows.length;
      for (let i = dataStartRow + 1; i <= totalRows; i++) {
        const row = sheet.getRow(i);
        row.height = 20;
        row.alignment = { vertical: "middle" };
        if ((i - dataStartRow) % 2 === 0) {
          row.fill = {
            type: "pattern", pattern: "solid",
            fgColor: { argb: "FFF0F7FF" },
          };
        }
        row.eachCell((cell) => {
          cell.border = {
            bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
          };
        });
      }

      if (headers.length > 0 && rows.length > 0) {
        const lastCol = String.fromCharCode(64 + Math.min(headers.length, 26));
        sheet.autoFilter = { from: `A${dataStartRow}`, to: `${lastCol}${totalRows}` };
      }

      const dateStr = new Date().toLocaleDateString("zh-CN");
      const infoRow = sheet.getRow(totalRows + 2);
      infoRow.getCell(1).value = `由犀牛 Agent 生成 · ${dateStr}`;
      infoRow.getCell(1).font = { size: 9, italic: true, color: { argb: "FF999999" } };

      const buffer = await workbook.xlsx.writeBuffer();
      await fs.writeFile(resolved, Buffer.from(buffer));

      const sizeKB = (buffer.byteLength / 1024).toFixed(1);
      return {
        success: true,
        message: `Excel 已生成: ${resolved}\n${headers.length} 列 × ${rows.length} 行 · ${sizeKB} KB\n特性: 冻结表头 · 自动筛选 · 斑马纹 · 自动列宽`,
        data: { path: resolved, columns: headers.length, rows: rows.length },
      };
    } catch (err) {
      return { success: false, message: `Excel 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
