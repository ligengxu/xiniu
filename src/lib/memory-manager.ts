import fs from "fs/promises";
import path from "path";
import os from "os";

export interface MemoryFact {
  id: string;
  content: string;
  category: "preference" | "skill" | "habit" | "contact" | "project" | "credential";
  confidence: number;
  createdAt: string;
  lastUsed: string;
}

export interface DailyMemory {
  date: string;
  conversations: {
    id: string;
    summary: string;
    keyFacts: string[];
  }[];
}

const MEMORY_DIR = path.join(os.homedir(), ".xiniu", "memory");
const LONG_TERM_FILE = path.join(MEMORY_DIR, "long-term.json");

async function ensureDir() {
  await fs.mkdir(path.join(MEMORY_DIR, "daily"), { recursive: true });
}

export async function loadLongTermMemory(): Promise<MemoryFact[]> {
  await ensureDir();
  try {
    const data = await fs.readFile(LONG_TERM_FILE, "utf-8");
    const parsed = JSON.parse(data);
    return parsed.facts || [];
  } catch {
    return [];
  }
}

export async function saveLongTermMemory(facts: MemoryFact[]) {
  await ensureDir();
  await fs.writeFile(LONG_TERM_FILE, JSON.stringify({ facts }, null, 2), "utf-8");
}

export async function addMemoryFact(fact: Omit<MemoryFact, "id" | "createdAt" | "lastUsed">): Promise<MemoryFact> {
  const facts = await loadLongTermMemory();
  const existing = facts.find((f) => f.content === fact.content);
  if (existing) {
    existing.confidence = Math.max(existing.confidence, fact.confidence);
    existing.lastUsed = new Date().toISOString();
    await saveLongTermMemory(facts);
    return existing;
  }

  const newFact: MemoryFact = {
    ...fact,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };
  facts.push(newFact);
  await saveLongTermMemory(facts);
  return newFact;
}

export async function removeMemoryFact(factId: string) {
  const facts = await loadLongTermMemory();
  const filtered = facts.filter((f) => f.id !== factId);
  await saveLongTermMemory(filtered);
}

export async function updateMemoryFact(factId: string, updates: Partial<MemoryFact>) {
  const facts = await loadLongTermMemory();
  const fact = facts.find((f) => f.id === factId);
  if (fact) {
    Object.assign(fact, updates);
    await saveLongTermMemory(facts);
  }
}

export async function saveDailyMemory(memory: DailyMemory) {
  await ensureDir();
  const filePath = path.join(MEMORY_DIR, "daily", `${memory.date}.json`);
  await fs.writeFile(filePath, JSON.stringify(memory, null, 2), "utf-8");
}

export async function loadDailyMemory(date: string): Promise<DailyMemory | null> {
  try {
    const filePath = path.join(MEMORY_DIR, "daily", `${date}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function getMemoryStats() {
  const facts = await loadLongTermMemory();
  const categories = facts.reduce((acc, f) => {
    acc[f.category] = (acc[f.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalFacts: facts.length,
    categories,
    avgConfidence: facts.length > 0
      ? facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length
      : 0,
  };
}
