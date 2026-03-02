import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { SkillDefinition } from "../types";

const SANDBOX_DIR = path.join(os.tmpdir(), "xiniu-sandbox");
const TIMEOUT_MS = 60000;
const MAX_OUTPUT = 200_000;

function runScript(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
  stdinData?: string,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null; durationMs: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      timeout,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", NODE_OPTIONS: "--max-old-space-size=512" },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) {
        proc.kill();
        stdout += "\n... 输出过长，已截断";
      }
    });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    if (stdinData) {
      proc.stdin.write(stdinData);
      proc.stdin.end();
    }

    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, exitCode: code, durationMs: Date.now() - start }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message, exitCode: null, durationMs: Date.now() - start }));
  });
}

export const sandboxTestSkill: SkillDefinition = {
  name: "sandbox_test",
  displayName: "代码沙盒测试",
  description:
    "在沙盒中运行Python/JavaScript/TypeScript代码并进行测试。支持：运行测试用例、性能基准测试、代码lint检查、交互式输入测试。比run_code更强大：支持多文件、stdin输入、测试断言、性能计时、pip/npm依赖安装。",
  icon: "FlaskConical",
  category: "dev",
  parameters: z.object({
    language: z.enum(["python", "javascript", "typescript"]).describe("编程语言"),
    code: z.string().describe("要测试的代码"),
    testCode: z.string().optional().describe("测试代码（如pytest/jest测试用例）。如不提供则直接运行code"),
    action: z.enum(["run", "test", "benchmark", "lint", "install_deps"]).optional()
      .describe("操作: run=直接运行, test=运行测试, benchmark=性能测试, lint=语法检查, install_deps=安装依赖"),
    stdinInput: z.string().optional().describe("标准输入数据（模拟用户输入）"),
    dependencies: z.array(z.string()).optional().describe("需要安装的依赖包（如 ['numpy','requests'] 或 ['lodash','axios']）"),
    timeout: z.number().optional().describe("超时毫秒数，默认60000"),
    files: z.array(z.object({
      name: z.string().describe("文件名"),
      content: z.string().describe("文件内容"),
    })).optional().describe("额外文件（多文件项目时使用）"),
  }),
  execute: async (params) => {
    const {
      language, code, testCode,
      action = "run",
      stdinInput,
      dependencies = [],
      timeout = TIMEOUT_MS,
      files = [],
    } = params as {
      language: "python" | "javascript" | "typescript";
      code: string; testCode?: string; action?: string;
      stdinInput?: string; dependencies?: string[];
      timeout?: number;
      files?: { name: string; content: string }[];
    };

    const runDir = path.join(SANDBOX_DIR, `test_${Date.now()}`);
    await fs.mkdir(runDir, { recursive: true });

    try {
      const extMap = { python: ".py", javascript: ".js", typescript: ".ts" };
      const mainFile = `main${extMap[language]}`;
      await fs.writeFile(path.join(runDir, mainFile), code, "utf-8");

      for (const f of files) {
        const fp = path.join(runDir, f.name);
        await fs.mkdir(path.dirname(fp), { recursive: true });
        await fs.writeFile(fp, f.content, "utf-8");
      }

      if (testCode) {
        const testFile = language === "python" ? "test_main.py" : "test_main.test.js";
        await fs.writeFile(path.join(runDir, testFile), testCode, "utf-8");
      }

      if (dependencies.length > 0) {
        if (language === "python") {
          const depR = await runScript("pip", ["install", "--quiet", ...dependencies], runDir, 120000);
          if (!depR.ok) {
            return { success: false, message: `❌ Python依赖安装失败:\n${depR.stderr}`, data: { step: "install_deps" } };
          }
        } else {
          await fs.writeFile(path.join(runDir, "package.json"), JSON.stringify({ name: "sandbox-test", private: true }), "utf-8");
          const depR = await runScript("npm", ["install", "--save", ...dependencies], runDir, 120000);
          if (!depR.ok) {
            return { success: false, message: `❌ NPM依赖安装失败:\n${depR.stderr}`, data: { step: "install_deps" } };
          }
        }
      }

      if (action === "install_deps") {
        return { success: true, message: `✅ 依赖安装完成: ${dependencies.join(", ")}` };
      }

      if (action === "lint") {
        let lintResult;
        if (language === "python") {
          lintResult = await runScript("python", ["-m", "py_compile", mainFile], runDir, 15000);
          if (lintResult.ok) {
            const ast = await runScript("python", ["-c", `import ast; ast.parse(open('${mainFile}').read()); print('AST解析成功')`], runDir, 15000);
            lintResult.stdout += "\n" + ast.stdout;
          }
        } else {
          lintResult = await runScript("node", ["--check", mainFile], runDir, 15000);
        }

        return {
          success: lintResult.ok,
          message: lintResult.ok
            ? `✅ ${language} 语法检查通过\n${lintResult.stdout.trim()}`
            : `❌ 语法错误:\n${lintResult.stderr}`,
          data: { language, action: "lint" },
        };
      }

      if (action === "benchmark") {
        let benchCode: string;
        if (language === "python") {
          benchCode = `
import time, tracemalloc
tracemalloc.start()
start = time.perf_counter()
exec(open('${mainFile}').read())
elapsed = time.perf_counter() - start
current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()
print(f"耗时: {elapsed*1000:.2f}ms")
print(f"当前内存: {current/1024:.1f}KB")
print(f"峰值内存: {peak/1024:.1f}KB")
`;
        } else {
          benchCode = `
const { performance } = require('perf_hooks');
const start = performance.now();
const mem0 = process.memoryUsage();
require('./${mainFile}');
const elapsed = performance.now() - start;
const mem1 = process.memoryUsage();
console.log('耗时: ' + elapsed.toFixed(2) + 'ms');
console.log('堆内存增长: ' + ((mem1.heapUsed - mem0.heapUsed)/1024).toFixed(1) + 'KB');
console.log('RSS增长: ' + ((mem1.rss - mem0.rss)/1024).toFixed(1) + 'KB');
`;
        }

        const benchFile = language === "python" ? "_bench.py" : "_bench.js";
        await fs.writeFile(path.join(runDir, benchFile), benchCode, "utf-8");
        const cmd = language === "python" ? "python" : "node";
        const r = await runScript(cmd, [benchFile], runDir, timeout);

        return {
          success: r.ok,
          message: r.ok
            ? `📊 性能基准测试结果:\n${r.stdout.trim()}\n\n执行总耗时: ${r.durationMs}ms`
            : `❌ 基准测试失败:\n${r.stderr}`,
          data: { language, action: "benchmark", durationMs: r.durationMs, output: r.stdout.trim() },
        };
      }

      if (action === "test" && testCode) {
        let r;
        if (language === "python") {
          r = await runScript("python", ["-m", "pytest", "test_main.py", "-v", "--tb=short"], runDir, timeout, stdinInput);
          if (!r.ok && r.stderr.includes("No module named pytest")) {
            r = await runScript("python", ["-m", "unittest", "test_main", "-v"], runDir, timeout, stdinInput);
          }
        } else {
          r = await runScript("node", ["test_main.test.js"], runDir, timeout, stdinInput);
        }

        return {
          success: r.ok,
          message: r.ok
            ? `✅ 测试通过 (${r.durationMs}ms)\n${r.stdout.trim()}`
            : `❌ 测试失败 (${r.durationMs}ms)\n${(r.stdout + "\n" + r.stderr).trim()}`,
          data: { language, action: "test", durationMs: r.durationMs, output: r.stdout.trim(), exitCode: r.exitCode },
        };
      }

      const cmd = language === "python" ? "python" : (language === "typescript" ? "npx" : "node");
      const args = language === "typescript" ? ["tsx", mainFile] : [mainFile];
      const r = await runScript(cmd, args, runDir, timeout, stdinInput);

      const output = r.stdout + (r.stderr ? `\n[stderr] ${r.stderr}` : "");
      return {
        success: r.ok,
        message: r.ok
          ? `✅ ${language} 执行成功 (${r.durationMs}ms)\n${output.trim() || "(无输出)"}`
          : `❌ ${language} 执行失败 (exit: ${r.exitCode}, ${r.durationMs}ms)\n${output.trim()}`,
        data: { language, action: "run", durationMs: r.durationMs, output: output.trim(), exitCode: r.exitCode },
      };
    } finally {
      fs.rm(runDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};
