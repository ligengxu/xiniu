import { tool, type Tool } from "ai";
import { z } from "zod";
import type { SkillDefinition, SkillResult } from "./types";
import type { SkillConfig } from "./schema";
import { logAudit } from "@/lib/audit-logger";
import { loadUserSkills } from "@/lib/skill-store";
import { executeSkillConfig, buildZodSchemaFromParams } from "./executor";
import { detectModules, assemblePrompt, getMatchedSkillNames, CORE_SKILLS, buildCorePrompt } from "./prompt-modules";
import { dispatchSkillsDef } from "./dispatch-skills";
import { contextDigestDef } from "./context-digest";

import { createFolderSkill } from "./create-folder";
import { createTxtSkill } from "./create-txt";
import { openWebpageSkill } from "./open-webpage";
import { browseWebpageSkill } from "./browse-webpage";
import { downloadImagesSkill } from "./download-images";
import { downloadFileSkill } from "./download-file";
import { generateWordSkill } from "./generate-word";
import { generateExcelSkill } from "./generate-excel";
import { generatePptSkill } from "./generate-ppt";
import { generatePdfSkill } from "./generate-pdf";
import { webSearchSkill, searchPlanSkill, scrapeSiteSkill } from "./web-search";
import { runCodeSkill } from "./run-code";
import { analyzeFileSkill } from "./analyze-file";
import { batchFilesSkill } from "./batch-files";
import { readPdfSkill } from "./read-pdf";
import { scheduleTaskSkill, listSchedulesSkill, cancelScheduleSkill } from "./scheduler";
import {
  systemInfoSkill, clipboardSkill, processManagerSkill, networkDiagSkill,
  fileSearchSkill, zipSkill, httpRequestSkill, dataProcessorSkill,
  envManagerSkill, textDiffSkill,
} from "./system-tools";
import {
  hashCalcSkill, base64Skill, jsonValidatorSkill, portScanSkill,
  notifySkill, textStatsSkill, randomGenSkill, qrcodeSkill,
  unitConvertSkill, markdownToHtmlSkill,
} from "./utility-tools";
import {
  browserOpenSkill, browserClickSkill, browserTypeSkill,
  browserScreenshotSkill, browserReadDomSkill, browserScriptSkill,
  browserScrollSkill, browserWaitSkill, browserCloseSkill,
  browserPressKeySkill,
} from "./browser-control";
import { readFileSkill } from "./read-file";
import { sandboxRunSkill } from "./sandbox-run";
import { mergeFilesSkill } from "./merge-files";

const coreSkills: SkillDefinition[] = [
  createFolderSkill, createTxtSkill, openWebpageSkill, browseWebpageSkill,
  downloadImagesSkill, downloadFileSkill,
  generateWordSkill, generateExcelSkill, generatePptSkill, generatePdfSkill,
  searchPlanSkill, scrapeSiteSkill, webSearchSkill, runCodeSkill,
  analyzeFileSkill, batchFilesSkill, readPdfSkill,
  browserOpenSkill, browserClickSkill, browserTypeSkill,
  browserScreenshotSkill, browserReadDomSkill, browserScriptSkill,
  browserScrollSkill, browserWaitSkill, browserCloseSkill, browserPressKeySkill,
  scheduleTaskSkill, listSchedulesSkill, cancelScheduleSkill,
  systemInfoSkill, clipboardSkill, processManagerSkill, networkDiagSkill,
  fileSearchSkill, zipSkill, httpRequestSkill, dataProcessorSkill,
  envManagerSkill, textDiffSkill,
  hashCalcSkill, base64Skill, jsonValidatorSkill, portScanSkill,
  notifySkill, textStatsSkill, randomGenSkill, qrcodeSkill,
  unitConvertSkill, markdownToHtmlSkill,
  readFileSkill, sandboxRunSkill, mergeFilesSkill,
  dispatchSkillsDef, contextDigestDef,
];

let _communitySkills: SkillDefinition[] | null = null;

async function loadCommunitySkills(): Promise<SkillDefinition[]> {
  if (_communitySkills !== null) return _communitySkills;

  const loaded: SkillDefinition[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    const communityDir = path.join(process.cwd(), "src", "skills", "community");

    if (!fs.existsSync(communityDir)) {
      _communitySkills = [];
      return [];
    }

    const entries = fs.readdirSync(communityDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const indexPath = path.join(communityDir, entry.name, "index.ts");
      if (!fs.existsSync(indexPath)) continue;

      try {
        const mod = await import(`./community/${entry.name}`);
        const skillDef = Object.values(mod).find(
          (v): v is SkillDefinition =>
            typeof v === "object" && v !== null && "name" in v && "execute" in v && typeof (v as Record<string, unknown>).execute === "function",
        );
        if (skillDef) loaded.push(skillDef);
      } catch {
        // skip skills that fail to load
      }
    }
  } catch {
    // community dir not available
  }

  _communitySkills = loaded;
  return loaded;
}

export function invalidateCommunityCache() {
  _communitySkills = null;
}

export const builtinSkills: SkillDefinition[] = coreSkills;

const builtinSkillNames = new Set(builtinSkills.map((s) => s.name));

function skillConfigToDefinition(
  config: SkillConfig,
  providerId: string,
  modelId: string,
): SkillDefinition {
  const zodSchema = buildZodSchemaFromParams(config.parameters);

  function executeBuiltin(name: string, params: Record<string, unknown>): Promise<SkillResult> {
    const skill = builtinSkills.find((s) => s.name === name);
    if (!skill) return Promise.resolve({ success: false, message: `未找到内置技能: ${name}` });
    return skill.execute(params);
  }

  return {
    name: config.name,
    displayName: config.displayName,
    description: config.description,
    icon: config.icon,
    category: config.category,
    parameters: zodSchema,
    execute: async (params) => {
      return executeSkillConfig(config, params, {
        providerId,
        modelId,
        executeBuiltinSkill: executeBuiltin,
      });
    },
  };
}

export function getAllSkills(): SkillDefinition[] {
  return builtinSkills;
}

export async function getAllSkillsWithUser(
  providerId = "claudelocal",
  modelId = "claude-sonnet-4-6",
): Promise<SkillDefinition[]> {
  const community = await loadCommunitySkills();
  const userConfigs = await loadUserSkills();
  const allNames = new Set([...builtinSkillNames, ...community.map((s) => s.name)]);
  const userSkills = userConfigs
    .filter((c) => c.enabled && !allNames.has(c.name))
    .map((c) => skillConfigToDefinition(c, providerId, modelId));
  return [...builtinSkills, ...community, ...userSkills];
}

const MAX_RESULT_CHARS = 12_000;

function truncateResult(result: SkillResult): SkillResult {
  if (result.message && result.message.length > MAX_RESULT_CHARS) {
    const half = Math.floor(MAX_RESULT_CHARS / 2);
    result = {
      ...result,
      message: result.message.slice(0, half) +
        `\n...[已截断 ${result.message.length - MAX_RESULT_CHARS} 字符]...\n` +
        result.message.slice(-half),
    };
  }
  if (result.data) {
    const dataStr = JSON.stringify(result.data);
    if (dataStr.length > MAX_RESULT_CHARS) {
      result = { ...result, data: { _truncated: true, summary: `数据过大(${dataStr.length}字符)，已省略` } };
    }
  }
  return result;
}

function wrapSkillAsTool(skill: SkillDefinition) {
  return tool({
    description: skill.description,
    inputSchema: skill.parameters,
    execute: async (params, options) => {
      const startTime = Date.now();
      try {
        const ctx = options?.experimental_context;
        let result = await skill.execute(params as Record<string, unknown>, ctx);
        result = truncateResult(result);
        logAudit({
          skillName: skill.name,
          action: skill.displayName,
          params: params as Record<string, unknown>,
          result: { success: result.success, message: result.message.slice(0, 500) },
          riskLevel: "safe",
          duration: Date.now() - startTime,
        }).catch(() => {});
        return result;
      } catch (err) {
        const message = `技能执行失败: ${err instanceof Error ? err.message : String(err)}`;
        logAudit({
          skillName: skill.name,
          action: skill.displayName,
          params: params as Record<string, unknown>,
          result: { success: false, message },
          riskLevel: "safe",
          duration: Date.now() - startTime,
        }).catch(() => {});
        return { success: false, message };
      }
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSkillsAsTools(): Record<string, Tool<any, any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, Tool<any, any>> = {};
  for (const skill of builtinSkills) {
    tools[skill.name] = wrapSkillAsTool(skill);
  }
  return tools;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSkillsAsToolsWithUser(providerId = "claudelocal", modelId = "claude-sonnet-4-6"): Promise<Record<string, Tool<any, any>>> {
  const allSkills = await getAllSkillsWithUser(providerId, modelId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, Tool<any, any>> = {};
  for (const skill of allSkills) {
    tools[skill.name] = wrapSkillAsTool(skill);
  }
  return tools;
}

export function getSkillsMeta() {
  return builtinSkills.map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    icon: s.icon,
    category: s.category || "life",
    source: "builtin" as const,
  }));
}

export async function getAllSkillsMeta() {
  const community = await loadCommunitySkills();
  const userConfigs = await loadUserSkills();
  const builtinMeta = builtinSkills.map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    icon: s.icon,
    category: (s.category || "life") as string,
    source: "builtin" as const,
    enabled: true,
    setupGuide: s.setupGuide || null,
  }));

  const communityMeta = community.map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    icon: s.icon,
    category: (s.category || "life") as string,
    source: "community" as const,
    enabled: true,
    setupGuide: s.setupGuide || null,
  }));

  const userMeta = userConfigs.map((c) => ({
    name: c.name,
    displayName: c.displayName,
    description: c.description,
    icon: c.icon,
    category: c.category,
    source: "user" as const,
    enabled: c.enabled,
    author: c.author,
    version: c.version,
    setupGuide: null,
  }));

  return [...builtinMeta, ...communityMeta, ...userMeta];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getAllToolsMap(
  providerId = "claudelocal",
  modelId = "claude-sonnet-4-6",
): Promise<{ allTools: Record<string, Tool<any, any>>; allSkills: SkillDefinition[] }> {
  const allSkills = await getAllSkillsWithUser(providerId, modelId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allTools: Record<string, Tool<any, any>> = {};
  for (const skill of allSkills) {
    allTools[skill.name] = wrapSkillAsTool(skill);
  }
  return { allTools, allSkills };
}

export function computeActiveToolNames(
  allSkillNames: string[],
  activatedModules: Set<string>,
  preloadedModules: string[],
  userSkillNames: string[] = [],
): string[] {
  const coreSet = new Set<string>(CORE_SKILLS);
  const matchedFromPreload = getMatchedSkillNames(preloadedModules);
  const matchedFromDispatch = getMatchedSkillNames(Array.from(activatedModules));

  const activeSet = new Set<string>();
  for (const name of coreSet) activeSet.add(name);
  for (const name of matchedFromPreload) activeSet.add(name);
  for (const name of matchedFromDispatch) activeSet.add(name);
  for (const name of userSkillNames) activeSet.add(name);

  return allSkillNames.filter((n) => activeSet.has(n));
}

export function buildInitialSystemPrompt(
  activeSkillNames: string[],
  allSkills: SkillDefinition[],
  moduleNames: string[],
): string {
  const activeSkills = allSkills.filter((s) => activeSkillNames.includes(s.name));
  const skillListStr = activeSkills
    .map((s) => `- ${s.name}: ${s.displayName}`)
    .join("\n");

  return assemblePrompt(activeSkills.length, skillListStr, moduleNames);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getFilteredToolsAndPrompt(
  providerId = "claudelocal",
  modelId = "claude-sonnet-4-6",
  userMessages: string[] = [],
): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  allTools: Record<string, Tool<any, any>>;
  activeToolNames: string[];
  systemPrompt: string;
  preloadedModules: string[];
  allSkills: SkillDefinition[];
  userSkillNames: string[];
}> {
  const { allTools, allSkills } = await getAllToolsMap(providerId, modelId);
  const allSkillNames = allSkills.map((s) => s.name);

  const preloadedModules = detectModules(userMessages);
  const activatedModules = new Set<string>();
  const allBuiltinNames = new Set([...builtinSkillNames]);
  const userSkillNames = allSkills
    .filter((s) => !allBuiltinNames.has(s.name))
    .map((s) => s.name);
  const activeToolNames = computeActiveToolNames(allSkillNames, activatedModules, preloadedModules, userSkillNames);

  const systemPrompt = buildInitialSystemPrompt(activeToolNames, allSkills, preloadedModules);

  console.log(
    `[prompt] preload=[${preloadedModules.join(",")}] active=${activeToolNames.length}/${allSkillNames.length} len=${systemPrompt.length} chars`
  );

  return { allTools, activeToolNames, systemPrompt, preloadedModules, allSkills, userSkillNames };
}
