import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { SkillDefinition } from "../types";

const WORK_DIR = path.join(os.tmpdir(), "xiniu-compile");
const TIMEOUT_MS = 120000;
const MAX_OUTPUT = 200_000;

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  timeout: number,
  stdinData?: string,
): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd,
      timeout,
      shell: true,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) { proc.kill(); stdout += "\n... 输出过长，已截断"; }
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(-MAX_OUTPUT);
    });
    if (stdinData) { proc.stdin.write(stdinData); proc.stdin.end(); }
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, exitCode: code, durationMs: Date.now() - start }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message, exitCode: null, durationMs: Date.now() - start }));
  });
}

async function detectCompiler(lang: string): Promise<{ found: boolean; compiler: string; version: string }> {
  const checks: Record<string, Array<[string, string[]]>> = {
    cpp: [["g++", ["--version"]], ["cl", []], ["clang++", ["--version"]]],
    c: [["gcc", ["--version"]], ["cl", []], ["clang", ["--version"]]],
    csharp: [["dotnet", ["--version"]], ["csc", ["-help"]]],
    java: [["javac", ["-version"]]],
  };

  for (const [cmd, args] of checks[lang] || []) {
    try {
      const r = await runCmd(cmd, args as string[], os.tmpdir(), 10000);
      if (r.ok || r.stdout.length > 0 || (r.stderr.length > 0 && !r.stderr.includes("not recognized"))) {
        const ver = (r.stdout + r.stderr).split("\n")[0].trim().slice(0, 100);
        return { found: true, compiler: cmd, version: ver };
      }
    } catch { /* next */ }
  }
  return { found: false, compiler: "", version: "" };
}

function getFileExt(lang: string): string {
  return { cpp: ".cpp", c: ".c", csharp: ".cs", java: ".java" }[lang] || ".txt";
}

function getDefaultFileName(lang: string, code: string): string {
  if (lang === "java") {
    const classMatch = code.match(/public\s+class\s+(\w+)/);
    return classMatch ? `${classMatch[1]}.java` : "Main.java";
  }
  return { cpp: "main.cpp", c: "main.c", csharp: "Program.cs" }[lang] || "main.txt";
}

export const compileNativeSkill: SkillDefinition = {
  name: "compile_native",
  displayName: "编译型语言开发",
  description:
    "C#/C++/C/Java代码的编写、编译、运行、生成EXE/JAR。支持操作：compile(编译)、run(编译并运行)、build_exe(生成独立EXE)、check(语法检查)、detect(检测编译器)。用户说'编译C++'、'写C#程序'、'生成EXE'、'Java编译'、'运行C++代码'时使用。",
  icon: "Cpu",
  category: "dev",
  parameters: z.object({
    language: z.enum(["cpp", "c", "csharp", "java"])
      .describe("语言: cpp=C++, c=C, csharp=C#, java=Java"),
    action: z.enum(["compile", "run", "build_exe", "check", "detect"])
      .describe("操作: compile=仅编译, run=编译并运行, build_exe=生成独立可执行文件到指定路径, check=语法检查, detect=检测编译器"),
    code: z.string().optional().describe("源代码(detect操作时不需要)"),
    stdinInput: z.string().optional().describe("运行时的标准输入"),
    args: z.array(z.string()).optional().describe("运行时命令行参数"),
    outputPath: z.string().optional().describe("build_exe输出路径(含文件名)，如 C:/Users/Administrator/Desktop/app.exe"),
    compilerFlags: z.array(z.string()).optional().describe("额外编译参数，如 [\"-O2\", \"-std=c++17\"]"),
    files: z.array(z.object({
      name: z.string().describe("文件名"),
      content: z.string().describe("文件内容"),
    })).optional().describe("多文件项目时的额外源文件"),
    timeout: z.number().optional().describe("超时毫秒数，默认120000"),
  }),
  execute: async (params) => {
    try {
      const {
        language, action, code, stdinInput,
        args: runArgs = [], outputPath,
        compilerFlags = [], files = [],
        timeout = TIMEOUT_MS,
      } = params as {
        language: "cpp" | "c" | "csharp" | "java";
        action: string; code?: string; stdinInput?: string;
        args?: string[]; outputPath?: string;
        compilerFlags?: string[]; files?: { name: string; content: string }[];
        timeout?: number;
      };

      // ===== DETECT =====
      if (action === "detect") {
        const langs = ["cpp", "c", "csharp", "java"];
        const results: string[] = [];
        for (const l of langs) {
          const d = await detectCompiler(l);
          const name = { cpp: "C++", c: "C", csharp: "C#", java: "Java" }[l] || l;
          results.push(d.found
            ? `✅ ${name}: ${d.compiler} — ${d.version}`
            : `❌ ${name}: 未找到编译器`);
        }
        return {
          success: true,
          message: `编译器检测结果:\n━━━━━━━━━━━━━━━━━━━━\n${results.join("\n")}\n\n提示: C++需要g++/MSVC, C#需要dotnet, Java需要JDK`,
        };
      }

      if (!code) return { success: false, message: "请提供源代码(code参数)" };

      const compiler = await detectCompiler(language);
      if (!compiler.found) {
        const installHints: Record<string, string> = {
          cpp: "安装 MinGW (g++) 或 Visual Studio Build Tools (cl)",
          c: "安装 MinGW (gcc) 或 Visual Studio Build Tools (cl)",
          csharp: "安装 .NET SDK: https://dotnet.microsoft.com/download",
          java: "安装 JDK: https://adoptium.net/",
        };
        return { success: false, message: `❌ 未找到 ${language} 编译器\n建议: ${installHints[language] || "安装对应编译器"}` };
      }

      const projDir = path.join(WORK_DIR, `proj_${Date.now()}`);
      await fs.mkdir(projDir, { recursive: true });

      try {
        const mainFile = getDefaultFileName(language, code);
        await fs.writeFile(path.join(projDir, mainFile), code, "utf-8");

        for (const f of files) {
          const fp = path.join(projDir, f.name);
          await fs.mkdir(path.dirname(fp), { recursive: true });
          await fs.writeFile(fp, f.content, "utf-8");
        }

        const allSrcFiles = [mainFile, ...files.map(f => f.name)].filter(f => f.endsWith(getFileExt(language)));

        // ===== CHECK =====
        if (action === "check") {
          let r: RunResult;
          switch (language) {
            case "cpp":
            case "c":
              r = await runCmd(compiler.compiler, ["-fsyntax-only", ...compilerFlags, ...allSrcFiles], projDir, 30000);
              break;
            case "csharp":
              r = await runCmd("dotnet", ["build", "--nologo"], projDir, 60000);
              if (r.exitCode !== 0) {
                r = await runCmd(compiler.compiler, ["-nologo", "-t:exe", "-out:NUL", ...allSrcFiles], projDir, 30000);
              }
              break;
            case "java":
              r = await runCmd("javac", ["-Xlint:all", ...allSrcFiles], projDir, 30000);
              break;
            default:
              r = { ok: false, stdout: "", stderr: "不支持的语言", exitCode: 1, durationMs: 0 };
          }
          return {
            success: r.ok,
            message: r.ok
              ? `✅ ${language.toUpperCase()} 语法检查通过 (${r.durationMs}ms)\n编译器: ${compiler.compiler} ${compiler.version}`
              : `❌ 语法错误:\n${formatErrors(r.stderr + r.stdout, language)}`,
          };
        }

        // ===== COMPILE =====
        const exeName = language === "java" ? "" : (language === "csharp" ? "output.exe" : (os.platform() === "win32" ? "output.exe" : "output"));
        let compileResult: RunResult;
        let outputBinary = path.join(projDir, exeName);

        switch (language) {
          case "cpp":
            compileResult = await runCmd(compiler.compiler, [
              ...compilerFlags, "-o", exeName, ...allSrcFiles,
              ...(compilerFlags.length === 0 ? ["-std=c++17"] : []),
            ], projDir, timeout);
            break;
          case "c":
            compileResult = await runCmd(compiler.compiler, [
              ...compilerFlags, "-o", exeName, ...allSrcFiles,
            ], projDir, timeout);
            break;
          case "csharp": {
            if (compiler.compiler === "dotnet") {
              const csprojContent = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>`;
              await fs.writeFile(path.join(projDir, "project.csproj"), csprojContent, "utf-8");
              compileResult = await runCmd("dotnet", ["build", "--nologo", "-o", "bin"], projDir, timeout);
              outputBinary = path.join(projDir, "bin", "project.exe");
            } else {
              compileResult = await runCmd("csc", ["-nologo", `-out:${exeName}`, ...compilerFlags, ...allSrcFiles], projDir, timeout);
            }
            break;
          }
          case "java":
            compileResult = await runCmd("javac", [...compilerFlags, ...allSrcFiles], projDir, timeout);
            outputBinary = "";
            break;
          default:
            return { success: false, message: "不支持的语言" };
        }

        if (!compileResult.ok) {
          return {
            success: false,
            message: `❌ 编译失败 (${compileResult.durationMs}ms)\n编译器: ${compiler.compiler}\n\n${formatErrors(compileResult.stderr + compileResult.stdout, language)}`,
            data: { step: "compile", exitCode: compileResult.exitCode, errors: compileResult.stderr },
          };
        }

        const compileMsg = `✅ 编译成功 (${compileResult.durationMs}ms)\n编译器: ${compiler.compiler}\n`;

        if (action === "compile") {
          return { success: true, message: compileMsg + (compileResult.stderr ? `\n⚠ 警告:\n${compileResult.stderr}` : "") };
        }

        // ===== BUILD_EXE =====
        if (action === "build_exe") {
          if (language === "java") {
            const className = mainFile.replace(".java", "");
            const jarName = `${className}.jar`;
            const manifestContent = `Main-Class: ${className}\n`;
            await fs.writeFile(path.join(projDir, "MANIFEST.MF"), manifestContent, "utf-8");
            const jarR = await runCmd("jar", ["cfm", jarName, "MANIFEST.MF", `${className}.class`], projDir, 30000);
            if (!jarR.ok) return { success: false, message: `❌ JAR打包失败:\n${jarR.stderr}` };

            const dest = outputPath || path.join("C:\\Users\\Administrator\\Desktop", jarName);
            await fs.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
            await fs.copyFile(path.join(projDir, jarName), path.resolve(dest));
            const stat = await fs.stat(path.resolve(dest));
            return {
              success: true,
              message: `${compileMsg}\n📦 JAR已生成: ${path.resolve(dest)}\n大小: ${(stat.size / 1024).toFixed(1)} KB\n运行: java -jar "${path.resolve(dest)}"`,
              data: { path: path.resolve(dest), size: stat.size, type: "jar" },
            };
          }

          if (language === "csharp" && compiler.compiler === "dotnet") {
            const publishR = await runCmd("dotnet", [
              "publish", "--nologo", "-c", "Release",
              "-r", "win-x64", "--self-contained", "true",
              "-p:PublishSingleFile=true", "-p:IncludeNativeLibrariesForSelfExtract=true",
              "-o", "publish",
            ], projDir, 180000);
            if (!publishR.ok) return { success: false, message: `❌ 发布失败:\n${publishR.stderr}` };

            const publishDir = path.join(projDir, "publish");
            const exeFiles = (await fs.readdir(publishDir)).filter(f => f.endsWith(".exe"));
            if (exeFiles.length === 0) return { success: false, message: "❌ 发布目录中未找到EXE文件" };

            const dest = outputPath || path.join("C:\\Users\\Administrator\\Desktop", exeFiles[0]);
            await fs.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
            await fs.copyFile(path.join(publishDir, exeFiles[0]), path.resolve(dest));
            const stat = await fs.stat(path.resolve(dest));
            return {
              success: true,
              message: `${compileMsg}\n📦 独立EXE已生成: ${path.resolve(dest)}\n大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB\n特性: 单文件 · 自包含 · 无需.NET运行时`,
              data: { path: path.resolve(dest), size: stat.size, type: "exe" },
            };
          }

          const dest = outputPath || path.join("C:\\Users\\Administrator\\Desktop", exeName);
          await fs.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
          await fs.copyFile(outputBinary, path.resolve(dest));
          const stat = await fs.stat(path.resolve(dest));
          return {
            success: true,
            message: `${compileMsg}\n📦 EXE已生成: ${path.resolve(dest)}\n大小: ${(stat.size / 1024).toFixed(1)} KB`,
            data: { path: path.resolve(dest), size: stat.size, type: "exe" },
          };
        }

        // ===== RUN =====
        let runResult: RunResult;
        if (language === "java") {
          const className = mainFile.replace(".java", "");
          runResult = await runCmd("java", ["-cp", ".", className, ...runArgs], projDir, timeout, stdinInput);
        } else if (language === "csharp" && compiler.compiler === "dotnet") {
          runResult = await runCmd("dotnet", ["run", "--no-build", "--", ...runArgs], projDir, timeout, stdinInput);
        } else {
          runResult = await runCmd(outputBinary, runArgs, projDir, timeout, stdinInput);
        }

        const output = runResult.stdout + (runResult.stderr ? `\n[stderr] ${runResult.stderr}` : "");
        return {
          success: runResult.ok,
          message: runResult.ok
            ? `${compileMsg}\n▶ 运行成功 (${runResult.durationMs}ms)\n━━━━━━━━━━━━━━━━━━━━\n${output.trim() || "(无输出)"}`
            : `${compileMsg}\n❌ 运行失败 (exit: ${runResult.exitCode}, ${runResult.durationMs}ms)\n━━━━━━━━━━━━━━━━━━━━\n${output.trim()}`,
          data: {
            step: "run", language,
            compileDurationMs: compileResult.durationMs,
            runDurationMs: runResult.durationMs,
            output: output.trim(),
            exitCode: runResult.exitCode,
          },
        };
      } finally {
        fs.rm(projDir, { recursive: true, force: true }).catch(() => {});
      }
    } catch (err) {
      return { success: false, message: `编译执行异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

function formatErrors(raw: string, lang: string): string {
  const lines = raw.split("\n").filter(l => l.trim());
  if (lines.length === 0) return "(无详细错误信息)";

  if (lang === "cpp" || lang === "c") {
    return lines.map(l => {
      const m = l.match(/^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)/);
      if (m) return `  📍 ${m[1]}:${m[2]}:${m[3]} [${m[4]}]\n     ${m[5]}`;
      return `  ${l}`;
    }).join("\n");
  }

  if (lang === "csharp") {
    return lines.map(l => {
      const m = l.match(/(CS\d+):\s*(.+)/);
      if (m) return `  📍 [${m[1]}] ${m[2]}`;
      return `  ${l}`;
    }).join("\n");
  }

  if (lang === "java") {
    return lines.map(l => {
      const m = l.match(/^(.+\.java):(\d+):\s*error:\s*(.+)/);
      if (m) return `  📍 ${m[1]}:${m[2]}\n     ${m[3]}`;
      return `  ${l}`;
    }).join("\n");
  }

  return lines.map(l => `  ${l}`).join("\n");
}
