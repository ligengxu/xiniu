import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import os from "os";

const CRED_DIR = path.join(os.homedir(), ".xiniu", "credentials");
const CRED_FILE = path.join(CRED_DIR, "vault.enc");
const MACHINE_KEY = crypto.createHash("sha256").update(os.hostname() + os.userInfo().username + "xiniu-vault-2026").digest();

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", MACHINE_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decrypt(data: string): string {
  const [ivHex, encrypted] = data.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", MACHINE_KEY, iv);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export type CredentialType = "ssh" | "email" | "ftp" | "database" | "api" | "other";

export interface Credential {
  id: string;
  type: CredentialType;
  label: string;
  host: string;
  port?: number;
  username: string;
  password: string;
  extra?: Record<string, string>;
  createdAt: string;
  lastUsedAt: string;
}

interface Vault {
  version: number;
  credentials: Credential[];
}

async function loadVault(): Promise<Vault> {
  await fs.mkdir(CRED_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(CRED_FILE, "utf-8");
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted);
  } catch {
    return { version: 1, credentials: [] };
  }
}

async function saveVault(vault: Vault): Promise<void> {
  await fs.mkdir(CRED_DIR, { recursive: true });
  const encrypted = encrypt(JSON.stringify(vault));
  await fs.writeFile(CRED_FILE, encrypted, "utf-8");
}

export async function saveCredential(cred: Omit<Credential, "id" | "createdAt" | "lastUsedAt">): Promise<Credential> {
  const vault = await loadVault();

  const existing = vault.credentials.find(
    (c) => c.type === cred.type && c.host === cred.host && c.username === cred.username
  );

  if (existing) {
    Object.assign(existing, cred);
    existing.lastUsedAt = new Date().toISOString();
    await saveVault(vault);
    return existing;
  }

  const newCred: Credential = {
    ...cred,
    id: `cred_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
  };
  vault.credentials.push(newCred);
  await saveVault(vault);
  return newCred;
}

export async function getCredential(type: CredentialType, host?: string, username?: string): Promise<Credential | null> {
  const vault = await loadVault();
  const matches = vault.credentials.filter((c) => {
    if (c.type !== type) return false;
    if (host && c.host !== host) return false;
    if (username && c.username !== username) return false;
    return true;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
  return matches[0];
}

export async function listCredentials(type?: CredentialType): Promise<Array<Omit<Credential, "password">>> {
  const vault = await loadVault();
  return vault.credentials
    .filter((c) => !type || c.type === type)
    .map(({ password: _p, ...rest }) => rest);
}

export async function deleteCredential(id: string): Promise<boolean> {
  const vault = await loadVault();
  const len = vault.credentials.length;
  vault.credentials = vault.credentials.filter((c) => c.id !== id);
  if (vault.credentials.length < len) {
    await saveVault(vault);
    return true;
  }
  return false;
}

export async function touchCredential(id: string): Promise<void> {
  const vault = await loadVault();
  const cred = vault.credentials.find((c) => c.id === id);
  if (cred) {
    cred.lastUsedAt = new Date().toISOString();
    await saveVault(vault);
  }
}

export function maskPassword(pwd: string): string {
  if (pwd.length <= 4) return "****";
  return pwd.slice(0, 2) + "*".repeat(pwd.length - 4) + pwd.slice(-2);
}
