import { z } from "zod";
import type { SkillDefinition } from "../types";

interface IpInfo {
  ip: string;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
  org?: string;
  lat?: number;
  lon?: number;
  timezone?: string;
  asn?: string;
}

async function queryIpApi(ip: string): Promise<IpInfo | null> {
  try {
    const resp = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp,org,lat,lon,timezone,as,query&lang=zh-CN`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      status?: string; query?: string; country?: string; regionName?: string;
      city?: string; isp?: string; org?: string; lat?: number; lon?: number;
      timezone?: string; as?: string; message?: string;
    };
    if (data.status !== "success") return null;
    return {
      ip: data.query || ip,
      country: data.country,
      region: data.regionName,
      city: data.city,
      isp: data.isp,
      org: data.org,
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone,
      asn: data.as,
    };
  } catch {
    return null;
  }
}

async function queryIpinfo(ip: string): Promise<IpInfo | null> {
  try {
    const resp = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as {
      ip?: string; country?: string; region?: string; city?: string;
      org?: string; timezone?: string; loc?: string;
    };
    const [lat, lon] = (data.loc || "").split(",").map(Number);
    return {
      ip: data.ip || ip,
      country: data.country,
      region: data.region,
      city: data.city,
      org: data.org,
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
      timezone: data.timezone,
    };
  } catch {
    return null;
  }
}

async function getMyIp(): Promise<string | null> {
  const apis = [
    "https://api.ipify.org?format=json",
    "https://httpbin.org/ip",
  ];
  for (const url of apis) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resp.ok) continue;
      const data = await resp.json() as { ip?: string; origin?: string };
      const ip = data.ip || data.origin;
      if (ip) return ip.trim();
    } catch {
      continue;
    }
  }
  return null;
}

export const ipLookupSkill: SkillDefinition = {
  name: "ip_lookup",
  displayName: "网络地址查询",
  description: "查询 IP 地址的地理位置、运营商、ASN 等信息。不传 IP 则查询本机公网 IP。用户说'查IP'、'IP地址'、'IP查询'、'我的IP'、'ip lookup'、'IP归属地'时使用。",
  icon: "Globe",
  category: "dev",
  parameters: z.object({
    ip: z.string().optional().describe("要查询的 IP 地址，留空则查询本机公网 IP"),
  }),
  execute: async (params) => {
    const { ip: inputIp } = params as { ip?: string };

    try {
      let targetIp = inputIp?.trim() || "";

      if (!targetIp) {
        const myIp = await getMyIp();
        if (!myIp) {
          return { success: false, message: "❌ 无法获取本机公网 IP" };
        }
        targetIp = myIp;
      }

      const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
      const ipv6Regex = /^[0-9a-fA-F:]+$/;
      if (!ipv4Regex.test(targetIp) && !ipv6Regex.test(targetIp)) {
        return { success: false, message: `❌ 无效的 IP 地址格式: ${targetIp}` };
      }

      let info = await queryIpApi(targetIp);
      if (!info) info = await queryIpinfo(targetIp);

      if (!info) {
        return { success: false, message: `❌ 无法查询 IP: ${targetIp}，所有 API 均不可用` };
      }

      const lines = [
        `🌐 IP 地址查询结果`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📍 IP: ${info.ip}`,
      ];
      if (info.country) lines.push(`🏳️ 国家: ${info.country}`);
      if (info.region) lines.push(`📌 省份/地区: ${info.region}`);
      if (info.city) lines.push(`🏙️ 城市: ${info.city}`);
      if (info.isp) lines.push(`📡 运营商: ${info.isp}`);
      if (info.org) lines.push(`🏢 组织: ${info.org}`);
      if (info.asn) lines.push(`🔗 ASN: ${info.asn}`);
      if (info.timezone) lines.push(`🕐 时区: ${info.timezone}`);
      if (info.lat !== undefined && info.lon !== undefined) {
        lines.push(`📐 坐标: ${info.lat}, ${info.lon}`);
      }

      return {
        success: true,
        message: lines.join("\n"),
        data: info as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return { success: false, message: `❌ IP 查询异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
