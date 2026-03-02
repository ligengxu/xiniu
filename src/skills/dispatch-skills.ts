import { z } from "zod";
import type { SkillDefinition, SkillResult } from "./types";
import { PROMPT_MODULES, getMatchedSkillNames } from "./prompt-modules";

const MODULE_NAMES = Object.keys(PROMPT_MODULES);

const MODULE_INDEX = MODULE_NAMES.map((name) => {
  const mod = PROMPT_MODULES[name];
  const briefSkills = mod.skills.length > 0 ? mod.skills.slice(0, 4).join(", ") : "(仅提示词扩展)";
  return `  - **${name}**: ${mod.content.split("\n")[0].replace(/^#+\s*/, "")} [${briefSkills}]`;
}).join("\n");

export const dispatchSkillsDef: SkillDefinition = {
  name: "dispatch_skills",
  displayName: "技能调度器",
  description: `加载额外工具模块。当前可用工具不足以完成任务时调用此技能，传入需要的模块名列表。可选模块:\n${MODULE_INDEX}`,
  icon: "🎛️",
  category: "dev",
  parameters: z.object({
    needs: z.array(z.string()).describe(
      `需要加载的模块名列表。可选值: ${MODULE_NAMES.join(", ")}`
    ),
    reason: z.string().describe("简述为什么需要这些模块（一句话）"),
  }),

  execute: async (params): Promise<SkillResult> => {
    const needs = params.needs as string[];
    const reason = params.reason as string;

    const validModules: string[] = [];
    const invalidModules: string[] = [];
    for (const name of needs) {
      if (PROMPT_MODULES[name]) {
        validModules.push(name);
      } else {
        invalidModules.push(name);
      }
    }

    if (validModules.length === 0) {
      return {
        success: false,
        message: `未找到有效模块。可选模块: ${MODULE_NAMES.join(", ")}`,
      };
    }

    const skillNames = getMatchedSkillNames(validModules);
    const modulePrompts: string[] = [];
    for (const name of validModules) {
      modulePrompts.push(PROMPT_MODULES[name].content);
    }

    return {
      success: true,
      message: [
        `已加载 ${validModules.length} 个模块: ${validModules.join(", ")}`,
        `新增 ${skillNames.size} 个可用工具`,
        reason ? `调度原因: ${reason}` : "",
        invalidModules.length > 0 ? `无效模块已忽略: ${invalidModules.join(", ")}` : "",
        "",
        "--- 以下是加载模块的使用指南 ---",
        "",
        modulePrompts.join("\n\n"),
      ].filter(Boolean).join("\n"),
      data: {
        _dispatch: true,
        activatedModules: validModules,
        activatedSkills: Array.from(skillNames),
      },
    };
  },
};
