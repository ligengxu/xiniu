import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";
import { getSessionPage, getSessionStatus, getOrRecoverPage } from "@/lib/puppeteer-render";
import type { CDPSession } from "puppeteer";

interface CapturedRequest {
  index: number;
  method: string;
  url: string;
  type: string;
  postData?: string;
  headers: Record<string, string>;
  timestamp: number;
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodySize: number;
    bodyPreview?: string;
    mimeType?: string;
  };
}

interface CaptureSession {
  requests: CapturedRequest[];
  client: CDPSession;
  pendingMap: Map<string, CapturedRequest>;
  active: boolean;
  startTime: number;
}

const captureSessions = new Map<string, CaptureSession>();

async function requirePage(sessionId: string) {
  const page = await getOrRecoverPage(sessionId);
  if (page) return page;
  const status = getSessionStatus(sessionId);
  let hint = `浏览器会话"${sessionId}"不存在且无法自动恢复`;
  if (status.allSessions.length > 0) hint += `，当前活跃会话: [${status.allSessions.join(", ")}]`;
  hint += "。请先使用 browser_open 打开页面";
  throw new Error(hint);
}

export const networkCaptureSkill: SkillDefinition = {
  name: "network_capture",
  displayName: "网络抓包",
  description:
    "拦截浏览器页面的所有网络请求（XHR/Fetch/POST/WebSocket），记录请求头、POST参数、响应内容。支持按method/URL/type过滤，导出JSON，查看请求时序瀑布图，拦截修改请求。必须先用browser_open打开页面。用户说'抓包'、'网络请求'、'POST包'、'XHR'、'接口抓取'时使用。",
  icon: "Wifi",
  category: "dev",
  parameters: z.object({
    action: z.enum(["start", "stop", "list", "detail", "export", "clear", "waterfall", "intercept"])
      .describe("操作: start=开始抓包, stop=停止并断开CDP, list=列出请求, detail=查看详情, export=导出JSON, clear=清空, waterfall=时序瀑布图, intercept=拦截请求修改后放行"),
    sessionId: z.string().optional().describe("浏览器会话ID，默认'main'"),
    filterMethod: z.string().optional().describe("过滤请求方法: GET/POST/PUT/DELETE等"),
    filterUrl: z.string().optional().describe("URL关键词过滤(包含即匹配)"),
    filterType: z.string().optional().describe("资源类型过滤: xhr/fetch/document/script/stylesheet/image/font/media/websocket/other"),
    requestIndex: z.number().optional().describe("detail操作: 要查看的请求序号"),
    captureResponse: z.boolean().optional().describe("是否同时捕获响应体，默认true"),
    exportPath: z.string().optional().describe("export操作: 导出文件路径(.json)"),
    maxBodySize: z.number().optional().describe("响应体最大捕获字节数，默认32768(32KB)"),
    interceptPattern: z.string().optional().describe("intercept: 要拦截的URL正则模式"),
    interceptAction: z.string().optional().describe("intercept: block=阻断请求, modify_header=修改请求头, mock_response=模拟响应"),
    mockStatusCode: z.number().optional().describe("intercept mock_response: 模拟状态码"),
    mockBody: z.string().optional().describe("intercept mock_response: 模拟响应体"),
    modifyHeaders: z.string().optional().describe("intercept modify_header: 要修改的请求头(JSON字符串)"),
  }),
  execute: async (params) => {
    const {
      action, sessionId = "main",
      filterMethod, filterUrl, filterType,
      requestIndex, captureResponse = true,
      exportPath, maxBodySize = 32768,
      interceptPattern, interceptAction,
      mockStatusCode, mockBody, modifyHeaders,
    } = params as {
      action: string; sessionId?: string;
      filterMethod?: string; filterUrl?: string; filterType?: string;
      requestIndex?: number; captureResponse?: boolean;
      exportPath?: string; maxBodySize?: number;
      interceptPattern?: string; interceptAction?: string;
      mockStatusCode?: number; mockBody?: string; modifyHeaders?: string;
    };

    const key = `capture_${sessionId}`;

    try {
      switch (action) {
        // ========== 不需要浏览器会话的操作 ==========
        case "stop": {
          const session = captureSessions.get(key);
          if (!session) return { success: true, message: "没有正在运行的抓包会话" };
          session.active = false;
          try { await session.client.detach(); } catch { /* already gone */ }
          const duration = ((Date.now() - session.startTime) / 1000).toFixed(1);
          const postCount = session.requests.filter((r) => r.method === "POST").length;
          const xhrCount = session.requests.filter((r) => r.type === "xhr" || r.type === "fetch").length;
          return {
            success: true,
            message: `抓包已停止，CDP会话已断开\n总计: ${session.requests.length}个请求 (${duration}s)\nPOST: ${postCount}个 | XHR/Fetch: ${xhrCount}个\n\n用 list 查看详情，用 waterfall 查看时序图`,
            data: { total: session.requests.length, postCount, xhrCount, duration },
          };
        }

        case "list": {
          const session = captureSessions.get(key);
          const requests = session?.requests || [];
          if (requests.length === 0) return { success: true, message: "暂无捕获的请求。请先 start 开始抓包。" };
          let filtered = requests;
          if (filterMethod) filtered = filtered.filter((r) => r.method.toUpperCase() === filterMethod.toUpperCase());
          if (filterUrl) filtered = filtered.filter((r) => r.url.includes(filterUrl));
          if (filterType) filtered = filtered.filter((r) => r.type === filterType);
          let msg = `捕获的请求 (${filtered.length}/${requests.length})`;
          if (!session?.active) msg += ` [抓包已停止]`;
          msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const r of filtered.slice(0, 60)) {
            const statusStr = r.response ? `[${r.response.status}]` : "[pending]";
            const sizeStr = r.response?.bodySize ? ` ${(r.response.bodySize / 1024).toFixed(1)}KB` : "";
            const mime = r.response?.mimeType ? ` (${r.response.mimeType.split(";")[0]})` : "";
            msg += `#${r.index} ${statusStr} ${r.method} ${r.type}${mime}${sizeStr}\n  ${r.url.slice(0, 150)}\n`;
            if (r.postData) msg += `  POST: ${r.postData.slice(0, 200)}\n`;
          }
          if (filtered.length > 60) msg += `\n... 还有 ${filtered.length - 60} 个请求\n`;
          msg += `\n提示: detail+requestIndex 查看详情 | waterfall 查看时序图 | export 导出JSON`;
          return {
            success: true, message: msg,
            data: {
              total: requests.length, filtered: filtered.length,
              requests: filtered.slice(0, 200).map((r) => ({
                index: r.index, method: r.method, url: r.url,
                type: r.type, status: r.response?.status, bodySize: r.response?.bodySize,
              })),
            },
          };
        }

        case "detail": {
          if (requestIndex === undefined) return { success: false, message: "需要提供 requestIndex 参数" };
          const session = captureSessions.get(key);
          const requests = session?.requests || [];
          const req = requests[requestIndex];
          if (!req) return { success: false, message: `请求 #${requestIndex} 不存在 (共${requests.length}个)` };
          let msg = `请求详情 #${req.index}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `方法: ${req.method}\nURL: ${req.url}\n类型: ${req.type}\n时间: ${new Date(req.timestamp).toLocaleString()}\n\n`;
          msg += `【请求头】\n`;
          for (const [k, v] of Object.entries(req.headers)) { msg += `  ${k}: ${v}\n`; }
          if (req.postData) {
            msg += `\n【POST数据 原始】\n${req.postData.slice(0, 3000)}\n`;
            try {
              const parsed = JSON.parse(req.postData);
              msg += `\n【POST数据 JSON格式化】\n${JSON.stringify(parsed, null, 2).slice(0, 3000)}\n`;
            } catch {
              try {
                const urlParams = new URLSearchParams(req.postData);
                const obj: Record<string, string> = {};
                urlParams.forEach((v, k) => { obj[k] = v; });
                if (Object.keys(obj).length > 0) msg += `\n【POST数据 表单解析】\n${JSON.stringify(obj, null, 2).slice(0, 2000)}\n`;
              } catch { /* not form data */ }
            }
          }
          if (req.response) {
            msg += `\n【响应状态】 ${req.response.status} ${req.response.statusText}\n`;
            msg += `【响应类型】 ${req.response.mimeType || "unknown"}\n\n【响应头】\n`;
            for (const [k, v] of Object.entries(req.response.headers)) { msg += `  ${k}: ${v}\n`; }
            if (req.response.bodyPreview) {
              let bodyDisplay = req.response.bodyPreview;
              try { bodyDisplay = JSON.stringify(JSON.parse(bodyDisplay), null, 2); } catch { /* not json */ }
              msg += `\n【响应体】 (${req.response.bodySize}B)\n${bodyDisplay.slice(0, 8000)}\n`;
              if (bodyDisplay.length > 8000) msg += `\n... 截断，使用 export 导出完整数据`;
            }
          }
          msg += `\n\n【快速操作】\n- 用 api_replay replay 此请求\n- 用 api_replay build 生成 cURL 命令`;
          return { success: true, message: msg, data: { request: req } };
        }

        case "waterfall": {
          const session = captureSessions.get(key);
          const requests = session?.requests || [];
          if (requests.length === 0) return { success: true, message: "暂无请求数据" };
          let filtered = requests;
          if (filterMethod) filtered = filtered.filter((r) => r.method.toUpperCase() === filterMethod.toUpperCase());
          if (filterUrl) filtered = filtered.filter((r) => r.url.includes(filterUrl));
          if (filterType) filtered = filtered.filter((r) => r.type === filterType);
          const baseTime = session?.startTime || filtered[0]?.timestamp || 0;
          const barWidth = 50;
          let msg = `请求时序瀑布图 (${filtered.length}个请求)\n${"─".repeat(70)}\n`;
          msg += `${"#".padEnd(5)}${"方法".padEnd(6)}${"状态".padEnd(6)}${"偏移ms".padEnd(10)}${"大小".padEnd(10)}URL\n${"─".repeat(70)}\n`;
          const maxOffset = Math.max(...filtered.map((r) => r.timestamp - baseTime), 1);
          for (const r of filtered.slice(0, 40)) {
            const offset = r.timestamp - baseTime;
            const sizeStr = (r.response?.bodySize || 0) > 1024 ? `${((r.response?.bodySize || 0) / 1024).toFixed(0)}K` : `${r.response?.bodySize || 0}B`;
            const urlShort = r.url.split("?")[0].split("/").slice(-2).join("/").slice(0, 35);
            const barPos = Math.floor((offset / maxOffset) * barWidth);
            msg += `${String(r.index).padEnd(5)}${r.method.padEnd(6)}${String(r.response?.status || 0).padEnd(6)}${String(offset + "ms").padEnd(10)}${sizeStr.padEnd(10)}${urlShort}\n`;
            msg += `     ${" ".repeat(Math.min(barPos, barWidth - 1))}▓\n`;
          }
          if (filtered.length > 40) msg += `\n... 还有 ${filtered.length - 40} 个请求\n`;
          const totalSize = filtered.reduce((s, r) => s + (r.response?.bodySize || 0), 0);
          msg += `\n总计: ${filtered.length}请求 | ${(totalSize / 1024).toFixed(0)}KB | ${maxOffset}ms`;
          return { success: true, message: msg, data: { total: filtered.length, totalSize, totalTime: maxOffset } };
        }

        case "export": {
          const session = captureSessions.get(key);
          const requests = session?.requests || [];
          if (requests.length === 0) return { success: false, message: "没有可导出的请求" };
          const outPath = path.resolve(exportPath || `C:/Users/Administrator/Desktop/network_capture_${Date.now()}.json`);
          await fs.mkdir(path.dirname(outPath), { recursive: true });
          let filtered = requests;
          if (filterMethod) filtered = filtered.filter((r) => r.method.toUpperCase() === filterMethod.toUpperCase());
          if (filterUrl) filtered = filtered.filter((r) => r.url.includes(filterUrl));
          await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), "utf-8");
          return { success: true, message: `已导出 ${filtered.length} 个请求到: ${outPath}`, data: { path: outPath, count: filtered.length } };
        }

        case "clear": {
          const session = captureSessions.get(key);
          if (session) {
            if (session.active) { try { await session.client.detach(); } catch { /* ok */ } }
            captureSessions.delete(key);
          }
          return { success: true, message: "抓包记录已清空，CDP会话已断开" };
        }

        // ========== 需要浏览器会话的操作 ==========
        case "start": {
          const page = await requirePage(sessionId);
          if (captureSessions.has(key)) {
            const old = captureSessions.get(key)!;
            if (old.active) { try { await old.client.detach(); } catch { /* already detached */ } }
          }
          const client = await page.createCDPSession();
          await client.send("Network.enable");
          const session: CaptureSession = { requests: [], client, pendingMap: new Map(), active: true, startTime: Date.now() };
          captureSessions.set(key, session);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client.on("Network.requestWillBeSent", (event: any) => {
            if (!session.active) return;
            const req = event.request || {};
            const type = (event.type || "other").toLowerCase();
            const method = req.method || "GET";
            const url = req.url as string;
            if (filterMethod && method.toUpperCase() !== filterMethod.toUpperCase()) return;
            if (filterUrl && !url.includes(filterUrl)) return;
            if (filterType && type !== filterType) return;
            const entry: CapturedRequest = {
              index: session.requests.length, method, url, type,
              postData: req.postData || undefined, headers: req.headers || {}, timestamp: Date.now(),
            };
            session.requests.push(entry);
            session.pendingMap.set(event.requestId, entry);
          });

          if (captureResponse) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            client.on("Network.responseReceived", async (event: any) => {
              if (!session.active) return;
              const entry = session.pendingMap.get(event.requestId);
              if (!entry) return;
              const resp = event.response || {};
              entry.response = { status: resp.status || 0, statusText: resp.statusText || "", headers: resp.headers || {}, bodySize: 0, mimeType: resp.mimeType || "" };
              try {
                const body = await client.send("Network.getResponseBody", { requestId: event.requestId }) as unknown as Record<string, string>;
                const bodyStr = body.body || "";
                entry.response.bodySize = bodyStr.length;
                entry.response.bodyPreview = bodyStr.slice(0, maxBodySize);
              } catch { /* binary or stream */ }
            });
          }

          return {
            success: true,
            message: `抓包已启动 (会话: ${sessionId})\n过滤: ${[filterMethod && `方法=${filterMethod}`, filterUrl && `URL含"${filterUrl}"`, filterType && `类型=${filterType}`].filter(Boolean).join(", ") || "无(全部捕获)"}\n\n页面上的所有网络请求将被记录。操作完后用 list 查看，用 stop 停止。`,
            data: { sessionId, filters: { filterMethod, filterUrl, filterType } },
          };
        }

        case "intercept": {
          const page = await requirePage(sessionId);
          if (!interceptPattern) return { success: false, message: "需要提供 interceptPattern (URL正则模式)" };
          if (!interceptAction) return { success: false, message: "需要提供 interceptAction: block / modify_header / mock_response" };
          const client = await page.createCDPSession();
          await client.send("Fetch.enable", { patterns: [{ urlPattern: interceptPattern, requestStage: "Request" }] });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client.on("Fetch.requestPaused", async (event: any) => {
            const reqId = event.requestId;
            try {
              if (interceptAction === "block") {
                await client.send("Fetch.failRequest", { requestId: reqId, errorReason: "BlockedByClient" });
              } else if (interceptAction === "mock_response") {
                const body = Buffer.from(mockBody || '{"mocked": true}').toString("base64");
                await client.send("Fetch.fulfillRequest", { requestId: reqId, responseCode: mockStatusCode || 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body });
              } else if (interceptAction === "modify_header") {
                const headers = event.request.headers || {};
                if (modifyHeaders) { try { Object.assign(headers, JSON.parse(modifyHeaders)); } catch { /* invalid json */ } }
                await client.send("Fetch.continueRequest", { requestId: reqId, headers: Object.entries(headers).map(([name, value]) => ({ name, value: String(value) })) });
              } else {
                await client.send("Fetch.continueRequest", { requestId: reqId });
              }
            } catch { try { await client.send("Fetch.continueRequest", { requestId: reqId }); } catch { /* already handled */ } }
          });

          return {
            success: true,
            message: `请求拦截已启动\n模式: ${interceptPattern}\n动作: ${interceptAction}\n${interceptAction === "mock_response" ? `模拟响应: ${mockStatusCode || 200} ${(mockBody || "").slice(0, 100)}` : ""}${interceptAction === "block" ? "匹配的请求将被阻断" : ""}${interceptAction === "modify_header" ? `修改请求头: ${modifyHeaders}` : ""}\n\n刷新或操作页面后，匹配的请求将被拦截处理。`,
            data: { pattern: interceptPattern, action: interceptAction },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `网络抓包异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
