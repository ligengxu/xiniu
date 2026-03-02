import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  browserOpen,
  browserScreenshot,
  browserScript,
  browserClick,
  browserWait,
} from "@/lib/puppeteer-render";

const SESSION_ID = "test";

export const browserTestSkill: SkillDefinition = {
  name: "browser_test",
  displayName: "浏览器自动测试",
  description:
    "自动化浏览器测试工具。打开本地HTML文件或URL，按顺序执行操作序列（点击/按键/等待/执行JS/截图），返回每步结果和最终截图。用于测试网页、游戏、UI组件的功能是否正常。",
  icon: "Monitor",
  category: "dev",
  parameters: z.object({
    url: z.string().describe("要测试的URL或本地文件路径（如 C:/Users/xxx/test.html）"),
    steps: z.array(
      z.object({
        action: z.enum(["wait", "click", "key", "js", "screenshot"]).describe(
          "操作类型：wait=等待毫秒, click=点击元素, key=按键, js=执行JS代码, screenshot=截图"
        ),
        value: z.string().describe(
          "操作值：wait时为毫秒数, click时为CSS选择器, key时为键名(如ArrowRight), js时为JS代码, screenshot时为文件名"
        ),
      })
    ).describe("测试步骤序列"),
    headless: z.boolean().optional().describe("是否无头模式，默认false（有头可见）"),
  }),
  execute: async (params) => {
    const { url, steps, headless = false } = params as {
      url: string;
      steps: { action: string; value: string }[];
      headless?: boolean;
    };

    let targetUrl = url;
    if (!url.startsWith("http") && !url.startsWith("file:///")) {
      const path = await import("path");
      const resolved = path.default.resolve(url);
      targetUrl = "file:///" + resolved.replace(/\\/g, "/");
    }

    const openResult = await browserOpen(targetUrl, SESSION_ID, { headless, waitUntil: "load" });
    if (!openResult.ok) {
      return { success: false, message: `浏览器打开失败: ${openResult.error}` };
    }

    const stepResults: { step: number; action: string; success: boolean; detail: string }[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepNum = i + 1;

      try {
        switch (step.action) {
          case "wait": {
            const ms = parseInt(step.value) || 1000;
            await new Promise((r) => setTimeout(r, ms));
            stepResults.push({ step: stepNum, action: "wait", success: true, detail: `等待 ${ms}ms` });
            break;
          }

          case "click": {
            const r = await browserClick(SESSION_ID, step.value, { waitAfter: 500 });
            stepResults.push({
              step: stepNum,
              action: "click",
              success: r.ok,
              detail: r.ok ? `点击 ${step.value}` : `点击失败: ${r.error}`,
            });
            break;
          }

          case "key": {
            const r = await browserScript(
              SESSION_ID,
              `document.dispatchEvent(new KeyboardEvent('keydown', {key: '${step.value}', bubbles: true}));`
            );
            await new Promise((res) => setTimeout(res, 200));
            stepResults.push({
              step: stepNum,
              action: "key",
              success: r.ok,
              detail: r.ok ? `按键 ${step.value}` : `按键失败: ${r.error}`,
            });
            break;
          }

          case "js": {
            const r = await browserScript(SESSION_ID, step.value);
            stepResults.push({
              step: stepNum,
              action: "js",
              success: r.ok,
              detail: r.ok
                ? `JS执行成功${r.result ? `: ${String(r.result).slice(0, 200)}` : ""}`
                : `JS执行失败: ${r.error}`,
            });
            break;
          }

          case "screenshot": {
            const filename = step.value || `test-step-${stepNum}.png`;
            const r = await browserScreenshot(SESSION_ID, filename);
            stepResults.push({
              step: stepNum,
              action: "screenshot",
              success: r.ok,
              detail: r.ok ? `截图已保存: ${r.savedPath || filename}` : `截图失败: ${r.error}`,
            });
            break;
          }

          default:
            stepResults.push({
              step: stepNum,
              action: step.action,
              success: false,
              detail: `未知操作: ${step.action}`,
            });
        }
      } catch (err) {
        stepResults.push({
          step: stepNum,
          action: step.action,
          success: false,
          detail: `异常: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const passed = stepResults.filter((r) => r.success).length;
    const failed = stepResults.filter((r) => !r.success).length;

    let report = `浏览器测试报告\n`;
    report += `URL: ${targetUrl}\n`;
    report += `结果: ${passed}/${stepResults.length} 步骤通过`;
    if (failed > 0) report += ` (${failed} 步骤失败)`;
    report += `\n\n`;

    stepResults.forEach((r) => {
      report += `${r.success ? "✓" : "✗"} 步骤${r.step} [${r.action}]: ${r.detail}\n`;
    });

    return {
      success: failed === 0,
      message: report,
      data: { url: targetUrl, steps: stepResults, passed, failed },
    };
  },
};
