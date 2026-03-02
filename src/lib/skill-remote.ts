import { SkillConfigSchema, type SkillConfig } from "@/skills/schema";

const REMOTE_INDEX_URL = process.env.SKILL_STORE_URL || "";

export async function fetchRemoteSkillIndex(): Promise<unknown[]> {
  if (!REMOTE_INDEX_URL) return [];

  try {
    const res = await fetch(REMOTE_INDEX_URL, {
      signal: AbortSignal.timeout(10000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function downloadRemoteSkill(url: string): Promise<SkillConfig | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const result = SkillConfigSchema.safeParse(data);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
