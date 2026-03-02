import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  browserOpen,
  browserClick,
  browserType,
  browserScreenshot,
  browserReadDom,
  browserScript,
  browserScroll,
  browserWait,
  browserClose,
  browserPressKey,
} from "@/lib/puppeteer-render";

const DEFAULT_SESSION = "main";

export const browserOpenSkill: SkillDefinition = {
  name: "browser_open",
  displayName: "打开浏览器",
  description: "在本地浏览器中打开指定URL。用于需要人眼可见的操作：填表、登录、截图分析等。默认有头模式（可见窗口），headless=true时无头。返回页面标题。",
  icon: "Monitor",
  category: "dev",
  parameters: z.object({
    url: z.string().describe("要打开的URL"),
    sessionId: z.string().optional().describe("浏览器会话ID，相同ID复用同一标签页，默认'main'"),
    headless: z.boolean().optional().describe("是否无头模式（不弹窗），默认false（弹窗可见）"),
    waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional().describe("等待条件，默认networkidle2"),
  }),
  execute: async (params) => {
    const { url, sessionId = DEFAULT_SESSION, headless = false, waitUntil } = params as {
      url: string; sessionId?: string; headless?: boolean; waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
    };
    const r = await browserOpen(url, sessionId, { headless, waitUntil });
    if (!r.ok) return { success: false, message: `浏览器打开失败: ${r.error}` };
    return {
      success: true,
      message: `浏览器已打开: ${r.title}\nURL: ${r.url}\n会话: ${sessionId}`,
      data: { title: r.title, url: r.url, sessionId },
    };
  },
};

export const browserClickSkill: SkillDefinition = {
  name: "browser_click",
  displayName: "浏览器点击",
  description: "点击当前浏览器页面中指定CSS选择器的元素。先确保 browser_open 已打开页面。可先用 browser_read_dom 查找元素的选择器。",
  icon: "MousePointer",
  category: "dev",
  parameters: z.object({
    selector: z.string().describe("CSS选择器，如 '#submit-btn', '.login-form button', 'a[href=\"/login\"]'"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
    waitAfter: z.number().optional().describe("点击后等待毫秒数（等页面响应），默认不等待"),
  }),
  execute: async (params) => {
    const { selector, sessionId = DEFAULT_SESSION, waitAfter } = params as {
      selector: string; sessionId?: string; waitAfter?: number;
    };
    const r = await browserClick(sessionId, selector, { waitAfter });
    if (!r.ok) return { success: false, message: `点击失败: ${r.error}` };
    return { success: true, message: `已点击元素: ${selector}` };
  },
};

export const browserTypeSkill: SkillDefinition = {
  name: "browser_type",
  displayName: "浏览器填表",
  description: "在当前浏览器页面的输入框中输入文字。支持清空后重填、输入后按回车。用于填写表单、搜索框等。",
  icon: "Keyboard",
  category: "dev",
  parameters: z.object({
    selector: z.string().describe("目标输入框CSS选择器，如 'input[name=\"username\"]', '#search-input'"),
    text: z.string().describe("要输入的文字"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
    clearFirst: z.boolean().optional().describe("是否先清空输入框，默认false"),
    pressEnter: z.boolean().optional().describe("输入完成后是否按回车，默认false"),
    delay: z.number().optional().describe("每个字符间隔毫秒数（模拟人类打字），默认30"),
  }),
  execute: async (params) => {
    const { selector, text, sessionId = DEFAULT_SESSION, clearFirst, pressEnter, delay } = params as {
      selector: string; text: string; sessionId?: string; clearFirst?: boolean; pressEnter?: boolean; delay?: number;
    };
    const r = await browserType(sessionId, selector, text, { clearFirst, pressEnter, delay });
    if (!r.ok) return { success: false, message: `输入失败: ${r.error}` };
    const extra = [clearFirst && "已清空", pressEnter && "已回车"].filter(Boolean).join("，");
    return { success: true, message: `已在 ${selector} 中输入 "${text.length > 50 ? text.slice(0, 50) + '...' : text}"${extra ? '（' + extra + '）' : ''}` };
  },
};

export const browserScreenshotSkill: SkillDefinition = {
  name: "browser_screenshot",
  displayName: "浏览器截图",
  description: "对当前浏览器页面截图并保存为PNG文件。用于：确认页面状态、保存页面快照等。截图保存到本地文件，不会传入对话上下文。",
  icon: "Camera",
  category: "dev",
  parameters: z.object({
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
    savePath: z.string().optional().describe("截图保存路径，如 C:/Users/Administrator/Desktop/screenshot.png。不填则自动保存到 ~/.xiniu/screenshots/"),
  }),
  execute: async (params) => {
    const { sessionId = DEFAULT_SESSION, savePath } = params as { sessionId?: string; savePath?: string };

    const autoDir = (await import("path")).join(
      process.env.USERPROFILE || process.env.HOME || ".",
      ".xiniu", "screenshots"
    );
    const actualPath = savePath || (await import("path")).join(
      autoDir,
      `screenshot_${Date.now()}.png`
    );

    const dir = (await import("path")).dirname(actualPath);
    await (await import("fs/promises")).mkdir(dir, { recursive: true });

    const r = await browserScreenshot(sessionId, actualPath);
    if (!r.ok) return { success: false, message: `截图失败: ${r.error}` };
    if (r.savedPath) {
      const stats = await (await import("fs/promises")).stat(r.savedPath);
      return {
        success: true,
        message: `截图已保存: ${r.savedPath} (${Math.round(stats.size / 1024)}KB)`,
        data: { savedPath: r.savedPath, sizeKB: Math.round(stats.size / 1024) },
      };
    }
    if (r.base64) {
      await (await import("fs/promises")).writeFile(actualPath, Buffer.from(r.base64, "base64"));
      const sizeKB = Math.round(r.base64.length * 3 / 4 / 1024);
      return {
        success: true,
        message: `截图已保存: ${actualPath} (${sizeKB}KB)`,
        data: { savedPath: actualPath, sizeKB },
      };
    }
    return { success: false, message: "截图返回空数据" };
  },
};

export const browserReadDomSkill: SkillDefinition = {
  name: "browser_read_dom",
  displayName: "读取页面DOM",
  description: "读取当前浏览器页面的DOM内容。可读取整页文本、指定选择器的元素内容/属性/HTML，或列出所有匹配元素的属性（含坐标位置）。用于：分析页面结构、找到表单字段的选择器、确认元素是否存在。",
  icon: "Code",
  category: "dev",
  parameters: z.object({
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
    selector: z.string().optional().describe("CSS选择器。不填则读取整页内容"),
    mode: z.enum(["text", "html", "outerHTML", "value", "attrs"]).optional().describe("读取模式: text=纯文本, html=innerHTML, outerHTML=含标签, value=表单值, attrs=所有匹配元素的属性列表(含坐标)。默认text"),
    attribute: z.string().optional().describe("读取指定属性值，如'href','src','data-id'"),
  }),
  execute: async (params) => {
    const { sessionId = DEFAULT_SESSION, selector, mode, attribute } = params as {
      sessionId?: string; selector?: string; mode?: "text" | "html" | "outerHTML" | "value" | "attrs"; attribute?: string;
    };
    const r = await browserReadDom(sessionId, { selector, mode, attribute });
    if (!r.ok) return { success: false, message: `读取失败: ${r.error}` };
    if (r.elements) {
      const summary = `找到 ${r.elements.length} 个匹配元素`;
      const detail = JSON.stringify(r.elements, null, 2);
      return { success: true, message: `${summary}\n\n${detail}`, data: { elements: r.elements } };
    }
    return { success: true, message: r.content || "(空)", data: { content: r.content } };
  },
};

export const browserScriptSkill: SkillDefinition = {
  name: "browser_script",
  displayName: "执行页面JS",
  description: "在当前浏览器页面中执行JavaScript代码。可用于：操作DOM、填表（JS方式比type更快）、读取页面数据、触发事件。代码在页面的window上下文中运行。",
  icon: "Terminal",
  category: "dev",
  parameters: z.object({
    script: z.string().describe("要执行的JavaScript代码。最后一个表达式的值将作为返回值。"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
  }),
  execute: async (params) => {
    const { script, sessionId = DEFAULT_SESSION } = params as { script: string; sessionId?: string };
    const r = await browserScript(sessionId, script);
    if (!r.ok) return { success: false, message: `脚本执行失败: ${r.error}` };
    const resultStr = r.result !== undefined ? JSON.stringify(r.result) : "undefined";
    return { success: true, message: `脚本执行成功，返回值: ${resultStr}`, data: { result: r.result } };
  },
};

export const browserScrollSkill: SkillDefinition = {
  name: "browser_scroll",
  displayName: "浏览器滚动",
  description: "滚动当前浏览器页面。支持上下滚动指定像素，或直接滚到顶部/底部。",
  icon: "ArrowDownUp",
  category: "dev",
  parameters: z.object({
    direction: z.enum(["up", "down", "top", "bottom"]).describe("滚动方向"),
    amount: z.number().optional().describe("滚动像素数（仅up/down时有效），默认600"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
  }),
  execute: async (params) => {
    const { direction, amount, sessionId = DEFAULT_SESSION } = params as {
      direction: "up" | "down" | "top" | "bottom"; amount?: number; sessionId?: string;
    };
    const r = await browserScroll(sessionId, direction, amount);
    if (!r.ok) return { success: false, message: `滚动失败: ${r.error}` };
    return { success: true, message: `已滚动: ${direction}${amount ? ` ${amount}px` : ""}` };
  },
};

export const browserWaitSkill: SkillDefinition = {
  name: "browser_wait",
  displayName: "浏览器等待",
  description: "等待页面中某个元素出现或等待固定时间。用于：等待页面加载完成、等待AJAX请求返回、等待动态内容渲染。",
  icon: "Clock",
  category: "dev",
  parameters: z.object({
    selector: z.string().optional().describe("等待该CSS选择器的元素可见。不填则等待固定时间"),
    ms: z.number().optional().describe("超时/等待毫秒数。等待选择器时为超时上限（默认10000），等待时间时为固定等待（默认1000）"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
  }),
  execute: async (params) => {
    const { selector, ms, sessionId = DEFAULT_SESSION } = params as {
      selector?: string; ms?: number; sessionId?: string;
    };
    const r = await browserWait(sessionId, { selector, ms });
    if (!r.ok) return { success: false, message: `等待失败: ${r.error}` };
    return { success: true, message: selector ? `元素已出现: ${selector}` : `已等待 ${ms || 1000}ms` };
  },
};

export const browserCloseSkill: SkillDefinition = {
  name: "browser_close",
  displayName: "关闭浏览器",
  description: "关闭指定会话的浏览器标签页。",
  icon: "XCircle",
  category: "dev",
  parameters: z.object({
    sessionId: z.string().optional().describe("要关闭的会话ID，默认'main'"),
  }),
  execute: async (params) => {
    const { sessionId = DEFAULT_SESSION } = params as { sessionId?: string };
    await browserClose(sessionId);
    return { success: true, message: `已关闭浏览器会话: ${sessionId}` };
  },
};

export const browserPressKeySkill: SkillDefinition = {
  name: "browser_key",
  displayName: "浏览器按键",
  description: "在浏览器中模拟键盘按键。支持方向键、空格、回车、ESC等。可连续按多次。用于测试键盘交互的游戏、表单等。",
  icon: "Keyboard",
  category: "dev",
  parameters: z.object({
    key: z.string().describe("键名：ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Space, Enter, Escape, Tab, Backspace 等"),
    count: z.number().optional().describe("连续按键次数，默认1"),
    delay: z.number().optional().describe("每次按键间隔毫秒数，默认100"),
    sessionId: z.string().optional().describe("会话ID，默认'main'"),
  }),
  execute: async (params) => {
    const { key, count = 1, delay = 100, sessionId = DEFAULT_SESSION } = params as {
      key: string; count?: number; delay?: number; sessionId?: string;
    };
    const r = await browserPressKey(sessionId, key, { count, delay });
    if (!r.ok) return { success: false, message: `按键失败: ${r.error}` };
    return {
      success: true,
      message: `已按键: ${key}${count > 1 ? ` ×${count}` : ""}`,
    };
  },
};
