import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

export const apiReplaySkill: SkillDefinition = {
  name: "api_replay",
  displayName: "接口重放测试",
  description:
    "重放/重构API请求：根据抓包结果构造HTTP请求并发送，支持修改参数/请求头/Cookie后重放，支持批量参数爆破、响应对比。配合network_capture抓包使用。用户说'重放请求'、'API测试'、'接口调试'、'修改参数重发'时使用。",
  icon: "Zap",
  category: "dev",
  parameters: z.object({
    action: z.enum(["replay", "build", "batch", "compare"])
      .describe("操作: replay=重放请求, build=构建cURL命令, batch=批量参数测试, compare=对比两次响应"),
    url: z.string().describe("请求URL"),
    method: z.string().optional().describe("HTTP方法，默认GET"),
    headers: z.record(z.string(), z.string()).optional().describe("请求头(键值对)"),
    body: z.string().optional().describe("请求体(POST/PUT)"),
    contentType: z.string().optional().describe("Content-Type，默认application/json"),
    cookie: z.string().optional().describe("Cookie字符串"),
    timeout: z.number().optional().describe("超时毫秒数，默认15000"),
    batchParam: z.string().optional().describe("batch: 要批量测试的参数名"),
    batchValues: z.array(z.string()).optional().describe("batch: 参数值列表"),
    compareBody: z.string().optional().describe("compare: 第二次请求的body"),
    savePath: z.string().optional().describe("保存响应到文件"),
    followRedirect: z.boolean().optional().describe("是否跟随重定向，默认true"),
  }),
  execute: async (params) => {
    const {
      action, url, method = "GET",
      headers: inputHeaders = {}, body,
      contentType = "application/json",
      cookie, timeout = 15000,
      batchParam, batchValues,
      compareBody, savePath, followRedirect = true,
    } = params as {
      action: string; url: string; method?: string;
      headers?: Record<string, string>; body?: string;
      contentType?: string; cookie?: string; timeout?: number;
      batchParam?: string; batchValues?: string[];
      compareBody?: string; savePath?: string; followRedirect?: boolean;
    };

    async function doRequest(reqUrl: string, reqBody?: string, extraHeaders?: Record<string, string>): Promise<{
      status: number; statusText: string; headers: Record<string, string>;
      body: string; elapsed: number; redirected: boolean; finalUrl: string;
    }> {
      const hdrs: Record<string, string> = { ...inputHeaders, ...extraHeaders };
      if (reqBody && !hdrs["Content-Type"] && !hdrs["content-type"]) hdrs["Content-Type"] = contentType;
      if (cookie && !hdrs["Cookie"] && !hdrs["cookie"]) hdrs["Cookie"] = cookie;

      const start = Date.now();
      const resp = await fetch(reqUrl, {
        method: method.toUpperCase(),
        headers: hdrs,
        body: reqBody || undefined,
        redirect: followRedirect ? "follow" : "manual",
        signal: AbortSignal.timeout(timeout),
      });

      const elapsed = Date.now() - start;
      const respBody = await resp.text();
      const respHeaders: Record<string, string> = {};
      resp.headers.forEach((v, k) => { respHeaders[k] = v; });

      return {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
        body: respBody,
        elapsed,
        redirected: resp.redirected,
        finalUrl: resp.url,
      };
    }

    try {
      switch (action) {
        case "replay": {
          const r = await doRequest(url, body);

          let msg = `请求重放结果\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `${method.toUpperCase()} ${url}\n`;
          msg += `状态: ${r.status} ${r.statusText} (${r.elapsed}ms)\n`;
          if (r.redirected) msg += `重定向至: ${r.finalUrl}\n`;
          msg += `\n响应头:\n`;
          for (const [k, v] of Object.entries(r.headers)) {
            msg += `  ${k}: ${v}\n`;
          }
          msg += `\n响应体 (${r.body.length}B):\n`;

          let bodyPreview = r.body.slice(0, 5000);
          try {
            const json = JSON.parse(r.body);
            bodyPreview = JSON.stringify(json, null, 2).slice(0, 5000);
          } catch { /* not json */ }
          msg += bodyPreview;

          if (savePath) {
            const outPath = path.resolve(savePath);
            await fs.mkdir(path.dirname(outPath), { recursive: true });
            await fs.writeFile(outPath, r.body, "utf-8");
            msg += `\n\n响应已保存到: ${outPath}`;
          }

          return { success: true, message: msg, data: { status: r.status, elapsed: r.elapsed, bodySize: r.body.length } };
        }

        case "build": {
          let curl = `curl -X ${method.toUpperCase()} '${url}'`;
          for (const [k, v] of Object.entries(inputHeaders)) {
            curl += ` \\\n  -H '${k}: ${v}'`;
          }
          if (cookie) curl += ` \\\n  -H 'Cookie: ${cookie}'`;
          if (body) {
            curl += ` \\\n  -H 'Content-Type: ${contentType}'`;
            curl += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
          }

          let msg = `cURL命令:\n━━━━━━━━━━━━━━━━━━━━\n${curl}\n`;
          msg += `\n可直接复制到终端执行`;

          return { success: true, message: msg, data: { curl } };
        }

        case "batch": {
          if (!batchParam || !batchValues || batchValues.length === 0) {
            return { success: false, message: "batch操作需要 batchParam 和 batchValues 参数" };
          }

          const results: Array<{ value: string; status: number; bodySize: number; elapsed: number; preview: string }> = [];

          for (const val of batchValues.slice(0, 50)) {
            let reqUrl = url;
            let reqBody = body;

            if (method.toUpperCase() === "GET") {
              const u = new URL(reqUrl);
              u.searchParams.set(batchParam, val);
              reqUrl = u.toString();
            } else if (reqBody) {
              try {
                const parsed = JSON.parse(reqBody);
                parsed[batchParam] = val;
                reqBody = JSON.stringify(parsed);
              } catch {
                const escapedParam = batchParam.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const escapedVal = JSON.stringify(val).slice(1, -1);
                reqBody = reqBody.replace(new RegExp(`"${escapedParam}"\\s*:\\s*"[^"]*"`), `"${batchParam}":"${escapedVal}"`);
              }
            }

            try {
              const r = await doRequest(reqUrl, reqBody);
              results.push({
                value: val,
                status: r.status,
                bodySize: r.body.length,
                elapsed: r.elapsed,
                preview: r.body.slice(0, 200),
              });
            } catch (e) {
              results.push({
                value: val,
                status: 0,
                bodySize: 0,
                elapsed: 0,
                preview: `Error: ${e instanceof Error ? e.message : String(e)}`,
              });
            }
          }

          let msg = `批量测试结果 (参数: ${batchParam}, ${results.length}组)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const r of results) {
            msg += `${batchParam}="${r.value}" → [${r.status}] ${r.bodySize}B ${r.elapsed}ms\n  ${r.preview.slice(0, 100)}\n`;
          }

          return { success: true, message: msg, data: { param: batchParam, results } };
        }

        case "compare": {
          const r1 = await doRequest(url, body);
          const r2 = await doRequest(url, compareBody || body);

          let msg = `响应对比\n━━━━━━━━━━━━━━━━━━━━\n`;
          msg += `请求1: body=${(body || "").slice(0, 100)} → [${r1.status}] ${r1.body.length}B ${r1.elapsed}ms\n`;
          msg += `请求2: body=${(compareBody || body || "").slice(0, 100)} → [${r2.status}] ${r2.body.length}B ${r2.elapsed}ms\n\n`;

          if (r1.status !== r2.status) msg += `状态码不同: ${r1.status} vs ${r2.status}\n`;
          if (r1.body.length !== r2.body.length) msg += `响应大小不同: ${r1.body.length}B vs ${r2.body.length}B\n`;
          if (r1.body === r2.body) {
            msg += `响应体完全相同\n`;
          } else {
            const lines1 = r1.body.split("\n");
            const lines2 = r2.body.split("\n");
            let diffCount = 0;
            const maxLen = Math.max(lines1.length, lines2.length);
            const diffs: string[] = [];
            for (let i = 0; i < Math.min(maxLen, 100); i++) {
              if (lines1[i] !== lines2[i]) {
                diffCount++;
                if (diffs.length < 10) {
                  diffs.push(`行${i + 1}:\n  1: ${(lines1[i] || "").slice(0, 200)}\n  2: ${(lines2[i] || "").slice(0, 200)}`);
                }
              }
            }
            msg += `差异行数: ${diffCount}\n\n`;
            msg += diffs.join("\n\n");
          }

          return { success: true, message: msg, data: { status1: r1.status, status2: r2.status, bodyMatch: r1.body === r2.body } };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `API重放异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
