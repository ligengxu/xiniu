import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { SkillDefinition } from "../types";

const SCREENSHOTS_DIR = path.join(os.tmpdir(), "xiniu-debug-screenshots");

function runCmd(cmd: string, args: string[], cwd: string, timeout = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, timeout, shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message }));
  });
}

async function takeScreenshot(outputPath: string): Promise<{ ok: boolean; path: string; error?: string }> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$totalWidth = 0
$totalHeight = 0
foreach ($s in $screens) {
  $r = $s.Bounds
  if ($r.Right -gt $totalWidth) { $totalWidth = $r.Right }
  if ($r.Bottom -gt $totalHeight) { $totalHeight = $r.Bottom }
}
$bmp = New-Object System.Drawing.Bitmap($totalWidth, $totalHeight)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "OK"
`;

  const r = await runCmd("powershell", ["-NoProfile", "-Command", psScript], os.tmpdir(), 15000);
  if (r.ok && r.stdout.includes("OK")) {
    return { ok: true, path: outputPath };
  }
  return { ok: false, path: outputPath, error: r.stderr || "截图失败" };
}

async function captureWindow(windowTitle: string, outputPath: string): Promise<{ ok: boolean; path: string; error?: string }> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

$targetTitle = '${windowTitle.replace(/'/g, "''")}'
$found = $null
[WinAPI]::EnumWindows({
  param($hWnd, $lParam)
  if ([WinAPI]::IsWindowVisible($hWnd)) {
    $sb = New-Object System.Text.StringBuilder 256
    [WinAPI]::GetWindowText($hWnd, $sb, 256) | Out-Null
    $title = $sb.ToString()
    if ($title -like "*$targetTitle*") {
      $script:found = $hWnd
      return $false
    }
  }
  return $true
}, [IntPtr]::Zero)

if ($found -eq $null) { Write-Error "WINDOW_NOT_FOUND"; exit 1 }

[WinAPI]::SetForegroundWindow($found)
Start-Sleep -Milliseconds 300
$rect = New-Object WinAPI+RECT
[WinAPI]::GetWindowRect($found, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "INVALID_RECT"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save('${outputPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "OK:$w x $h"
`;

  const r = await runCmd("powershell", ["-NoProfile", "-Command", psScript], os.tmpdir(), 15000);
  if (r.ok && r.stdout.includes("OK")) {
    return { ok: true, path: outputPath };
  }
  if (r.stderr.includes("WINDOW_NOT_FOUND")) {
    return { ok: false, path: outputPath, error: `未找到标题包含"${windowTitle}"的窗口` };
  }
  return { ok: false, path: outputPath, error: r.stderr || "窗口截图失败" };
}

async function listWindows(): Promise<string[]> {
  const psScript = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public class WinList {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public static List<string> titles = new List<string>();
  public static void Enumerate() {
    EnumWindows((hWnd, lParam) => {
      if (IsWindowVisible(hWnd)) {
        var sb = new StringBuilder(256);
        GetWindowText(hWnd, sb, 256);
        var t = sb.ToString().Trim();
        if (t.Length > 0) titles.Add(t);
      }
      return true;
    }, IntPtr.Zero);
  }
}
'@
[WinList]::Enumerate()
[WinList]::titles | ForEach-Object { Write-Output $_ }
`;
  const r = await runCmd("powershell", ["-NoProfile", "-Command", psScript], os.tmpdir(), 10000);
  if (r.ok) return r.stdout.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  return [];
}

async function analyzeScreenshot(imgPath: string, question?: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return "⚠ 未配置 DASHSCOPE_API_KEY，无法进行AI视觉分析。请在 .env.local 中设置。";

  try {
    const imgData = await fs.readFile(imgPath);
    const base64 = imgData.toString("base64");
    const mime = "image/png";

    const prompt = question || "请仔细分析这个应用程序界面截图，找出所有可能的问题和BUG：\n1. UI布局问题（重叠、溢出、对齐不正、截断）\n2. 文字问题（乱码、拼写错误、翻译问题、文字被截断）\n3. 视觉问题（颜色不协调、对比度不足、图标缺失、样式异常）\n4. 功能问题（按钮状态异常、表单缺少验证提示、空状态没提示）\n5. 交互问题（不可点击的元素看起来可点击、没有hover效果提示）\n\n请以列表形式输出找到的每个问题，包含问题位置描述和修复建议。";

    const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-vl-plus",
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            { type: "text", text: prompt },
          ],
        }],
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) return `AI分析失败: HTTP ${resp.status}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any;
    return data.choices?.[0]?.message?.content || "AI未返回分析结果";
  } catch (err) {
    return `AI分析异常: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function analyzeCodeErrors(code: string, errors: string, language: string): Promise<string> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return "⚠ 未配置 DASHSCOPE_API_KEY，无法进行AI代码分析";

  try {
    const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "qwen-plus",
        messages: [{
          role: "user",
          content: `请分析以下 ${language} 代码的编译/运行错误，给出具体的修复建议：\n\n== 源代码 ==\n\`\`\`${language}\n${code.slice(0, 8000)}\n\`\`\`\n\n== 错误信息 ==\n\`\`\`\n${errors.slice(0, 4000)}\n\`\`\`\n\n请按以下格式输出：\n1. 错误原因分析\n2. 修复后的完整代码\n3. 注意事项`,
        }],
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) return `AI分析失败: HTTP ${resp.status}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await resp.json() as any;
    return data.choices?.[0]?.message?.content || "AI未返回分析结果";
  } catch (err) {
    return `AI分析异常: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export const visualDebugSkill: SkillDefinition = {
  name: "visual_debug",
  displayName: "可视化调试",
  description:
    "截图应用界面并AI分析找BUG、分析编译错误并生成修复代码、列出运行中的窗口。支持：screenshot(全屏截图)、capture_window(指定窗口截图)、analyze_ui(截图+AI分析界面BUG)、analyze_errors(AI分析编译/运行错误)、list_windows(列出窗口)。用户说'截图调试'、'界面找BUG'、'分析错误'、'窗口截图'时使用。",
  icon: "Bug",
  category: "dev",
  parameters: z.object({
    action: z.enum(["screenshot", "capture_window", "analyze_ui", "analyze_errors", "list_windows"])
      .describe("操作: screenshot=全屏截图, capture_window=指定窗口截图, analyze_ui=截图+AI分析界面BUG, analyze_errors=AI分析编译错误并给修复建议, list_windows=列出所有可见窗口"),
    windowTitle: z.string().optional().describe("capture_window/analyze_ui时的目标窗口标题(模糊匹配)"),
    savePath: z.string().optional().describe("截图保存路径，默认自动生成"),
    question: z.string().optional().describe("analyze_ui时的具体问题，如'按钮样式有什么问题'"),
    code: z.string().optional().describe("analyze_errors时的源代码"),
    errors: z.string().optional().describe("analyze_errors时的错误信息"),
    language: z.string().optional().describe("analyze_errors时的编程语言"),
  }),
  execute: async (params) => {
    try {
      const { action, windowTitle, savePath, question, code, errors, language } = params as {
        action: string; windowTitle?: string; savePath?: string; question?: string;
        code?: string; errors?: string; language?: string;
      };

      await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

      switch (action) {
        case "list_windows": {
          const windows = await listWindows();
          if (windows.length === 0) return { success: false, message: "未找到可见窗口" };
          return {
            success: true,
            message: `当前可见窗口 (${windows.length}个):\n━━━━━━━━━━━━━━━━━━━━\n${windows.map((w, i) => `${i + 1}. ${w}`).join("\n")}\n\n提示: 使用 capture_window + windowTitle 截取指定窗口`,
            data: { windows, count: windows.length },
          };
        }

        case "screenshot": {
          const outPath = savePath ? path.resolve(savePath) : path.join(SCREENSHOTS_DIR, `screen_${Date.now()}.png`);
          const r = await takeScreenshot(outPath);
          if (!r.ok) return { success: false, message: `截图失败: ${r.error}` };
          const stat = await fs.stat(outPath);
          return {
            success: true,
            message: `📸 全屏截图已保存: ${outPath}\n大小: ${(stat.size / 1024).toFixed(1)} KB`,
            data: { path: outPath, size: stat.size },
          };
        }

        case "capture_window": {
          if (!windowTitle) return { success: false, message: "请提供 windowTitle 参数（窗口标题关键词）" };
          const outPath = savePath ? path.resolve(savePath) : path.join(SCREENSHOTS_DIR, `win_${Date.now()}.png`);
          const r = await captureWindow(windowTitle, outPath);
          if (!r.ok) return { success: false, message: `窗口截图失败: ${r.error}` };
          const stat = await fs.stat(outPath);
          return {
            success: true,
            message: `📸 窗口截图已保存: ${outPath}\n目标窗口: "${windowTitle}"\n大小: ${(stat.size / 1024).toFixed(1)} KB`,
            data: { path: outPath, size: stat.size, windowTitle },
          };
        }

        case "analyze_ui": {
          const outPath = path.join(SCREENSHOTS_DIR, `debug_${Date.now()}.png`);
          let captureOk: boolean;
          if (windowTitle) {
            const r = await captureWindow(windowTitle, outPath);
            captureOk = r.ok;
            if (!r.ok) return { success: false, message: `窗口截图失败: ${r.error}` };
          } else {
            const r = await takeScreenshot(outPath);
            captureOk = r.ok;
            if (!r.ok) return { success: false, message: `截图失败: ${r.error}` };
          }

          if (!captureOk) return { success: false, message: "截图失败" };

          const analysis = await analyzeScreenshot(outPath, question);

          return {
            success: true,
            message: `📸 截图已保存: ${outPath}\n${windowTitle ? `窗口: "${windowTitle}"\n` : ""}\n🔍 AI界面分析结果:\n━━━━━━━━━━━━━━━━━━━━\n${analysis}`,
            data: { screenshotPath: outPath, analysis },
          };
        }

        case "analyze_errors": {
          if (!errors) return { success: false, message: "请提供 errors 参数（错误信息）" };
          const analysis = await analyzeCodeErrors(
            code || "(未提供源代码)",
            errors,
            language || "unknown",
          );
          return {
            success: true,
            message: `🔍 AI错误分析结果:\n━━━━━━━━━━━━━━━━━━━━\n${analysis}`,
            data: { analysis, language },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `调试操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
