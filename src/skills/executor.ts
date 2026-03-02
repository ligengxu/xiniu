import { generateText } from "ai";
import { getModel } from "@/lib/models";
import type { SkillConfig, SkillParameter } from "./schema";
import type { SkillResult } from "./types";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";

const execAsync = promisify(exec);

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

function buildZodSchemaFromParams(params: SkillParameter[]) {
  const { z } = require("zod");
  const shape: Record<string, unknown> = {};
  for (const p of params) {
    let field;
    switch (p.type) {
      case "number":
        field = z.number();
        break;
      case "boolean":
        field = z.boolean();
        break;
      default:
        field = z.string();
    }
    field = field.describe(p.description);
    if (!p.required) {
      field = field.optional();
      if (p.default !== undefined) field = field.default(p.default);
    }
    shape[p.name] = field;
  }
  return z.object(shape);
}

async function executePromptSkill(
  config: SkillConfig,
  params: Record<string, unknown>,
  providerId: string,
  modelId: string,
): Promise<SkillResult> {
  if (config.execution.type !== "prompt") {
    return { success: false, message: "执行类型不匹配" };
  }

  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    vars[k] = String(v ?? "");
  }

  const prompt = renderTemplate(config.execution.prompt, vars);
  const mid = config.execution.model || modelId;

  try {
    const result = await generateText({
      model: getModel(providerId, mid),
      prompt,
      maxOutputTokens: 4096,
    });

    return {
      success: true,
      message: result.text,
      data: { tokenUsage: result.usage },
    };
  } catch (err) {
    return {
      success: false,
      message: `Prompt 技能执行失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function executeComposeSkill(
  config: SkillConfig,
  params: Record<string, unknown>,
  executeBuiltinSkill: (name: string, params: Record<string, unknown>) => Promise<SkillResult>,
): Promise<SkillResult> {
  if (config.execution.type !== "compose") {
    return { success: false, message: "执行类型不匹配" };
  }

  const context: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    context[k] = String(v ?? "");
  }

  const stepResults: { skill: string; success: boolean; message: string }[] = [];

  for (const step of config.execution.steps) {
    const resolvedParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step.params)) {
      resolvedParams[k] = renderTemplate(v, context);
    }

    try {
      const result = await executeBuiltinSkill(step.skill, resolvedParams);
      stepResults.push({ skill: step.skill, success: result.success, message: result.message });

      if (step.outputAs) {
        context[step.outputAs] = result.message;
      }

      if (!result.success) {
        return {
          success: false,
          message: `组合技能在步骤 "${step.skill}" 失败: ${result.message}`,
          data: { stepResults },
        };
      }
    } catch (err) {
      const msg = `步骤 "${step.skill}" 异常: ${err instanceof Error ? err.message : String(err)}`;
      stepResults.push({ skill: step.skill, success: false, message: msg });
      return { success: false, message: msg, data: { stepResults } };
    }
  }

  const lastResult = stepResults[stepResults.length - 1];
  return {
    success: true,
    message: lastResult?.message || "组合技能执行完成",
    data: { stepResults },
  };
}

export interface ExecutorContext {
  providerId: string;
  modelId: string;
  executeBuiltinSkill: (name: string, params: Record<string, unknown>) => Promise<SkillResult>;
}

async function executeCodeSkill(
  config: SkillConfig,
  params: Record<string, unknown>,
): Promise<SkillResult> {
  if (config.execution.type !== "code") {
    return { success: false, message: "执行类型不匹配" };
  }

  const { code, dependencies = [], timeout = 30000 } = config.execution;
  const skillDir = path.join(os.homedir(), ".xiniu", "skills", "runtime", config.name);
  await fs.mkdir(skillDir, { recursive: true });

  if (dependencies.length > 0) {
    const pkgPath = path.join(skillDir, "package.json");
    try {
      await fs.access(pkgPath);
    } catch {
      await fs.writeFile(pkgPath, JSON.stringify({ name: config.name, private: true, dependencies: {} }), "utf-8");
      try {
        await execAsync(`npm install ${dependencies.join(" ")} --save`, { cwd: skillDir, timeout: 60000 });
      } catch (installErr) {
        return { success: false, message: `依赖安装失败: ${installErr instanceof Error ? installErr.message : String(installErr)}` };
      }
    }
  }

  const wrappedCode = `
const __params = ${JSON.stringify(params)};
const __require = require;
const path = __require('path');
const fs = __require('fs');
const os = __require('os');
const { exec: __exec } = __require('child_process');
const { promisify: __promisify } = __require('util');
const __execAsync = __promisify(__exec);

${dependencies.length > 0 ? `module.paths.unshift("${skillDir.replace(/\\/g, "\\\\")}/node_modules");` : ""}

(async () => {
  try {
    ${code}
    if (typeof execute === 'function') {
      const result = await execute(__params);
      process.stdout.write("__SKILL_RESULT__" + JSON.stringify(result));
    } else {
      process.stdout.write("__SKILL_RESULT__" + JSON.stringify({ success: false, message: "代码中未定义 execute 函数" }));
    }
  } catch(e) {
    process.stdout.write("__SKILL_RESULT__" + JSON.stringify({ success: false, message: "运行时错误: " + (e.message || String(e)) }));
  }
})();
`;

  const tmpFile = path.join(skillDir, `_run_${Date.now()}.cjs`);
  try {
    await fs.writeFile(tmpFile, wrappedCode, "utf-8");
    const { stdout, stderr } = await execAsync(`node "${tmpFile}"`, { timeout, cwd: skillDir });

    const resultMatch = stdout.match(/__SKILL_RESULT__([\s\S]*)/);
    if (resultMatch) {
      try {
        const result = JSON.parse(resultMatch[1]);
        return { success: !!result.success, message: result.message || "执行完成", data: result.data };
      } catch {
        return { success: true, message: resultMatch[1] };
      }
    }

    if (stderr && !stdout) {
      return { success: false, message: `stderr: ${stderr.substring(0, 1000)}` };
    }

    return { success: true, message: stdout.substring(0, 2000) || "执行完成（无输出）" };
  } catch (err) {
    return { success: false, message: `代码执行失败: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    fs.unlink(tmpFile).catch(() => {});
  }
}

export async function executeSkillConfig(
  config: SkillConfig,
  params: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<SkillResult> {
  if (!config.enabled) {
    return { success: false, message: `技能 "${config.displayName}" 已被禁用` };
  }

  switch (config.execution.type) {
    case "prompt":
      return executePromptSkill(config, params, ctx.providerId, ctx.modelId);
    case "compose":
      return executeComposeSkill(config, params, ctx.executeBuiltinSkill);
    case "code":
      return executeCodeSkill(config, params);
    default:
      return { success: false, message: `未知的执行类型` };
  }
}

export { buildZodSchemaFromParams };
