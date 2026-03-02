import { z } from "zod";

export const SkillParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string().min(1),
  required: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const PromptExecutionSchema = z.object({
  type: z.literal("prompt"),
  prompt: z.string().min(1),
  model: z.string().optional(),
});

export const ComposeStepSchema = z.object({
  skill: z.string().min(1),
  params: z.record(z.string(), z.string()).describe("支持 {{变量名}} 模板引用"),
  outputAs: z.string().optional().describe("将此步骤结果命名为变量，供后续步骤引用"),
});

export const ComposeExecutionSchema = z.object({
  type: z.literal("compose"),
  steps: z.array(ComposeStepSchema).min(1),
});

export const CodeExecutionSchema = z.object({
  type: z.literal("code"),
  code: z.string().min(1).describe("要执行的 JavaScript/TypeScript 代码（Node.js 环境）"),
  runtime: z.enum(["node"]).default("node"),
  dependencies: z.array(z.string()).default([]).describe("需要的 npm 包名列表（安装时自动 npm install）"),
  timeout: z.number().default(30000).describe("执行超时毫秒数"),
});

export const SkillExecutionSchema = z.discriminatedUnion("type", [
  PromptExecutionSchema,
  ComposeExecutionSchema,
  CodeExecutionSchema,
]);

export const SkillConfigSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/, "技能名仅支持小写字母/数字/下划线，且以字母开头"),
  displayName: z.string().min(1),
  description: z.string().min(1),
  icon: z.string().default("Wrench"),
  category: z.enum(["office", "dev", "life", "creative"]).default("life"),
  version: z.string().default("1.0.0"),
  author: z.string().default("user"),
  tags: z.array(z.string()).default([]),
  parameters: z.array(SkillParameterSchema).default([]),
  execution: SkillExecutionSchema,
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type SkillParameter = z.infer<typeof SkillParameterSchema>;
export type PromptExecution = z.infer<typeof PromptExecutionSchema>;
export type ComposeStep = z.infer<typeof ComposeStepSchema>;
export type ComposeExecution = z.infer<typeof ComposeExecutionSchema>;
export type CodeExecution = z.infer<typeof CodeExecutionSchema>;
export type SkillExecution = z.infer<typeof SkillExecutionSchema>;
export type SkillConfig = z.infer<typeof SkillConfigSchema>;

export const StoreIndexItemSchema = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  author: z.string(),
  downloads: z.number().default(0),
  version: z.string().default("1.0.0"),
  tags: z.array(z.string()).default([]),
  url: z.string().url(),
});

export type StoreIndexItem = z.infer<typeof StoreIndexItemSchema>;

export function validateSkillConfig(data: unknown): { success: true; data: SkillConfig } | { success: false; errors: string[] } {
  const result = SkillConfigSchema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
  return { success: false, errors };
}

export function skillConfigToJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["name", "displayName", "description", "execution"],
    properties: {
      name: { type: "string", pattern: "^[a-z][a-z0-9_]*$", description: "技能唯一标识符，仅小写字母/数字/下划线" },
      displayName: { type: "string", description: "技能中文显示名称" },
      description: { type: "string", description: "技能功能描述，供 AI 理解何时调用" },
      icon: { type: "string", description: "Lucide 图标名，如 Languages, Wrench, Globe", default: "Wrench" },
      category: { type: "string", enum: ["office", "dev", "life", "creative"], default: "life" },
      version: { type: "string", default: "1.0.0" },
      author: { type: "string", default: "user" },
      tags: { type: "array", items: { type: "string" }, default: [] },
      parameters: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "type", "description"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["string", "number", "boolean"] },
            description: { type: "string" },
            required: { type: "boolean", default: true },
            default: { description: "参数默认值" },
          },
        },
      },
      execution: {
        oneOf: [
          {
            type: "object",
            required: ["type", "prompt"],
            properties: {
              type: { const: "prompt" },
              prompt: { type: "string", description: "Prompt 模板，支持 {{参数名}} 变量替换" },
              model: { type: "string", description: "指定模型，默认用系统模型" },
            },
          },
          {
            type: "object",
            required: ["type", "steps"],
            properties: {
              type: { const: "compose" },
              steps: {
                type: "array",
                items: {
                  type: "object",
                  required: ["skill", "params"],
                  properties: {
                    skill: { type: "string", description: "要调用的已有技能名" },
                    params: { type: "object", description: "参数映射，值支持 {{变量名}} 模板" },
                    outputAs: { type: "string", description: "将结果命名为变量供后续步骤使用" },
                  },
                },
              },
            },
          },
          {
            type: "object",
            required: ["type", "code"],
            properties: {
              type: { const: "code" },
              code: { type: "string", description: "Node.js 代码。函数签名: async function execute(params) { ... return { success, message, data? } }。可使用 require/import、fetch、child_process 等。params 是用户传入的参数对象。" },
              runtime: { type: "string", enum: ["node"], default: "node" },
              dependencies: { type: "array", items: { type: "string" }, default: [], description: "npm 包依赖列表，安装时自动 npm install" },
              timeout: { type: "number", default: 30000, description: "执行超时(ms)" },
            },
          },
        ],
      },
    },
  };
}
