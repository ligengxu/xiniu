import fs from "fs/promises";
import path from "path";
import os from "os";

export interface AuditEntry {
  id: string;
  timestamp: string;
  skillName: string;
  action: string;
  params: Record<string, unknown>;
  result: {
    success: boolean;
    message: string;
  };
  riskLevel: "safe" | "moderate" | "dangerous";
  duration: number;
}

const AUDIT_DIR = path.join(os.homedir(), ".xiniu", "audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "audit.json");

async function ensureDir() {
  await fs.mkdir(AUDIT_DIR, { recursive: true });
}

export async function logAudit(entry: Omit<AuditEntry, "id" | "timestamp">) {
  await ensureDir();

  const fullEntry: AuditEntry = {
    ...entry,
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };

  let entries: AuditEntry[] = [];
  try {
    const data = await fs.readFile(AUDIT_FILE, "utf-8");
    entries = JSON.parse(data);
  } catch { /* file doesn't exist yet */ }

  entries.push(fullEntry);

  if (entries.length > 100000) {
    const archiveFile = path.join(AUDIT_DIR, `audit_${new Date().toISOString().slice(0, 7)}.json`);
    const archiveEntries = entries.splice(0, entries.length - 50000);
    await fs.writeFile(archiveFile, JSON.stringify(archiveEntries), "utf-8");
  }

  await fs.writeFile(AUDIT_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

export async function loadAuditLog(options?: {
  limit?: number;
  offset?: number;
  riskLevel?: string;
  skillName?: string;
}): Promise<{ entries: AuditEntry[]; total: number }> {
  await ensureDir();
  let entries: AuditEntry[] = [];
  try {
    const data = await fs.readFile(AUDIT_FILE, "utf-8");
    entries = JSON.parse(data);
  } catch {
    return { entries: [], total: 0 };
  }

  if (options?.riskLevel) {
    entries = entries.filter((e) => e.riskLevel === options.riskLevel);
  }
  if (options?.skillName) {
    entries = entries.filter((e) => e.skillName === options.skillName);
  }

  const total = entries.length;
  entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const offset = options?.offset || 0;
  const limit = options?.limit || 50;
  entries = entries.slice(offset, offset + limit);

  return { entries, total };
}
