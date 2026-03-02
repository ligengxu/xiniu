import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { SkillDefinition } from "../types";

export const runCodeSkill: SkillDefinition = {
  name: "run_code",
  displayName: "运行代码",
  description:
    "在沙箱中运行 Python、Node.js 或 Shell 代码。用户可能会说'运行代码'、'执行脚本'、'跑一下'等。",
  icon: "Terminal",
  category: "dev",
  parameters: z.object({
    code: z.string().describe("要执行的代码"),
    language: z
      .enum(["python", "javascript", "shell", "powershell"])
      .describe("编程语言: python, javascript, shell, powershell"),
  }),
  execute: async (params) => {
    const { code, language } = params as {
      code: string;
      language: "python" | "javascript" | "shell" | "powershell";
    };

    const tmpDir = path.join(os.tmpdir(), "xiniu-sandbox");
    await fs.mkdir(tmpDir, { recursive: true });

    const extMap: Record<string, string> = {
      python: ".py",
      javascript: ".js",
      shell: ".sh",
      powershell: ".ps1",
    };

    const cmdMap: Record<string, string> = {
      python: "python",
      javascript: "node",
      shell: "bash",
      powershell: "powershell",
    };

    const filename = `run_${Date.now()}${extMap[language]}`;
    const filepath = path.join(tmpDir, filename);

    await fs.writeFile(filepath, code, "utf-8");

    return new Promise((resolve) => {
      const cmd = cmdMap[language];
      const args = language === "powershell"
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath]
        : [filepath];

      const proc = spawn(cmd, args, {
        cwd: tmpDir,
        timeout: 30000,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
        if (stdout.length > 100_000) {
          proc.kill();
          stdout += "\n... 输出过长，已截断";
        }
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", async (exitCode) => {
        try { await fs.unlink(filepath); } catch { /* noop */ }

        const output = stdout + (stderr ? `\n[stderr] ${stderr}` : "");

        if (exitCode === 0) {
          resolve({
            success: true,
            message: `代码执行成功 (${language})`,
            data: { output: output.trim() || "(无输出)", exitCode, language },
          });
        } else {
          resolve({
            success: false,
            message: `代码执行失败 (exit code: ${exitCode})`,
            data: { output: output.trim(), exitCode, language },
          });
        }
      });

      proc.on("error", (err) => {
        resolve({
          success: false,
          message: `无法启动 ${language} 运行时: ${err.message}`,
        });
      });
    });
  },
};
