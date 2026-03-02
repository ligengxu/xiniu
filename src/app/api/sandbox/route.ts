import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";

const SANDBOX_DIR = path.join(os.tmpdir(), "xiniu-sandbox");
const TIMEOUT_MS = 30000;
const MAX_OUTPUT = 100_000;

export async function POST(req: Request) {
  const body = await req.json();
  const { code, language } = body;

  if (!code || !language) {
    return NextResponse.json({ error: "缺少 code 或 language 参数" }, { status: 400 });
  }

  await fs.mkdir(SANDBOX_DIR, { recursive: true });

  const extMap: Record<string, string> = {
    python: ".py",
    javascript: ".js",
    typescript: ".ts",
    shell: ".sh",
    bash: ".sh",
    powershell: ".ps1",
  };

  const cmdMap: Record<string, { cmd: string; args: (f: string) => string[] }> = {
    python: { cmd: "python", args: (f) => [f] },
    javascript: { cmd: "node", args: (f) => [f] },
    js: { cmd: "node", args: (f) => [f] },
    typescript: { cmd: "npx", args: (f) => ["tsx", f] },
    ts: { cmd: "npx", args: (f) => ["tsx", f] },
    shell: { cmd: "bash", args: (f) => [f] },
    bash: { cmd: "bash", args: (f) => [f] },
    sh: { cmd: "bash", args: (f) => [f] },
    powershell: { cmd: "powershell", args: (f) => ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f] },
  };

  const lang = language.toLowerCase();
  const ext = extMap[lang] || ".txt";
  const runner = cmdMap[lang];

  if (!runner) {
    return NextResponse.json({
      success: false,
      output: `不支持的语言: ${language}`,
      message: `不支持的语言: ${language}`,
    });
  }

  const filename = `sandbox_${Date.now()}${ext}`;
  const filepath = path.join(SANDBOX_DIR, filename);

  await fs.writeFile(filepath, code, "utf-8");

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(runner.cmd, runner.args(filepath), {
      cwd: SANDBOX_DIR,
      timeout: TIMEOUT_MS,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT) {
        proc.kill();
        stdout += "\n... 输出过长，已截断";
      }
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", async (exitCode) => {
      try { await fs.unlink(filepath); } catch { /* noop */ }

      const output = stdout + (stderr ? `\n${stderr}` : "");
      resolve(
        NextResponse.json({
          success: exitCode === 0,
          output: output.trim() || "(无输出)",
          exitCode,
          language: lang,
          message: exitCode === 0 ? "执行成功" : `执行失败 (exit code: ${exitCode})`,
        })
      );
    });

    proc.on("error", async (err) => {
      try { await fs.unlink(filepath); } catch { /* noop */ }
      resolve(
        NextResponse.json({
          success: false,
          output: `运行时错误: ${err.message}`,
          message: `无法启动 ${language}: ${err.message}`,
        })
      );
    });
  });
}
