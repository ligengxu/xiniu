import fs from "fs/promises";
import path from "path";
import os from "os";
import { SkillConfigSchema, type SkillConfig } from "@/skills/schema";

const SKILLS_DIR = path.join(os.homedir(), ".xiniu", "skills");
const USER_SKILLS_DIR = path.join(SKILLS_DIR, "user");
const STORE_INDEX_FILE = path.join(SKILLS_DIR, "store-index.json");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function loadUserSkills(): Promise<SkillConfig[]> {
  await ensureDir(USER_SKILLS_DIR);
  const skills: SkillConfig[] = [];

  try {
    const files = await fs.readdir(USER_SKILLS_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(USER_SKILLS_DIR, file);
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw);
        const result = SkillConfigSchema.safeParse(data);
        if (result.success) {
          skills.push(result.data);
        } else {
          console.warn(`[skill-store] 跳过无效技能文件 ${file}:`, result.error.issues);
        }
      } catch (err) {
        console.warn(`[skill-store] 读取技能文件 ${file} 失败:`, err);
      }
    }
  } catch {
    // directory might not exist yet
  }

  return skills;
}

export async function saveUserSkill(config: SkillConfig): Promise<void> {
  await ensureDir(USER_SKILLS_DIR);
  const now = new Date().toISOString();
  const toSave: SkillConfig = {
    ...config,
    updatedAt: now,
    createdAt: config.createdAt || now,
  };
  const filePath = path.join(USER_SKILLS_DIR, `${config.name}.json`);
  await fs.writeFile(filePath, JSON.stringify(toSave, null, 2), "utf-8");
}

export async function deleteUserSkill(name: string): Promise<boolean> {
  const filePath = path.join(USER_SKILLS_DIR, `${name}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function getUserSkill(name: string): Promise<SkillConfig | null> {
  const filePath = path.join(USER_SKILLS_DIR, `${name}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    const result = SkillConfigSchema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function userSkillExists(name: string): Promise<boolean> {
  const filePath = path.join(USER_SKILLS_DIR, `${name}.json`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function exportSkillToJson(config: SkillConfig): Promise<string> {
  return JSON.stringify(config, null, 2);
}

export async function loadStoreIndex(): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(STORE_INDEX_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveStoreIndex(index: unknown[]): Promise<void> {
  await ensureDir(SKILLS_DIR);
  await fs.writeFile(STORE_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

export { USER_SKILLS_DIR, SKILLS_DIR, STORE_INDEX_FILE };
