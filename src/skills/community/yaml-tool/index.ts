import { z } from "zod";
import type { SkillDefinition } from "../types";
import * as fs from "fs";

async function loadYaml(): Promise<typeof import("yaml")> {
  try {
    return await import("yaml");
  } catch {
    throw new Error("缺少 yaml 依赖，请安装: npm install yaml");
  }
}

export const yamlToolSkill: SkillDefinition = {
  name: "yaml_tool",
  displayName: "配置文件工具",
  description: "YAML 文件的验证、格式化、与 JSON 互转、查询指定路径的值。用户说'YAML'、'yaml验证'、'yaml格式化'、'yaml转json'、'json转yaml'、'yaml查询'、'yml'时使用。",
  icon: "FileText",
  category: "dev",
  parameters: z.object({
    action: z.enum(["validate", "format", "to_json", "from_json", "query"]).describe("操作：validate=验证, format=格式化, to_json=YAML转JSON, from_json=JSON转YAML, query=查询指定路径"),
    input: z.string().optional().describe("YAML/JSON 文本内容"),
    filePath: z.string().optional().describe("文件路径（优先于 input）"),
    path: z.string().optional().describe("查询路径（query操作），用点号分隔如 'server.port'"),
    indent: z.number().optional().describe("缩进空格数，默认 2"),
  }),
  execute: async (params) => {
    const { action, input, filePath, path: queryPath, indent } = params as {
      action: string; input?: string; filePath?: string; path?: string; indent?: number;
    };

    const yaml = await loadYaml();
    const spaces = indent || 2;

    try {
      let content = input || "";
      if (filePath) {
        if (!fs.existsSync(filePath)) return { success: false, message: `❌ 文件不存在: ${filePath}` };
        content = fs.readFileSync(filePath, "utf-8");
      }
      if (!content.trim()) return { success: false, message: "❌ 请提供 YAML/JSON 内容（input 或 filePath）" };

      if (action === "validate") {
        try {
          const doc = yaml.parse(content);
          const type = Array.isArray(doc) ? "数组" : typeof doc === "object" ? "对象" : typeof doc;
          const keys = typeof doc === "object" && doc !== null ? Object.keys(doc).length : 0;
          return {
            success: true,
            message: `✅ YAML 验证通过\n━━━━━━━━━━━━━━━━━━━━\n📦 类型: ${type}\n📋 顶级键: ${keys} 个\n💾 大小: ${content.length} 字符`,
            data: { valid: true, type, topLevelKeys: keys },
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, message: `❌ YAML 语法错误:\n${msg}` };
        }
      }

      if (action === "format") {
        const doc = yaml.parse(content);
        const formatted = yaml.stringify(doc, { indent: spaces });
        return {
          success: true,
          message: `✨ YAML 格式化完成\n━━━━━━━━━━━━━━━━━━━━\n${formatted}`,
          data: { formatted },
        };
      }

      if (action === "to_json") {
        const doc = yaml.parse(content);
        const json = JSON.stringify(doc, null, spaces);
        return {
          success: true,
          message: `🔄 YAML → JSON 转换完成\n━━━━━━━━━━━━━━━━━━━━\n${json}`,
          data: { json },
        };
      }

      if (action === "from_json") {
        let doc: unknown;
        try {
          doc = JSON.parse(content);
        } catch {
          return { success: false, message: "❌ 输入不是有效的 JSON" };
        }
        const yamlStr = yaml.stringify(doc, { indent: spaces });
        return {
          success: true,
          message: `🔄 JSON → YAML 转换完成\n━━━━━━━━━━━━━━━━━━━━\n${yamlStr}`,
          data: { yaml: yamlStr },
        };
      }

      if (action === "query") {
        if (!queryPath) return { success: false, message: "❌ query 操作需要 path 参数（如 'server.port'）" };
        const doc = yaml.parse(content) as Record<string, unknown>;
        const parts = queryPath.split(".");
        let current: unknown = doc;
        for (const part of parts) {
          if (current === null || current === undefined) break;
          if (typeof current === "object" && !Array.isArray(current)) {
            current = (current as Record<string, unknown>)[part];
          } else if (Array.isArray(current)) {
            const idx = parseInt(part);
            current = Number.isFinite(idx) ? current[idx] : undefined;
          } else {
            current = undefined;
          }
        }

        if (current === undefined) {
          return { success: false, message: `❌ 路径 "${queryPath}" 未找到` };
        }

        const valueStr = typeof current === "object" ? JSON.stringify(current, null, 2) : String(current);
        return {
          success: true,
          message: `🔍 YAML 查询结果\n━━━━━━━━━━━━━━━━━━━━\n📍 路径: ${queryPath}\n📦 类型: ${Array.isArray(current) ? "数组" : typeof current}\n📋 值:\n${valueStr}`,
          data: { path: queryPath, value: current as Record<string, unknown> },
        };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ YAML 处理异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
