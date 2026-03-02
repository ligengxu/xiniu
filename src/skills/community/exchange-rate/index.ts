import { z } from "zod";
import type { SkillDefinition } from "../types";

const CURRENCY_NAMES: Record<string, string> = {
  CNY: "人民币", USD: "美元", EUR: "欧元", GBP: "英镑", JPY: "日元",
  KRW: "韩元", HKD: "港币", TWD: "新台币", SGD: "新加坡元", AUD: "澳元",
  CAD: "加元", CHF: "瑞士法郎", THB: "泰铢", MYR: "马来西亚林吉特",
  INR: "印度卢比", RUB: "俄罗斯卢布", BRL: "巴西雷亚尔", ZAR: "南非兰特",
  NZD: "新西兰元", SEK: "瑞典克朗", NOK: "挪威克朗", DKK: "丹麦克朗",
  PHP: "菲律宾比索", IDR: "印尼盾", VND: "越南盾", AED: "阿联酋迪拉姆",
  SAR: "沙特里亚尔", TRY: "土耳其里拉", MXN: "墨西哥比索", PLN: "波兰兹罗提",
};

const NAME_TO_CODE: Record<string, string> = {};
for (const [code, name] of Object.entries(CURRENCY_NAMES)) {
  NAME_TO_CODE[name] = code;
  NAME_TO_CODE[code.toLowerCase()] = code;
}

function resolveCode(input: string): string {
  const upper = input.trim().toUpperCase();
  if (CURRENCY_NAMES[upper]) return upper;
  return NAME_TO_CODE[input.trim()] || upper;
}

async function fetchRates(base: string): Promise<{ ok: boolean; rates?: Record<string, number>; error?: string }> {
  const apis = [
    async () => {
      const resp = await fetch(`https://open.er-api.com/v6/latest/${base}`, { signal: AbortSignal.timeout(10000) });
      const data = await resp.json() as { result: string; rates?: Record<string, number> };
      if (data.result !== "success" || !data.rates) return null;
      return data.rates;
    },
    async () => {
      const resp = await fetch(`https://api.exchangerate-api.com/v4/latest/${base}`, { signal: AbortSignal.timeout(10000) });
      const data = await resp.json() as { rates?: Record<string, number> };
      return data.rates || null;
    },
  ];

  for (const apiFn of apis) {
    try {
      const rates = await apiFn();
      if (rates) return { ok: true, rates };
    } catch { continue; }
  }
  return { ok: false, error: "所有汇率API均不可用" };
}

export const exchangeRateSkill: SkillDefinition = {
  name: "exchange_rate",
  displayName: "汇率换算",
  description:
    "查询实时汇率并进行货币换算，支持30+种主要货币。可输入货币代码(USD)或中文名(美元)。" +
    "用户说'汇率'、'换算'、'兑换'、'美元人民币'时使用。",
  icon: "DollarSign",
  category: "life",
  parameters: z.object({
    from: z.string().describe("源货币（代码如USD或中文名如美元）"),
    to: z.string().describe("目标货币（代码如CNY或中文名如人民币）"),
    amount: z.number().optional().describe("金额，默认1"),
  }),
  execute: async (params) => {
    const { from: rawFrom, to: rawTo, amount: rawAmount } = params as {
      from: string; to: string; amount?: number;
    };

    const from = resolveCode(rawFrom);
    const to = resolveCode(rawTo);
    const amount = rawAmount || 1;

    try {
      const result = await fetchRates(from);
      if (!result.ok || !result.rates) return { success: false, message: `❌ 汇率查询失败: ${result.error}` };

      const rate = result.rates[to];
      if (!rate) return { success: false, message: `❌ 不支持的货币代码: ${to}` };

      const converted = (amount * rate).toFixed(4);
      const fromName = CURRENCY_NAMES[from] || from;
      const toName = CURRENCY_NAMES[to] || to;

      let msg = `💱 汇率换算结果\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `💰 ${amount} ${fromName}(${from}) = **${converted} ${toName}(${to})**\n`;
      msg += `📊 汇率: 1 ${from} = ${rate.toFixed(6)} ${to}\n`;
      msg += `📊 反向: 1 ${to} = ${(1 / rate).toFixed(6)} ${from}\n`;

      const popular = ["USD", "CNY", "EUR", "GBP", "JPY", "HKD"].filter((c) => c !== from && c !== to);
      const extras: string[] = [];
      for (const c of popular.slice(0, 4)) {
        const r = result.rates[c];
        if (r) extras.push(`  ${amount} ${from} = ${(amount * r).toFixed(2)} ${CURRENCY_NAMES[c] || c}`);
      }
      if (extras.length > 0) msg += `\n📋 参考汇率:\n${extras.join("\n")}`;

      return { success: true, message: msg, data: { from, to, rate, amount, converted: parseFloat(converted) } };
    } catch (err) {
      return { success: false, message: `❌ 汇率查询异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
