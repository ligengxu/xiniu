import type { Browser, Page } from "puppeteer";

let headlessBrowser: Browser | null = null;
let headlessBrowserLastUsed = 0;

let visibleBrowser: Browser | null = null;
let visibleBrowserLastUsed = 0;

const sessionPages = new Map<string, Page>();
const sessionErrors = new Map<string, string[]>();

interface SessionMeta {
  url: string;
  headless: boolean;
  openedAt: number;
  lastUrl?: string;
}
const sessionMeta = new Map<string, SessionMeta>();

let _recovering = new Set<string>();

async function getOrRecoverPage(sessionId: string): Promise<Page | null> {
  const page = sessionPages.get(sessionId);
  if (page && !page.isClosed()) {
    try {
      const meta = sessionMeta.get(sessionId);
      if (meta) meta.lastUrl = page.url();
    } catch { /* page might be in weird state, ignore */ }
    return page;
  }

  sessionPages.delete(sessionId);

  if (_recovering.has(sessionId)) return null;

  const meta = sessionMeta.get(sessionId);
  if (!meta) return null;

  const recoveryUrl = meta.lastUrl || meta.url;
  if (!recoveryUrl || recoveryUrl === "about:blank") return null;

  _recovering.add(sessionId);
  try {
    console.log(`[puppeteer] 会话 "${sessionId}" 已断开，自动恢复中 → ${recoveryUrl}`);
    const result = await browserOpen(recoveryUrl, sessionId, {
      headless: meta.headless,
      waitUntil: "domcontentloaded",
    });
    if (result.ok) {
      console.log(`[puppeteer] 会话 "${sessionId}" 自动恢复成功: ${result.url}`);
      return sessionPages.get(sessionId) || null;
    }
    console.log(`[puppeteer] 会话 "${sessionId}" 自动恢复失败: ${result.error}`);
    return null;
  } catch (err) {
    console.log(`[puppeteer] 会话 "${sessionId}" 恢复异常: ${err}`);
    return null;
  } finally {
    _recovering.delete(sessionId);
  }
}

const BROWSER_IDLE_MS = 120_000;

const STEALTH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-blink-features=AutomationControlled",
  "--window-size=1920,1080",
  "--disable-web-security",
  "--disable-features=IsolateOrigins,site-per-process",
  "--allow-file-access-from-files",
  "--allow-file-access",
];

const STEALTH_HEADERS: Record<string, string> = {
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function launchBrowser(headless: boolean): Promise<Browser> {
  const puppeteer = await import("puppeteer");
  return puppeteer.default.launch({
    headless: headless ? true : false,
    defaultViewport: null,
    args: headless ? STEALTH_ARGS : [...STEALTH_ARGS, "--start-maximized"],
  });
}

function scheduleIdleClose(
  getBrowser: () => Browser | null,
  setBrowser: (b: Browser | null) => void,
  getLastUsed: () => number,
) {
  const check = setInterval(async () => {
    const b = getBrowser();
    if (!b) { clearInterval(check); return; }
    if (Date.now() - getLastUsed() > BROWSER_IDLE_MS) {
      await b.close().catch(() => {});
      setBrowser(null);
      for (const [sid, p] of sessionPages) {
        try { if (p.browser() === b) sessionPages.delete(sid); } catch { sessionPages.delete(sid); }
      }
      clearInterval(check);
    }
  }, 15_000);
}

async function getHeadlessBrowser(): Promise<Browser> {
  if (headlessBrowser) {
    try {
      if (headlessBrowser.connected) {
        headlessBrowserLastUsed = Date.now();
        return headlessBrowser;
      }
    } catch { /* browser disconnected */ }
    headlessBrowser = null;
  }
  headlessBrowser = await launchBrowser(true);
  headlessBrowserLastUsed = Date.now();
  scheduleIdleClose(
    () => headlessBrowser,
    (b) => { headlessBrowser = b; },
    () => headlessBrowserLastUsed,
  );
  return headlessBrowser;
}

async function getVisibleBrowser(): Promise<Browser> {
  if (visibleBrowser) {
    try {
      if (visibleBrowser.connected) {
        visibleBrowserLastUsed = Date.now();
        return visibleBrowser;
      }
    } catch { /* browser disconnected */ }
    visibleBrowser = null;
  }
  visibleBrowser = await launchBrowser(false);
  visibleBrowserLastUsed = Date.now();
  scheduleIdleClose(
    () => visibleBrowser,
    (b) => { visibleBrowser = b; },
    () => visibleBrowserLastUsed,
  );
  return visibleBrowser;
}

async function applyStealthToPage(page: Page) {
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders(STEALTH_HEADERS);
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN", "zh", "en"] });
    Object.defineProperty(navigator, "platform", { get: () => "Win32" });
    // @ts-expect-error chrome mock
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (p: PermissionDescriptor) =>
      p.name === "notifications"
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : origQuery(p);
  });
}

// ---------- Public API: session-based browser control ----------

export async function browserOpen(
  url: string,
  sessionId: string,
  options: { headless?: boolean; waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2" } = {},
): Promise<{ ok: boolean; title: string; url: string; error?: string }> {
  const isFileUrl = url.startsWith("file:///") || url.startsWith("file://");
  const { headless = false, waitUntil = isFileUrl ? "load" : "networkidle2" } = options;
  try {
    const browser = headless ? await getHeadlessBrowser() : await getVisibleBrowser();

    const existingPage = sessionPages.get(sessionId);
    if (existingPage && !existingPage.isClosed()) {
      await existingPage.close().catch(() => {});
    }

    const page = await browser.newPage();
    if (!isFileUrl) {
      await applyStealthToPage(page);
    }
    await page.setViewport({ width: 1920, height: 1080 });
    sessionPages.set(sessionId, page);

    const errors: string[] = [];
    sessionErrors.set(sessionId, errors);

    page.on("pageerror", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`[pageerror] ${msg}`);
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(`[console.error] ${msg.text()}`);
      }
    });

    await page.evaluateOnNewDocument(() => {
      const w = window as unknown as { __capturedErrors: string[] };
      w.__capturedErrors = [];
      window.onerror = (msg, src, line, col) => {
        w.__capturedErrors.push(`${msg} (${src}:${line}:${col})`);
      };
      window.addEventListener("unhandledrejection", (e) => {
        w.__capturedErrors.push(`Unhandled Promise: ${e.reason}`);
      });
    });

    await page.goto(url, { waitUntil, timeout: 30000 });

    if (isFileUrl) {
      await new Promise(r => setTimeout(r, 500));
    }

    sessionMeta.set(sessionId, {
      url,
      headless,
      openedAt: Date.now(),
      lastUrl: page.url(),
    });

    const title = await page.title();
    return { ok: true, title, url: page.url() };
  } catch (err) {
    return { ok: false, title: "", url, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserClick(
  sessionId: string,
  selector: string,
  options: { waitAfter?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复，请先调用 browser_open" };
  try {
    const useContains = /:contains\(/i.test(selector);

    if (useContains) {
      const clicked = await page.evaluate((sel: string) => {
        function findByContains(expr: string): HTMLElement | null {
          const parts = expr.split(",").map((s) => s.trim());
          for (const part of parts) {
            const m = part.match(/^(.+?):contains\(["']?(.+?)["']?\)$/i);
            if (m) {
              const els = document.querySelectorAll(m[1].trim() || "*");
              for (const el of els) {
                if (el.textContent && el.textContent.includes(m[2])) {
                  return el as HTMLElement;
                }
              }
            }
          }
          return null;
        }
        const el = findByContains(sel);
        if (!el) return "not_found";
        el.scrollIntoView({ block: "center" });
        el.focus();
        el.click();
        return "ok";
      }, selector);
      if (clicked === "not_found") return { ok: false, error: `元素未找到: ${selector}` };
    } else {
      let found = false;
      try {
        await page.waitForSelector(selector, { timeout: 10000, visible: true });
        found = true;
      } catch {
        found = await page.evaluate((sel: string) => !!document.querySelector(sel), selector);
      }
      if (!found) return { ok: false, error: `元素未找到: ${selector}` };

      try {
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) el.scrollIntoView({ block: "center" });
        }, selector);
        await page.click(selector);
      } catch {
        const clicked = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          el.scrollIntoView({ block: "center" });
          el.focus();
          el.click();
          return true;
        }, selector);
        if (!clicked) return { ok: false, error: `元素存在但无法点击: ${selector}` };
      }
    }
    if (options.waitAfter) {
      await new Promise(r => setTimeout(r, options.waitAfter));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserType(
  sessionId: string,
  selector: string,
  text: string,
  options: { clearFirst?: boolean; pressEnter?: boolean; delay?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    const useContains = /:contains\(/i.test(selector);

    const focusAndType = async (evalSelector: string, isContains: boolean) => {
      if (isContains) {
        await page.evaluate((sel: string, clear: boolean) => {
          function findByContains(expr: string): HTMLElement | null {
            for (const part of expr.split(",").map((s) => s.trim())) {
              const m = part.match(/^(.+?):contains\(["']?(.+?)["']?\)$/i);
              if (m) { for (const el of document.querySelectorAll(m[1].trim() || "*")) { if (el.textContent?.includes(m[2])) return el as HTMLElement; } }
            }
            return null;
          }
          const el = findByContains(sel) as HTMLInputElement | null;
          if (!el) return;
          el.scrollIntoView({ block: "center" }); el.focus();
          if (clear) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); }
        }, evalSelector, !!options.clearFirst);
      } else {
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
        }, evalSelector);
        if (options.clearFirst) {
          await page.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (el) { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
          }, evalSelector);
        }
      }
    };

    if (useContains) {
      const found = await page.evaluate((sel: string) => {
        for (const part of sel.split(",").map((s: string) => s.trim())) {
          const m = part.match(/^(.+?):contains\(["']?(.+?)["']?\)$/i);
          if (m) { for (const el of document.querySelectorAll(m[1].trim() || "*")) { if (el.textContent?.includes(m[2])) return true; } }
        }
        return false;
      }, selector);
      if (!found) return { ok: false, error: `输入元素未找到: ${selector}` };
      await focusAndType(selector, true);
      await page.evaluate((sel: string, val: string) => {
        function findByContains(expr: string): HTMLElement | null {
          for (const part of expr.split(",").map((s: string) => s.trim())) {
            const m = part.match(/^(.+?):contains\(["']?(.+?)["']?\)$/i);
            if (m) { for (const el of document.querySelectorAll(m[1].trim() || "*")) { if (el.textContent?.includes(m[2])) return el as HTMLElement; } }
          }
          return null;
        }
        const el = findByContains(sel) as HTMLInputElement | null;
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(el, val); else el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, selector, text);
    } else {
      let found = false;
      try { await page.waitForSelector(selector, { timeout: 10000, visible: true }); found = true; }
      catch { found = await page.evaluate((sel: string) => !!document.querySelector(sel), selector); }
      if (!found) return { ok: false, error: `输入元素未找到: ${selector}` };
      await focusAndType(selector, false);
      try {
        await page.type(selector, text, { delay: options.delay ?? 30 });
      } catch {
        await page.evaluate((sel: string, val: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, selector, text);
      }
    }

    if (options.pressEnter) {
      await page.keyboard.press("Enter");
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserScreenshot(
  sessionId: string,
  savePath?: string,
): Promise<{ ok: boolean; base64?: string; savedPath?: string; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    if (savePath) {
      const path = await import("path");
      const fs = await import("fs/promises");
      const dir = path.dirname(savePath);
      await fs.mkdir(dir, { recursive: true });
      await page.screenshot({ path: savePath, fullPage: false });
      return { ok: true, savedPath: savePath };
    }
    const buf = await page.screenshot({ encoding: "base64", fullPage: false });
    return { ok: true, base64: buf as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserReadDom(
  sessionId: string,
  options: { selector?: string; attribute?: string; mode?: "text" | "html" | "outerHTML" | "value" | "attrs" } = {},
): Promise<{ ok: boolean; content?: string; elements?: unknown[]; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };

  const { selector, attribute, mode = "text" } = options;
  const maxRetries = 3;
  const hasContains = selector ? /:contains\(/i.test(selector) : false;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (!selector) {
        const result = await page.evaluate((m: string) => {
          if (m === "html") return document.documentElement.innerHTML.substring(0, 15000);
          if (document.body) return document.body.innerText.substring(0, 10000);
          return document.documentElement.textContent?.substring(0, 10000) || "";
        }, mode);
        return { ok: true, content: result };
      }

      if (hasContains) {
        const elements = await page.evaluate((sel: string, m: string) => {
          function queryContains(expr: string): Element[] {
            const parts = expr.split(",").map((s) => s.trim());
            const results: Element[] = [];
            for (const part of parts) {
              const match = part.match(/^(.+?):contains\(["']?(.+?)["']?\)$/i);
              if (match) {
                const [, cssBase, text] = match;
                const candidates = document.querySelectorAll(cssBase.trim() || "*");
                for (const el of candidates) {
                  if (el.textContent && el.textContent.includes(text)) results.push(el);
                }
              } else {
                try { document.querySelectorAll(part).forEach((el) => results.push(el)); } catch {}
              }
            }
            const unique: Element[] = [];
            for (const el of results) { if (!unique.includes(el)) unique.push(el); }
            return unique;
          }
          const els = queryContains(sel);
          if (m === "attrs") {
            return { isAttrs: true, elements: els.slice(0, 50).map((el) => ({
              tag: el.tagName.toLowerCase(),
              id: (el as HTMLElement).id || undefined,
              class: (el as HTMLElement).className || undefined,
              text: el.textContent?.trim().substring(0, 200) || "",
              type: el.getAttribute("type") || undefined,
              name: el.getAttribute("name") || undefined,
              href: el.getAttribute("href") || undefined,
              value: (el as HTMLInputElement).value || undefined,
              rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            })) };
          }
          const el = els[0];
          if (!el) return { isAttrs: false, content: "" };
          switch (m) {
            case "html": return { isAttrs: false, content: el.innerHTML.substring(0, 15000) };
            case "outerHTML": return { isAttrs: false, content: (el as HTMLElement).outerHTML.substring(0, 15000) };
            case "value": return { isAttrs: false, content: (el as HTMLInputElement).value || "" };
            default: return { isAttrs: false, content: el.textContent?.trim().substring(0, 10000) || "" };
          }
        }, selector, mode) as { isAttrs: boolean; elements?: unknown[]; content?: string };

        if (elements.isAttrs) return { ok: true, elements: elements.elements };
        return { ok: true, content: elements.content || "" };
      }

      if (mode === "attrs") {
        const elements = await page.$$eval(selector, (els) =>
          els.slice(0, 50).map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            class: el.className || undefined,
            text: el.textContent?.trim().substring(0, 200) || "",
            type: el.getAttribute("type") || undefined,
            name: el.getAttribute("name") || undefined,
            href: el.getAttribute("href") || undefined,
            value: (el as HTMLInputElement).value || undefined,
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          }))
        );
        return { ok: true, elements };
      }

      if (attribute) {
        const val = await page.$eval(selector, (el, attr) => el.getAttribute(attr), attribute);
        return { ok: true, content: val || "" };
      }

      const content = await page.$eval(selector, (el, m) => {
        switch (m) {
          case "html": return el.innerHTML.substring(0, 15000);
          case "outerHTML": return el.outerHTML.substring(0, 15000);
          case "value": return (el as HTMLInputElement).value || "";
          default: return el.textContent?.trim().substring(0, 10000) || "";
        }
      }, mode);
      return { ok: true, content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isContextDestroyed = msg.includes("Execution context was destroyed")
        || msg.includes("navigat")
        || msg.includes("detached")
        || msg.includes("Target closed")
        || msg.includes("Protocol error");

      if (isContextDestroyed && attempt < maxRetries - 1) {
        const waitMs = 1500 * (attempt + 1);
        await new Promise(r => setTimeout(r, waitMs));
        if (page.isClosed()) {
          sessionPages.delete(sessionId);
          return { ok: false, error: "页面在导航后已关闭" };
        }
        try { await page.waitForNavigation({ timeout: 3000, waitUntil: "domcontentloaded" }).catch(() => {}); } catch { /* ignore */ }
        continue;
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "多次重试后仍无法读取页面内容" };
}

export async function browserScript(
  sessionId: string,
  script: string,
  options: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };

  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const prevTimeout = page.getDefaultTimeout();
      if (options.timeoutMs) page.setDefaultTimeout(options.timeoutMs);
      try {
        const wrapped = `(async () => { ${script} })()`;
        const result = await page.evaluate(wrapped);
        return { ok: true, result };
      } finally {
        if (options.timeoutMs) page.setDefaultTimeout(prevTimeout);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isContextDestroyed = msg.includes("Execution context was destroyed")
        || msg.includes("navigat")
        || msg.includes("detached");

      if (isContextDestroyed && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
        if (page.isClosed()) {
          sessionPages.delete(sessionId);
          return { ok: false, error: "页面在导航后已关闭" };
        }
        try { await page.waitForNavigation({ timeout: 3000, waitUntil: "domcontentloaded" }).catch(() => {}); } catch { /* ignore */ }
        continue;
      }
      return { ok: false, error: msg };
    }
  }
  return { ok: false, error: "脚本执行失败: 页面上下文多次被销毁" };
}

export async function browserScroll(
  sessionId: string,
  direction: "up" | "down" | "top" | "bottom",
  amount?: number,
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    await page.evaluate((dir: string, amt: number) => {
      switch (dir) {
        case "top": window.scrollTo(0, 0); break;
        case "bottom": window.scrollTo(0, document.body.scrollHeight); break;
        case "down": window.scrollBy(0, amt); break;
        case "up": window.scrollBy(0, -amt); break;
      }
    }, direction, amount || 600);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserWait(
  sessionId: string,
  options: { selector?: string; ms?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: options.ms || 10000, visible: true });
    } else {
      const ms = options.ms || 1000;
      await new Promise(r => setTimeout(r, ms));
    }
    return { ok: true };
  } catch (err) {
    if (String(err).includes("Execution context was destroyed") || String(err).includes("navigat")) {
      const ms = options.ms || 1000;
      await new Promise(r => setTimeout(r, ms));
      return { ok: true };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserPressKey(
  sessionId: string,
  key: string,
  options: { count?: number; delay?: number } = {},
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    const count = options.count || 1;
    const delay = options.delay || 100;
    for (let i = 0; i < count; i++) {
      await page.keyboard.press(key as Parameters<typeof page.keyboard.press>[0]);
      if (i < count - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserGetConsoleErrors(
  sessionId: string,
): Promise<{ ok: boolean; errors: string[]; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, errors: [], error: "会话不存在或已关闭且无法自动恢复" };
  try {
    const puppeteerErrors = sessionErrors.get(sessionId) || [];

    let pageErrors: string[] = [];
    try {
      pageErrors = await page.evaluate(() => {
        return (window as unknown as { __capturedErrors?: string[] }).__capturedErrors || [];
      }) as string[];
    } catch { /* page context may be broken */ }

    const allErrors = [...new Set([...puppeteerErrors, ...pageErrors])];
    return { ok: true, errors: allErrors };
  } catch (err) {
    return { ok: false, errors: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserInjectErrorCapture(
  sessionId: string,
): Promise<{ ok: boolean; error?: string }> {
  const page = await getOrRecoverPage(sessionId);
  if (!page) return { ok: false, error: "会话不存在或已关闭且无法自动恢复" };
  try {
    await page.evaluate(() => {
      const w = window as unknown as { __capturedErrors: string[] };
      w.__capturedErrors = [];
      window.onerror = (msg, src, line, col, err) => {
        w.__capturedErrors.push(`${msg} (${src}:${line}:${col})`);
      };
      window.addEventListener("unhandledrejection", (e) => {
        w.__capturedErrors.push(`Unhandled Promise: ${e.reason}`);
      });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function browserClose(sessionId: string): Promise<{ ok: boolean }> {
  const page = sessionPages.get(sessionId);
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  sessionPages.delete(sessionId);
  sessionErrors.delete(sessionId);
  sessionMeta.delete(sessionId);
  return { ok: true };
}

export function getSessionPage(sessionId: string): Page | undefined {
  const page = sessionPages.get(sessionId);
  if (!page) return undefined;
  if (page.isClosed()) {
    sessionPages.delete(sessionId);
    sessionErrors.delete(sessionId);
    return undefined;
  }
  return page;
}

export { getOrRecoverPage };

export function getSessionStatus(sessionId: string): { exists: boolean; closed: boolean; url?: string; allSessions: string[] } {
  const page = sessionPages.get(sessionId);
  const allSessions = Array.from(sessionPages.keys());
  if (!page) return { exists: false, closed: false, allSessions };
  if (page.isClosed()) return { exists: true, closed: true, allSessions };
  return { exists: true, closed: false, url: page.url(), allSessions };
}

// ---------- Legacy API for browse_webpage / scrape_site ----------

export async function renderPage(url: string, timeoutMs = 30000): Promise<string | null> {
  let page: Page | undefined;
  try {
    const browser = await getHeadlessBrowser();
    page = await browser.newPage();
    await applyStealthToPage(page);
    await page.setViewport({ width: 1920, height: 1080 });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      await page.waitForFunction(
        () => document.body && document.body.innerText.trim().length > 100,
        { timeout: 8000 },
      );
    } catch { /* content may be short */ }

    return await page.content();
  } catch {
    if (page) {
      try {
        const html = await page.content();
        if (html && html.length > 500) return html;
      } catch { /* ignore */ }
    }
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}
