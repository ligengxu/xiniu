import path from "path";
import os from "os";
import fs from "fs/promises";

export type ExecutionMode = "local" | "sandbox";

const SANDBOX_ROOT = path.join(os.homedir(), ".xiniu", "sandbox");

export async function ensureSandbox() {
  await fs.mkdir(SANDBOX_ROOT, { recursive: true });
}

export function getSandboxRoot(): string {
  return SANDBOX_ROOT;
}

export function isPathInSandbox(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(path.resolve(SANDBOX_ROOT));
}

export function getSandboxEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: SANDBOX_ROOT,
    USERPROFILE: SANDBOX_ROOT,
    TEMP: path.join(SANDBOX_ROOT, "tmp"),
    TMP: path.join(SANDBOX_ROOT, "tmp"),
    PYTHONIOENCODING: "utf-8",
    NODE_ENV: "production",
  };
}

export function resolveSandboxPath(filePath: string): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(SANDBOX_ROOT, filePath);
}
