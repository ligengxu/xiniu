import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";
import { getSessionPage, getSessionStatus, getOrRecoverPage } from "@/lib/puppeteer-render";

export const pageMonitorSkill: SkillDefinition = {
  name: "page_monitor",
  displayName: "页面深度监控",
  description:
    "深度监控浏览器页面：拦截所有JS事件监听器、监控DOM变化(MutationObserver)、追踪localStorage/sessionStorage读写、劫持WebSocket消息、记录console输出、检测反调试机制。必须先用browser_open打开页面。用户说'监控页面'、'事件监听'、'存储监控'、'WebSocket抓包'、'反调试'时使用。",
  icon: "Activity",
  category: "dev",
  parameters: z.object({
    action: z.enum(["start_all", "event_listeners", "dom_mutations", "storage_monitor", "ws_monitor", "console_log", "anti_debug", "performance", "get_logs"])
      .describe("操作: start_all=启动全监控, event_listeners=列出事件监听器, dom_mutations=监控DOM变化, storage_monitor=监控存储读写, ws_monitor=监控WebSocket, console_log=捕获console输出, anti_debug=检测/绕过反调试, performance=性能分析, get_logs=获取监控日志"),
    sessionId: z.string().optional().describe("浏览器会话ID，默认'main'"),
    selector: z.string().optional().describe("event_listeners: 目标元素选择器，默认'*'查全部"),
    logType: z.string().optional().describe("get_logs: 日志类型(events/mutations/storage/ws/console)"),
    maxLogs: z.number().optional().describe("最大日志条数，默认100"),
    savePath: z.string().optional().describe("保存日志到文件"),
  }),
  execute: async (params) => {
    const {
      action, sessionId = "main",
      selector, logType, maxLogs = 100, savePath,
    } = params as {
      action: string; sessionId?: string;
      selector?: string; logType?: string; maxLogs?: number; savePath?: string;
    };

    try {
      const page = await getOrRecoverPage(sessionId);
      if (!page) {
        const status = getSessionStatus(sessionId);
        let hint = `浏览器会话"${sessionId}"不存在且无法自动恢复`;
        if (status.allSessions.length > 0) hint += `，当前活跃会话: [${status.allSessions.join(", ")}]`;
        hint += "。请先使用 browser_open 打开页面";
        return { success: false, message: hint };
      }

      switch (action) {
        case "event_listeners": {
          const listeners = await page.evaluate((sel: string) => {
            const results: Array<{ element: string; events: string[] }> = [];
            const elements = document.querySelectorAll(sel || "*");

            elements.forEach((el) => {
              const tagDesc = `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className ? "." + el.className.toString().split(" ")[0] : ""}`;

              const eventAttrs = Array.from(el.attributes)
                .filter((a) => a.name.startsWith("on"))
                .map((a) => a.name);

              // @ts-expect-error getEventListeners
              const devtoolsListeners = window.getEventListeners?.(el);
              const registeredEvents = devtoolsListeners ? Object.keys(devtoolsListeners) : [];

              const allEvents = [...new Set([...eventAttrs, ...registeredEvents])];

              if (allEvents.length > 0) {
                results.push({ element: tagDesc.slice(0, 100), events: allEvents });
              }
            });

            return results.slice(0, 100);
          }, selector || "a,button,input,form,[onclick],[onsubmit],[onchange]");

          let msg = `事件监听器 (${listeners.length}个元素)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const l of listeners) {
            msg += `${l.element}: ${l.events.join(", ")}\n`;
          }

          return { success: true, message: msg, data: { listeners } };
        }

        case "dom_mutations":
        case "storage_monitor":
        case "ws_monitor":
        case "console_log":
        case "start_all": {
          const monitors = action === "start_all"
            ? ["mutations", "storage", "ws", "console"]
            : [action.replace("_monitor", "").replace("dom_", "").replace("console_", "console")];

          await page.evaluate((monitorTypes: string[], max: number) => {
            const w = window as unknown as Record<string, unknown>;
            if (!w.__xiniu_monitor) w.__xiniu_monitor = {};
            const monitor = w.__xiniu_monitor as Record<string, unknown[]>;

            const pushLog = (type: string, entry: unknown) => {
              if (!monitor[type]) monitor[type] = [];
              const arr = monitor[type];
              arr.push(entry);
              if (arr.length > max) arr.shift();
            };

            if (monitorTypes.includes("mutations") && !w.__xiniu_mutation_observer) {
              const target = document.body || document.documentElement;
              if (target) {
                const observer = new MutationObserver((mutations) => {
                  for (const m of mutations) {
                    pushLog("mutations", {
                      time: new Date().toISOString(),
                      type: m.type,
                      target: `${m.target.nodeName}${(m.target as Element).id ? "#" + (m.target as Element).id : ""}`,
                      addedNodes: m.addedNodes.length,
                      removedNodes: m.removedNodes.length,
                      attributeName: m.attributeName,
                      oldValue: m.oldValue?.slice(0, 100),
                    });
                  }
                });
                observer.observe(target, {
                  childList: true, subtree: true, attributes: true, characterData: true,
                });
                w.__xiniu_mutation_observer = observer;
              }
            }

            if (monitorTypes.includes("storage") && !w.__xiniu_storage_hooked) {
              const origSetItem = Storage.prototype.setItem;
              const origGetItem = Storage.prototype.getItem;
              const origRemoveItem = Storage.prototype.removeItem;

              Storage.prototype.setItem = function (key: string, value: string) {
                pushLog("storage", {
                  time: new Date().toISOString(),
                  op: "set",
                  storage: this === localStorage ? "local" : "session",
                  key,
                  value: value.slice(0, 500),
                  stack: new Error().stack?.split("\n").slice(2, 5).map((l) => l.trim()),
                });
                return origSetItem.call(this, key, value);
              };

              Storage.prototype.getItem = function (key: string) {
                const result = origGetItem.call(this, key);
                pushLog("storage", {
                  time: new Date().toISOString(),
                  op: "get",
                  storage: this === localStorage ? "local" : "session",
                  key,
                  value: result?.slice(0, 200),
                });
                return result;
              };

              Storage.prototype.removeItem = function (key: string) {
                pushLog("storage", {
                  time: new Date().toISOString(),
                  op: "remove",
                  storage: this === localStorage ? "local" : "session",
                  key,
                });
                return origRemoveItem.call(this, key);
              };

              w.__xiniu_storage_hooked = true;
            }

            if (monitorTypes.includes("ws") && !w.__xiniu_ws_hooked) {
              const OrigWS = WebSocket;
              (window as unknown as Record<string, unknown>).WebSocket = function (url: string, protocols?: string | string[]) {
                const ws = new OrigWS(url, protocols);

                ws.addEventListener("message", (e) => {
                  pushLog("ws", {
                    time: new Date().toISOString(),
                    dir: "recv",
                    url,
                    data: typeof e.data === "string" ? e.data.slice(0, 1000) : `[Binary ${e.data instanceof Blob ? e.data.size : (e.data as ArrayBuffer).byteLength}B]`,
                  });
                });

                const origSend = ws.send.bind(ws);
                ws.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
                  pushLog("ws", {
                    time: new Date().toISOString(),
                    dir: "send",
                    url,
                    data: typeof data === "string" ? data.slice(0, 1000) : `[Binary]`,
                  });
                  return origSend(data);
                };

                return ws;
              } as unknown as typeof WebSocket;

              w.__xiniu_ws_hooked = true;
            }

            if (monitorTypes.includes("console") && !w.__xiniu_console_hooked) {
              const methods = ["log", "warn", "error", "info", "debug"] as const;
              for (const m of methods) {
                const orig = console[m].bind(console);
                (console as unknown as Record<string, unknown>)[m] = (...args: unknown[]) => {
                  pushLog("console", {
                    time: new Date().toISOString(),
                    level: m,
                    args: args.map((a) => {
                      try { return typeof a === "string" ? a.slice(0, 500) : JSON.stringify(a)?.slice(0, 500); }
                      catch { return String(a).slice(0, 200); }
                    }),
                  });
                  orig(...args);
                };
              }
              w.__xiniu_console_hooked = true;
            }
          }, monitors, maxLogs);

          return {
            success: true,
            message: `监控已启动: ${monitors.join(", ")}\n\n监控内容:\n${monitors.includes("mutations") ? "- DOM变化 (增删节点、属性修改)\n" : ""}${monitors.includes("storage") ? "- localStorage/sessionStorage 读写\n" : ""}${monitors.includes("ws") ? "- WebSocket 发送/接收\n" : ""}${monitors.includes("console") ? "- console 输出\n" : ""}\n在页面上操作后，用 get_logs 查看监控日志。`,
            data: { monitors },
          };
        }

        case "anti_debug": {
          const result = await page.evaluate(() => {
            const checks: Array<{ check: string; detected: boolean; detail: string }> = [];

            try {
              const start = Date.now();
              // eslint-disable-next-line no-debugger
              debugger;
              const elapsed = Date.now() - start;
              checks.push({
                check: "debugger语句检测",
                detected: elapsed > 100,
                detail: elapsed > 100 ? `debugger暂停了${elapsed}ms，页面有反调试` : "未检测到debugger阻断",
              });
            } catch { /* safe */ }

            const hasSetInterval = document.querySelector("script")?.textContent?.includes("setInterval") || false;
            checks.push({
              check: "定时器反调试",
              detected: hasSetInterval,
              detail: hasSetInterval ? "页面可能使用setInterval循环检测DevTools" : "未发现定时器反调试",
            });

            const consoleCheck = /console\.(clear|log|warn|error)\s*\(/;
            const scripts = Array.from(document.querySelectorAll("script")).map((s) => s.textContent || "").join("");
            const hasClearConsole = consoleCheck.test(scripts);
            checks.push({
              check: "console清除",
              detected: hasClearConsole,
              detail: hasClearConsole ? "页面可能清除console输出" : "未发现console清除",
            });

            const hasEval = scripts.includes("eval(") || scripts.includes("Function(");
            checks.push({
              check: "动态代码执行",
              detected: hasEval,
              detail: hasEval ? "页面使用eval()或Function()动态执行代码（可能是混淆/反调试）" : "未发现动态代码执行",
            });

            return checks;
          });

          let msg = `反调试检测\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const c of result) {
            msg += `[${c.detected ? "!" : "OK"}] ${c.check}: ${c.detail}\n`;
          }

          const detected = result.filter((c) => c.detected);
          if (detected.length > 0) {
            msg += `\n建议绕过方式:\n`;
            msg += `1. 使用 browser_script 执行: "for(var i=1;i<10000;i++)clearInterval(i)" 清除所有定时器\n`;
            msg += `2. 使用 hook_function Hook "debugger" 关键路径\n`;
            msg += `3. 使用无头模式(headless=true)打开页面\n`;
          }

          return { success: true, message: msg, data: { checks: result } };
        }

        case "performance": {
          const perf = await page.evaluate(() => {
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

            const byType: Record<string, { count: number; totalSize: number; totalTime: number }> = {};
            for (const r of resources) {
              const ext = r.name.split("?")[0].split(".").pop() || "other";
              const type = { js: "JS", css: "CSS", png: "图片", jpg: "图片", jpeg: "图片", gif: "图片", webp: "图片", svg: "图片", woff: "字体", woff2: "字体", ttf: "字体" }[ext] || "其他";
              if (!byType[type]) byType[type] = { count: 0, totalSize: 0, totalTime: 0 };
              byType[type].count++;
              byType[type].totalSize += r.transferSize || 0;
              byType[type].totalTime += r.duration;
            }

            const slowest = resources
              .sort((a, b) => b.duration - a.duration)
              .slice(0, 5)
              .map((r) => ({ url: r.name.slice(-80), duration: Math.round(r.duration), size: r.transferSize || 0 }));

            return {
              timing: nav ? {
                dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
                tcp: Math.round(nav.connectEnd - nav.connectStart),
                ttfb: Math.round(nav.responseStart - nav.requestStart),
                download: Math.round(nav.responseEnd - nav.responseStart),
                domParse: Math.round(nav.domInteractive - nav.responseEnd),
                domReady: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
                load: Math.round(nav.loadEventEnd - nav.startTime),
              } : null,
              resourceCount: resources.length,
              byType,
              slowest,
            };
          });

          let msg = `页面性能分析\n━━━━━━━━━━━━━━━━━━━━\n`;
          if (perf.timing) {
            msg += `DNS: ${perf.timing.dns}ms | TCP: ${perf.timing.tcp}ms | TTFB: ${perf.timing.ttfb}ms\n`;
            msg += `下载: ${perf.timing.download}ms | DOM解析: ${perf.timing.domParse}ms\n`;
            msg += `DOMReady: ${perf.timing.domReady}ms | Load: ${perf.timing.load}ms\n`;
          }

          msg += `\n资源统计 (${perf.resourceCount}个):\n`;
          for (const [type, info] of Object.entries(perf.byType)) {
            msg += `  ${type}: ${info.count}个 ${(info.totalSize / 1024).toFixed(0)}KB ${Math.round(info.totalTime)}ms\n`;
          }

          if (perf.slowest.length > 0) {
            msg += `\n最慢资源 TOP5:\n`;
            perf.slowest.forEach((r, i) => {
              msg += `  ${i + 1}. ${r.duration}ms ${(r.size / 1024).toFixed(0)}KB ${r.url}\n`;
            });
          }

          return { success: true, message: msg, data: perf };
        }

        case "get_logs": {
          const type = logType || "all";
          const logs = await page.evaluate((t: string) => {
            const monitor = (window as unknown as Record<string, unknown>).__xiniu_monitor as Record<string, unknown[]> | undefined;
            if (!monitor) return null;
            if (t === "all") return monitor;
            return { [t]: monitor[t] || [] };
          }, type);

          if (!logs) return { success: true, message: "暂无监控日志。请先用 start_all 启动监控。" };

          let msg = `监控日志\n━━━━━━━━━━━━━━━━━━━━\n`;
          let totalEntries = 0;
          for (const [key, entries] of Object.entries(logs)) {
            const arr = entries as unknown[];
            msg += `\n[${key}] (${arr.length}条)\n`;
            const recent = arr.slice(-20);
            for (const entry of recent) {
              msg += `  ${JSON.stringify(entry)}\n`;
            }
            totalEntries += arr.length;
          }

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, JSON.stringify(logs, null, 2), "utf-8");
            msg += `\n日志已保存到: ${outPath}`;
          }

          return { success: true, message: msg, data: { totalEntries, types: Object.keys(logs) } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `页面监控异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
