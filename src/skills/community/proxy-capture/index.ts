import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

interface ProxiedRequest {
  index: number;
  method: string;
  url: string;
  host: string;
  path: string;
  isSSL: boolean;
  headers: Record<string, string>;
  requestBody?: string;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseSize?: number;
  timestamp: number;
}

let proxyServer: unknown = null;
let proxyPort = 0;
const capturedRequests: ProxiedRequest[] = [];
let captureActive = false;
let captureFilter: { urlPattern?: string; methodFilter?: string; hostFilter?: string } = {};
let requestCounter = 0;

export const proxyCaptureSkill: SkillDefinition = {
  name: "proxy_capture",
  displayName: "代理抓包",
  description:
    "通过本地MITM代理服务器抓取HTTP/HTTPS流量。自动生成CA证书解密HTTPS。适用于CDP抓包无法覆盖的场景：非浏览器请求、移动端APP抓包、系统级流量捕获。用户说'代理抓包'、'MITM'、'HTTPS解密'、'APP抓包'、'全局代理'时使用。",
  icon: "Shield",
  category: "dev",
  parameters: z.object({
    action: z.enum(["start", "stop", "list", "detail", "export", "clear", "status", "cert"])
      .describe("操作: start=启动代理, stop=停止, list=列出请求, detail=查看详情, export=导出, clear=清空, status=查看状态, cert=获取CA证书路径"),
    port: z.number().optional().describe("start: 代理端口，默认8899"),
    urlPattern: z.string().optional().describe("URL过滤(包含匹配)"),
    methodFilter: z.string().optional().describe("方法过滤: GET/POST/PUT/DELETE"),
    hostFilter: z.string().optional().describe("主机名过滤"),
    requestIndex: z.number().optional().describe("detail: 请求序号"),
    exportPath: z.string().optional().describe("export: 导出路径"),
    maxBodySize: z.number().optional().describe("响应体最大捕获字节数，默认65536(64KB)"),
    captureBody: z.boolean().optional().describe("是否捕获请求/响应体，默认true"),
  }),
  execute: async (params) => {
    const {
      action, port = 8899,
      urlPattern, methodFilter, hostFilter,
      requestIndex, exportPath,
      maxBodySize = 65536, captureBody = true,
    } = params as {
      action: string; port?: number;
      urlPattern?: string; methodFilter?: string; hostFilter?: string;
      requestIndex?: number; exportPath?: string;
      maxBodySize?: number; captureBody?: boolean;
    };

    try {
      switch (action) {
        case "start": {
          if (proxyServer) return { success: false, message: `代理已在运行，端口: ${proxyPort}\n使用 stop 先关闭` };

          const mitmModule = await import("http-mitm-proxy");
          const Proxy = mitmModule.Proxy || mitmModule.default?.Proxy;
          if (!Proxy) return { success: false, message: "http-mitm-proxy 模块加载失败" };

          const proxy = new Proxy();
          capturedRequests.length = 0;
          requestCounter = 0;
          captureActive = true;
          captureFilter = { urlPattern, methodFilter, hostFilter };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proxy.onError((_ctx: any, err: any) => {
            if (err?.message?.includes("ECONNRESET") || err?.message?.includes("EPIPE")) return;
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          proxy.onRequest((ctx: any, callback: () => void) => {
            if (!captureActive) return callback();

            const clientReq = ctx.clientToProxyRequest as Record<string, unknown>;
            const method = (clientReq.method as string) || "GET";
            const host = ((clientReq.headers as Record<string, string>)?.host) || "";
            const urlPath = (clientReq.url as string) || "/";
            const isSSL = Boolean(ctx.isSSL);
            const fullUrl = `${isSSL ? "https" : "http"}://${host}${urlPath}`;

            if (methodFilter && method.toUpperCase() !== methodFilter.toUpperCase()) return callback();
            if (hostFilter && !host.includes(hostFilter)) return callback();
            if (urlPattern && !fullUrl.includes(urlPattern)) return callback();

            const entry: ProxiedRequest = {
              index: requestCounter++,
              method,
              url: fullUrl,
              host,
              path: urlPath,
              isSSL,
              headers: (clientReq.headers as Record<string, string>) || {},
              timestamp: Date.now(),
            };

            if (captureBody) {
              const reqChunks: Buffer[] = [];
              if (typeof ctx.onRequestData === "function") {
                ctx.onRequestData((_c: unknown, chunk: Buffer, cb: (err: null, chunk: Buffer) => void) => {
                  reqChunks.push(chunk);
                  cb(null, chunk);
                });
                ctx.onRequestEnd((_c: unknown, cb: () => void) => {
                  if (reqChunks.length > 0) {
                    entry.requestBody = Buffer.concat(reqChunks).toString("utf-8").slice(0, maxBodySize);
                  }
                  cb();
                });
              }

              const gunzip = (Proxy as unknown as Record<string, unknown>).gunzip;
              if (typeof ctx.use === "function" && gunzip) {
                ctx.use(gunzip);
              }

              const respChunks: Buffer[] = [];
              if (typeof ctx.onResponseData === "function") {
                ctx.onResponseData((_c: unknown, chunk: Buffer, cb: (err: null, chunk: Buffer) => void) => {
                  respChunks.push(chunk);
                  cb(null, chunk);
                });
              }
              if (typeof ctx.onResponseEnd === "function") {
                ctx.onResponseEnd((_c: unknown, cb: () => void) => {
                  const serverResp = ctx.serverToProxyResponse as Record<string, unknown> | undefined;
                  if (serverResp) {
                    entry.responseStatus = (serverResp.statusCode as number) || 0;
                    entry.responseHeaders = (serverResp.headers as Record<string, string>) || {};
                  }
                  if (respChunks.length > 0) {
                    const body = Buffer.concat(respChunks).toString("utf-8");
                    entry.responseBody = body.slice(0, maxBodySize);
                    entry.responseSize = body.length;
                  }
                  capturedRequests.push(entry);
                  cb();
                });
              } else {
                capturedRequests.push(entry);
              }
            } else {
              capturedRequests.push(entry);
            }

            return callback();
          });

          await new Promise<void>((resolve, reject) => {
            try {
              proxy.listen({ port, sslCaDir: path.join(process.cwd(), ".mitm-certs") }, () => resolve());
              setTimeout(() => resolve(), 3000);
            } catch (e) { reject(e); }
          });

          proxyServer = proxy;
          proxyPort = port;

          const certDir = path.join(process.cwd(), ".mitm-certs", "certs");
          const caCertPath = path.join(certDir, "ca.pem");

          let msg = `MITM代理已启动\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `代理地址: 127.0.0.1:${port}\n`;
          msg += `协议: HTTP + HTTPS (自动SSL解密)\n`;
          msg += `过滤: ${[methodFilter && `方法=${methodFilter}`, urlPattern && `URL含"${urlPattern}"`, hostFilter && `主机含"${hostFilter}"`].filter(Boolean).join(", ") || "无(全部捕获)"}\n\n`;
          msg += `配置方法:\n`;
          msg += `  浏览器: 设置代理为 127.0.0.1:${port}\n`;
          msg += `  系统: 控制面板→网络→代理→手动→127.0.0.1:${port}\n`;
          msg += `  curl: curl -x 127.0.0.1:${port} https://example.com\n\n`;
          msg += `HTTPS证书:\n`;
          msg += `  CA证书: ${caCertPath}\n`;
          msg += `  首次使用需安装此CA到系统信任证书\n`;
          msg += `  Windows: certutil -addstore root "${caCertPath}"\n`;
          msg += `  或双击ca.pem→安装→受信任的根证书颁发机构`;

          return { success: true, message: msg, data: { port, certPath: caCertPath } };
        }

        case "stop": {
          if (!proxyServer) return { success: true, message: "没有正在运行的代理" };

          try {
            if (typeof (proxyServer as Record<string, unknown>).close === "function") {
              (proxyServer as Record<string, Function>).close();
            }
          } catch { /* already stopped */ }

          const count = capturedRequests.length;
          proxyServer = null;
          proxyPort = 0;
          captureActive = false;

          return {
            success: true,
            message: `代理已停止\n总计捕获: ${count} 个请求\n用 list 查看，export 导出`,
            data: { capturedCount: count },
          };
        }

        case "status": {
          const running = proxyServer !== null;
          let msg = `代理状态: ${running ? "运行中" : "已停止"}\n`;
          if (running) msg += `端口: ${proxyPort}\n`;
          msg += `已捕获: ${capturedRequests.length} 个请求\n`;
          if (captureFilter.urlPattern) msg += `URL过滤: ${captureFilter.urlPattern}\n`;
          if (captureFilter.methodFilter) msg += `方法过滤: ${captureFilter.methodFilter}\n`;
          if (captureFilter.hostFilter) msg += `主机过滤: ${captureFilter.hostFilter}\n`;

          return { success: true, message: msg, data: { running, port: proxyPort, count: capturedRequests.length } };
        }

        case "cert": {
          const certPath = path.join(process.cwd(), ".mitm-certs", "certs", "ca.pem");
          try {
            await fs.access(certPath);
            const stat = await fs.stat(certPath);
            return {
              success: true,
              message: `CA证书路径: ${certPath}\n大小: ${stat.size}B\n创建时间: ${stat.birthtime.toLocaleString()}\n\n安装到系统:\n  certutil -addstore root "${certPath}"\n\n安装到浏览器:\n  Chrome → 设置 → 隐私 → 安全 → 管理证书 → 受信任的根 → 导入`,
              data: { certPath },
            };
          } catch {
            return { success: false, message: `CA证书尚未生成。请先 start 启动代理（首次启动会自动生成证书）。` };
          }
        }

        case "list": {
          if (capturedRequests.length === 0) return { success: true, message: "暂无捕获的请求。配置好代理后在浏览器中操作。" };

          let filtered = [...capturedRequests];
          if (urlPattern) filtered = filtered.filter((r) => r.url.includes(urlPattern));
          if (methodFilter) filtered = filtered.filter((r) => r.method.toUpperCase() === methodFilter.toUpperCase());
          if (hostFilter) filtered = filtered.filter((r) => r.host.includes(hostFilter));

          let msg = `代理捕获的请求 (${filtered.length}/${capturedRequests.length})\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const r of filtered.slice(0, 60)) {
            const ssl = r.isSSL ? "🔒" : "  ";
            const status = r.responseStatus ? `[${r.responseStatus}]` : "[?]";
            const size = r.responseSize ? `${(r.responseSize / 1024).toFixed(1)}K` : "";
            msg += `#${r.index} ${ssl} ${status} ${r.method} ${r.url.slice(0, 120)} ${size}\n`;
            if (r.requestBody) msg += `   BODY: ${r.requestBody.slice(0, 150)}\n`;
          }
          if (filtered.length > 60) msg += `\n... 还有 ${filtered.length - 60} 个\n`;
          msg += `\ndetail+requestIndex 查看详情 | export 导出`;

          return { success: true, message: msg, data: { total: capturedRequests.length, filtered: filtered.length } };
        }

        case "detail": {
          if (requestIndex === undefined) return { success: false, message: "需要提供 requestIndex" };
          const req = capturedRequests.find((r) => r.index === requestIndex);
          if (!req) return { success: false, message: `请求 #${requestIndex} 不存在` };

          let msg = `代理请求详情 #${req.index}\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `${req.method} ${req.url}\nSSL: ${req.isSSL ? "是" : "否"}\n时间: ${new Date(req.timestamp).toLocaleString()}\n\n`;

          msg += `【请求头】\n`;
          for (const [k, v] of Object.entries(req.headers)) { msg += `  ${k}: ${v}\n`; }

          if (req.requestBody) {
            msg += `\n【请求体】\n${req.requestBody.slice(0, 3000)}\n`;
            try {
              const parsed = JSON.parse(req.requestBody);
              msg += `\n【请求体JSON】\n${JSON.stringify(parsed, null, 2).slice(0, 2000)}\n`;
            } catch { /* not json */ }
          }

          if (req.responseStatus) {
            msg += `\n【响应状态】 ${req.responseStatus}\n`;
            if (req.responseHeaders) {
              msg += `【响应头】\n`;
              for (const [k, v] of Object.entries(req.responseHeaders)) { msg += `  ${k}: ${v}\n`; }
            }
            if (req.responseBody) {
              let bodyDisplay = req.responseBody;
              try { bodyDisplay = JSON.stringify(JSON.parse(bodyDisplay), null, 2); } catch { /* ok */ }
              msg += `\n【响应体】 (${req.responseSize || 0}B)\n${bodyDisplay.slice(0, 8000)}\n`;
            }
          }

          return { success: true, message: msg, data: { request: req } };
        }

        case "export": {
          if (capturedRequests.length === 0) return { success: false, message: "没有可导出的请求" };
          const outPath = path.resolve(exportPath || `C:/Users/Administrator/Desktop/proxy_capture_${Date.now()}.json`);
          await fs.mkdir(path.dirname(outPath), { recursive: true });

          let filtered = [...capturedRequests];
          if (urlPattern) filtered = filtered.filter((r) => r.url.includes(urlPattern));
          if (methodFilter) filtered = filtered.filter((r) => r.method.toUpperCase() === methodFilter.toUpperCase());

          await fs.writeFile(outPath, JSON.stringify(filtered, null, 2), "utf-8");
          return { success: true, message: `已导出 ${filtered.length} 个请求到: ${outPath}`, data: { path: outPath, count: filtered.length } };
        }

        case "clear": {
          capturedRequests.length = 0;
          requestCounter = 0;
          return { success: true, message: "代理抓包记录已清空" };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `代理抓包异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
