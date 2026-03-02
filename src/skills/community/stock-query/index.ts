import { z } from "zod";
import type { SkillDefinition } from "../types";

interface StockData {
  code: string;
  name: string;
  price: string;
  change: string;
  changePercent: string;
  open: string;
  high: string;
  low: string;
  volume: string;
  amount: string;
  time: string;
}

function normalizeCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith("6")) return `sh${code}`;
    return `sz${code}`;
  }
  if (/^(SH|SZ|BJ)\d{6}$/i.test(code)) return code.toLowerCase();
  if (/^[A-Z]{1,5}$/.test(code)) return `us_${code}`;
  return code;
}

async function fetchSinaQuote(code: string): Promise<StockData | null> {
  try {
    const resp = await fetch(`https://hq.sinajs.cn/list=${code}`, {
      headers: { Referer: "https://finance.sina.com.cn", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();
    const match = text.match(/="(.+)"/);
    if (!match || !match[1]) return null;

    const parts = match[1].split(",");
    if (parts.length < 20) return null;

    const prevClose = parseFloat(parts[2]);
    const curPrice = parseFloat(parts[3]);
    const changeVal = (curPrice - prevClose).toFixed(2);
    const changePct = prevClose ? ((curPrice - prevClose) / prevClose * 100).toFixed(2) : "0";

    return {
      code, name: parts[0],
      price: parts[3], change: changeVal, changePercent: changePct + "%",
      open: parts[1], high: parts[4], low: parts[5],
      volume: (parseFloat(parts[8]) / 100).toFixed(0) + "手",
      amount: (parseFloat(parts[9]) / 10000).toFixed(2) + "万",
      time: `${parts[30]} ${parts[31]}`,
    };
  } catch { return null; }
}

async function searchStock(keyword: string): Promise<Array<{ code: string; name: string; market: string }>> {
  try {
    const resp = await fetch(
      `https://suggest3.sinajs.cn/suggest/type=11,12,13,14,15&key=${encodeURIComponent(keyword)}&name=suggestdata`,
      { headers: { Referer: "https://finance.sina.com.cn" }, signal: AbortSignal.timeout(8000) },
    );
    const text = await resp.text();
    const match = text.match(/="(.+)"/);
    if (!match || !match[1]) return [];

    const results: Array<{ code: string; name: string; market: string }> = [];
    for (const item of match[1].split(";")) {
      const p = item.split(",");
      if (p.length >= 4) {
        const marketMap: Record<string, string> = { "11": "A股", "12": "B股", "13": "权证", "14": "期货", "15": "债券" };
        results.push({ code: p[3], name: p[4] || p[2], market: marketMap[p[1]] || p[1] });
      }
    }
    return results.slice(0, 10);
  } catch { return []; }
}

export const stockQuerySkill: SkillDefinition = {
  name: "stock_query",
  displayName: "股票行情查询",
  description:
    "查询A股/港股/美股的实时行情数据，包括价格、涨跌幅、成交量。支持股票代码和名称搜索。" +
    "用户说'股票'、'行情'、'股价'、'涨跌'、'A股'、'大盘'时使用。",
  icon: "TrendingUp",
  category: "life",
  parameters: z.object({
    action: z.enum(["query", "search"]).describe("操作: query=查询行情, search=搜索股票代码"),
    code: z.string().optional().describe("股票代码(如600519、sh600519)，query时使用"),
    keyword: z.string().optional().describe("搜索关键词(如'茅台')，search时使用"),
    codes: z.array(z.string()).optional().describe("批量查询多个股票代码"),
  }),
  execute: async (params) => {
    const { action, code, keyword, codes } = params as {
      action: string; code?: string; keyword?: string; codes?: string[];
    };

    try {
      if (action === "search") {
        if (!keyword) return { success: false, message: "❌ 请提供搜索关键词 (keyword 参数)" };
        const results = await searchStock(keyword);
        if (results.length === 0) return { success: true, message: `🔍 未找到匹配 "${keyword}" 的股票` };

        let msg = `🔍 搜索 "${keyword}" 结果 (${results.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const r of results) {
          msg += `  ${r.code} — ${r.name} [${r.market}]\n`;
        }
        return { success: true, message: msg, data: { results: results as unknown as Record<string, unknown>[] } };
      }

      if (action === "query") {
        const codeList = codes || (code ? [code] : []);
        if (codeList.length === 0) return { success: false, message: "❌ 请提供股票代码 (code 参数，如 600519 或 sh600519)" };

        const results: StockData[] = [];
        for (const c of codeList.slice(0, 20)) {
          const normalized = normalizeCode(c);
          const data = await fetchSinaQuote(normalized);
          if (data) results.push(data);
        }

        if (results.length === 0) return { success: false, message: "❌ 未获取到行情数据，请检查股票代码是否正确" };

        let msg = `📊 股票行情\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const s of results) {
          const changeNum = parseFloat(s.change);
          const arrow = changeNum > 0 ? "🔴 +" : changeNum < 0 ? "🟢 " : "⚪ ";
          msg += `\n${s.name} (${s.code})\n`;
          msg += `  💰 现价: ${s.price}  ${arrow}${s.change} (${changeNum > 0 ? "+" : ""}${s.changePercent})\n`;
          msg += `  📈 最高: ${s.high}  📉 最低: ${s.low}  开盘: ${s.open}\n`;
          msg += `  📊 成交量: ${s.volume}  成交额: ${s.amount}\n`;
          msg += `  🕐 ${s.time}\n`;
        }

        return { success: true, message: msg, data: { stocks: results as unknown as Record<string, unknown>[] } };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ 行情查询失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
