import { z } from "zod";
import type { SkillDefinition } from "../types";

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

function longToIp(long: number): string {
  return [long >>> 24, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join(".");
}

function cidrToMask(cidr: number): number {
  return cidr === 0 ? 0 : (0xFFFFFFFF << (32 - cidr)) >>> 0;
}

function maskToCidr(mask: number): number {
  let cidr = 0;
  let m = mask;
  while (m & 0x80000000) { cidr++; m = (m << 1) >>> 0; }
  return cidr;
}

function getClass(ip: number): string {
  const first = ip >>> 24;
  if (first < 128) return "A";
  if (first < 192) return "B";
  if (first < 224) return "C";
  if (first < 240) return "D (组播)";
  return "E (保留)";
}

function isPrivate(ip: number): boolean {
  const first = ip >>> 24;
  const second = (ip >>> 16) & 255;
  if (first === 10) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

export const subnetCalcSkill: SkillDefinition = {
  name: "subnet_calc",
  displayName: "子网计算器",
  description: "IP 子网计算工具。支持 CIDR 子网计算、子网划分、IP 范围检查、通配符掩码计算。用户说'子网计算'、'子网掩码'、'CIDR'、'子网划分'、'IP范围'、'网络地址'、'subnet'时使用。",
  icon: "Network",
  category: "dev",
  parameters: z.object({
    action: z.enum(["calc", "split", "check", "range"]).describe("操作：calc=子网计算, split=子网划分, check=检查IP是否在子网内, range=IP范围转CIDR"),
    cidr: z.string().optional().describe("CIDR 表示法（如 192.168.1.0/24）"),
    ip: z.string().optional().describe("IP 地址"),
    mask: z.string().optional().describe("子网掩码（如 255.255.255.0）"),
    subnets: z.number().optional().describe("要划分的子网数量（split 操作）"),
    startIp: z.string().optional().describe("起始 IP（range 操作）"),
    endIp: z.string().optional().describe("结束 IP（range 操作）"),
  }),
  execute: async (params) => {
    const p = params as Record<string, unknown>;
    const action = p.action as string;

    try {
      if (action === "calc") {
        let ipStr: string;
        let cidr: number;

        if (p.cidr) {
          const parts = (p.cidr as string).split("/");
          ipStr = parts[0];
          cidr = parseInt(parts[1]);
        } else if (p.ip && p.mask) {
          ipStr = p.ip as string;
          cidr = maskToCidr(ipToLong(p.mask as string));
        } else {
          return { success: false, message: "❌ 请提供 cidr（如 192.168.1.0/24）或 ip + mask" };
        }

        if (cidr < 0 || cidr > 32) return { success: false, message: "❌ CIDR 前缀长度必须在 0-32 之间" };

        const ipLong = ipToLong(ipStr);
        const maskLong = cidrToMask(cidr);
        const wildcardLong = (~maskLong) >>> 0;
        const networkLong = (ipLong & maskLong) >>> 0;
        const broadcastLong = (networkLong | wildcardLong) >>> 0;
        const hostCount = cidr >= 31 ? (cidr === 32 ? 1 : 2) : (broadcastLong - networkLong - 1);
        const firstHost = cidr >= 31 ? networkLong : networkLong + 1;
        const lastHost = cidr >= 31 ? broadcastLong : broadcastLong - 1;

        const lines = [
          `🌐 子网计算结果`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📍 输入: ${ipStr}/${cidr}`,
          `🔢 网络地址: ${longToIp(networkLong)}`,
          `📡 广播地址: ${longToIp(broadcastLong)}`,
          `🎭 子网掩码: ${longToIp(maskLong)}`,
          `🃏 通配符掩码: ${longToIp(wildcardLong)}`,
          `📌 第一个可用: ${longToIp(firstHost)}`,
          `📌 最后可用: ${longToIp(lastHost)}`,
          `📊 可用主机数: ${hostCount.toLocaleString()}`,
          `📋 IP 类别: ${getClass(ipLong)}`,
          `🏠 私有地址: ${isPrivate(ipLong) ? "是" : "否"}`,
          `📐 CIDR: /${cidr}`,
        ];

        return {
          success: true, message: lines.join("\n"),
          data: {
            network: longToIp(networkLong), broadcast: longToIp(broadcastLong),
            mask: longToIp(maskLong), wildcard: longToIp(wildcardLong),
            firstHost: longToIp(firstHost), lastHost: longToIp(lastHost),
            hostCount, cidr,
          },
        };
      }

      if (action === "split") {
        if (!p.cidr) return { success: false, message: "❌ split 需要 cidr 参数" };
        const parts = (p.cidr as string).split("/");
        const ipLong = ipToLong(parts[0]);
        const cidr = parseInt(parts[1]);
        const subnetCount = (p.subnets as number) || 2;

        const bitsNeeded = Math.ceil(Math.log2(subnetCount));
        const newCidr = cidr + bitsNeeded;
        if (newCidr > 30) return { success: false, message: `❌ 无法将 /${cidr} 划分为 ${subnetCount} 个子网（最大 /${30}）` };

        const networkLong = (ipLong & cidrToMask(cidr)) >>> 0;
        const actualCount = Math.pow(2, bitsNeeded);
        const subnetSize = Math.pow(2, 32 - newCidr);

        const lines = [`🔀 子网划分结果`, `━━━━━━━━━━━━━━━━━━━━`, `📍 原始网段: ${parts[0]}/${cidr}`, `📊 划分为 ${actualCount} 个 /${newCidr} 子网:\n`];

        for (let i = 0; i < actualCount && i < 32; i++) {
          const subNet = (networkLong + i * subnetSize) >>> 0;
          const subBroadcast = (subNet + subnetSize - 1) >>> 0;
          lines.push(`  ${i + 1}. ${longToIp(subNet)}/${newCidr} (${longToIp(subNet)} - ${longToIp(subBroadcast)}, ${subnetSize - 2} hosts)`);
        }

        return { success: true, message: lines.join("\n") };
      }

      if (action === "check") {
        if (!p.ip || !p.cidr) return { success: false, message: "❌ check 需要 ip + cidr 参数" };
        const parts = (p.cidr as string).split("/");
        const netIp = ipToLong(parts[0]);
        const cidr = parseInt(parts[1]);
        const maskLong = cidrToMask(cidr);
        const networkLong = (netIp & maskLong) >>> 0;
        const checkIp = ipToLong(p.ip as string);
        const isInSubnet = ((checkIp & maskLong) >>> 0) === networkLong;

        return {
          success: true,
          message: `🔍 IP 归属检查\n━━━━━━━━━━━━━━━━━━━━\n📍 IP: ${p.ip}\n🌐 子网: ${p.cidr}\n${isInSubnet ? "✅ IP 属于该子网" : "❌ IP 不属于该子网"}`,
          data: { ip: p.ip, cidr: p.cidr, inSubnet: isInSubnet },
        };
      }

      if (action === "range") {
        if (!p.startIp || !p.endIp) return { success: false, message: "❌ range 需要 startIp + endIp 参数" };
        const start = ipToLong(p.startIp as string);
        const end = ipToLong(p.endIp as string);
        const count = end - start + 1;

        const cidr = 32 - Math.ceil(Math.log2(count));
        const lines = [
          `📐 IP 范围分析`,
          `━━━━━━━━━━━━━━━━━━━━`,
          `📍 起始: ${p.startIp}`,
          `📍 结束: ${p.endIp}`,
          `📊 IP 数量: ${count.toLocaleString()}`,
          `📐 最小覆盖 CIDR: ${p.startIp}/${cidr}`,
        ];
        return { success: true, message: lines.join("\n"), data: { startIp: p.startIp, endIp: p.endIp, count, cidr } };
      }

      return { success: false, message: `❌ 未知操作: ${action}` };
    } catch (err) {
      return { success: false, message: `❌ 子网计算异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
