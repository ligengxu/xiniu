import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  saveCredential,
  getCredential,
  listCredentials,
  deleteCredential,
  touchCredential,
} from "@/lib/credential-store";

interface CloudConfig {
  provider: "aliyun" | "tencent";
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  const crypto = require("crypto");
  return crypto.createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string): string {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(data).digest("hex");
}

function generateAliyunSignature(
  method: string,
  params: Record<string, string>,
  secret: string,
): string {
  const crypto = require("crypto");
  const encode = (s: string) => encodeURIComponent(s).replace(/\*/g, "%2A").replace(/'/g, "%27").replace(/!/g, "%21").replace(/\(/g, "%28").replace(/\)/g, "%29");
  const sorted = Object.keys(params).sort();
  const canonicalQuery = sorted
    .map((k) => `${encode(k)}=${encode(params[k])}`)
    .join("&");
  const strToSign = `${method}&${encode("/")}&${encode(canonicalQuery)}`;
  const hmac = crypto.createHmac("sha1", secret + "&");
  return hmac.update(strToSign).digest("base64");
}

async function aliyunRequest(
  config: CloudConfig,
  apiEndpoint: string,
  action: string,
  extraParams: Record<string, string> = {},
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const now = new Date();
    const params: Record<string, string> = {
      Action: action,
      Format: "JSON",
      Version: apiEndpoint.includes("ecs") ? "2014-05-26" : apiEndpoint.includes("alidns") ? "2015-01-09" : "2019-03-15",
      AccessKeyId: config.accessKeyId,
      SignatureMethod: "HMAC-SHA1",
      Timestamp: now.toISOString().replace(/\.\d+Z$/, "Z"),
      SignatureVersion: "1.0",
      SignatureNonce: `${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
      RegionId: config.region,
      ...extraParams,
    };

    params.Signature = generateAliyunSignature("GET", params, config.accessKeySecret);

    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");

    const resp = await fetch(`https://${apiEndpoint}/?${qs}`, {
      signal: AbortSignal.timeout(20000),
    });
    const data = await resp.json();

    if (!resp.ok || (data as Record<string, unknown>).Code) {
      return { ok: false, error: (data as Record<string, unknown>).Message as string || `HTTP ${resp.status}` };
    }
    return { ok: true, data: data as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function tencentRequest(
  config: CloudConfig,
  service: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const host = `${service}.tencentcloudapi.com`;
    const now = Math.floor(Date.now() / 1000);
    const dateStr = new Date(now * 1000).toISOString().slice(0, 10);
    const body = JSON.stringify(payload);

    const hashedPayload = sha256Hex(body);
    const canonicalRequest = [
      "POST", "/", "",
      `content-type:application/json\nhost:${host}\n`,
      "content-type;host",
      hashedPayload,
    ].join("\n");

    const credentialScope = `${dateStr}/${service}/tc3_request`;
    const strToSign = [
      "TC3-HMAC-SHA256", String(now),
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const secretDate = hmacSha256(`TC3${config.accessKeySecret}`, dateStr);
    const secretService = hmacSha256(secretDate, service);
    const secretSigning = hmacSha256(secretService, "tc3_request");
    const signature = hmacSha256(secretSigning, strToSign).toString("hex");

    const authorization = `TC3-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

    const resp = await fetch(`https://${host}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: host,
        Authorization: authorization,
        "X-TC-Action": action,
        "X-TC-Timestamp": String(now),
        "X-TC-Version": service === "cvm" ? "2017-03-12" : service === "dnspod" ? "2021-03-23" : "2018-06-08",
        "X-TC-Region": config.region,
      },
      body,
      signal: AbortSignal.timeout(20000),
    });

    const result = await resp.json() as { Response: Record<string, unknown> };
    const respData = result.Response || result;
    if ((respData as Record<string, unknown>).Error) {
      const errObj = (respData as Record<string, unknown>).Error as Record<string, string>;
      return { ok: false, error: `${errObj.Code}: ${errObj.Message}` };
    }
    return { ok: true, data: respData as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function loadConfig(
  provider?: string,
  accessKeyId?: string,
  accessKeySecret?: string,
  region?: string,
): Promise<{ ok: boolean; config?: CloudConfig; message?: string }> {
  if (accessKeyId && accessKeySecret) {
    const cfg: CloudConfig = {
      provider: (provider as "aliyun" | "tencent") || "aliyun",
      accessKeyId,
      accessKeySecret,
      region: region || "cn-hangzhou",
    };
    await saveCredential({
      type: "cloud",
      label: `${cfg.provider} (${cfg.accessKeyId.slice(0, 6)}...${cfg.accessKeyId.slice(-4)})`,
      host: cfg.provider,
      port: 0,
      username: cfg.accessKeyId,
      password: cfg.accessKeySecret,
      extra: { provider: cfg.provider, region: cfg.region },
    });
    return { ok: true, config: cfg };
  }

  const saved = await getCredential("cloud", undefined, undefined);
  if (saved) {
    await touchCredential(saved.id);
    return {
      ok: true,
      config: {
        provider: (saved.extra?.provider as "aliyun" | "tencent") || "aliyun",
        accessKeyId: saved.username,
        accessKeySecret: saved.password,
        region: (saved.extra?.region as string) || region || "cn-hangzhou",
      },
    };
  }

  return { ok: false, message: "❌ 未找到云服务凭证。请提供 accessKeyId 和 accessKeySecret 参数。" };
}

async function listInstances(config: CloudConfig): Promise<string> {
  if (config.provider === "aliyun") {
    const res = await aliyunRequest(config, "ecs.aliyuncs.com", "DescribeInstances", {
      PageSize: "50",
    });
    if (!res.ok) return `❌ 查询失败: ${res.error}`;

    const instances = ((res.data?.Instances as Record<string, unknown>)?.Instance as Array<Record<string, unknown>>) || [];
    if (instances.length === 0) return "📋 当前区域无ECS实例";

    let msg = `📋 ECS实例列表 (${instances.length}台) [${config.region}]\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const inst of instances) {
      const status = inst.Status === "Running" ? "🟢 运行中" : inst.Status === "Stopped" ? "🔴 已停止" : `⚪ ${inst.Status}`;
      const ips = (((inst.PublicIpAddress as Record<string, unknown>)?.IpAddress as string[]) || []).join(", ");
      const privateIps = (((inst.InnerIpAddress as Record<string, unknown>)?.IpAddress as string[]) ||
        ((inst.VpcAttributes as Record<string, unknown>)?.PrivateIpAddress as Record<string, unknown>)?.IpAddress as string[] || []).join(", ");
      msg += `\n${status} ${inst.InstanceName} (${inst.InstanceId})\n`;
      msg += `   规格: ${inst.InstanceType} | OS: ${inst.OSName || inst.OSType}\n`;
      msg += `   公网IP: ${ips || "无"} | 内网IP: ${privateIps || "无"}\n`;
      msg += `   CPU: ${inst.Cpu}核 | 内存: ${inst.Memory}MB\n`;
    }
    return msg;
  }

  const res = await tencentRequest(config, "cvm", "DescribeInstances", { Limit: 50 });
  if (!res.ok) return `❌ 查询失败: ${res.error}`;

  const instances = (res.data?.InstanceSet as Array<Record<string, unknown>>) || [];
  if (instances.length === 0) return "📋 当前区域无CVM实例";

  let msg = `📋 CVM实例列表 (${instances.length}台) [${config.region}]\n━━━━━━━━━━━━━━━━━━━━\n`;
  for (const inst of instances) {
    const statusMap: Record<string, string> = { RUNNING: "🟢 运行中", STOPPED: "🔴 已停止", PENDING: "🟡 创建中" };
    const status = statusMap[inst.InstanceState as string] || `⚪ ${inst.InstanceState}`;
    msg += `\n${status} ${inst.InstanceName} (${inst.InstanceId})\n`;
    msg += `   规格: ${inst.InstanceType} | OS: ${inst.OsName}\n`;
    msg += `   公网IP: ${(inst.PublicIpAddresses as string[] || []).join(", ") || "无"}\n`;
    msg += `   内网IP: ${(inst.PrivateIpAddresses as string[] || []).join(", ") || "无"}\n`;
    msg += `   CPU: ${inst.CPU}核 | 内存: ${inst.Memory}GB\n`;
  }
  return msg;
}

async function controlInstance(config: CloudConfig, instanceId: string, operation: string): Promise<string> {
  const actionMap: Record<string, Record<string, string>> = {
    aliyun: { start: "StartInstance", stop: "StopInstance", reboot: "RebootInstance" },
    tencent: { start: "StartInstances", stop: "StopInstances", reboot: "RebootInstances" },
  };

  const action = actionMap[config.provider]?.[operation];
  if (!action) return `❌ 不支持的操作: ${operation}`;

  if (config.provider === "aliyun") {
    const res = await aliyunRequest(config, "ecs.aliyuncs.com", action, { InstanceId: instanceId });
    return res.ok ? `✅ 实例 ${instanceId} 已执行 ${operation}` : `❌ 操作失败: ${res.error}`;
  }

  const res = await tencentRequest(config, "cvm", action, { InstanceIds: [instanceId] });
  return res.ok ? `✅ 实例 ${instanceId} 已执行 ${operation}` : `❌ 操作失败: ${res.error}`;
}

async function listDnsRecords(config: CloudConfig, domain: string): Promise<string> {
  if (config.provider === "aliyun") {
    const res = await aliyunRequest(config, "alidns.aliyuncs.com", "DescribeDomainRecords", {
      DomainName: domain, PageSize: "100",
    });
    if (!res.ok) return `❌ 查询DNS失败: ${res.error}`;

    const records = ((res.data?.DomainRecords as Record<string, unknown>)?.Record as Array<Record<string, unknown>>) || [];
    if (records.length === 0) return `📋 域名 ${domain} 无解析记录`;

    let msg = `📋 ${domain} 解析记录 (${records.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
    for (const r of records) {
      const status = r.Status === "ENABLE" ? "✅" : "❌";
      msg += `${status} ${r.RR}.${domain} → ${r.Value} [${r.Type}] TTL:${r.TTL}\n`;
    }
    return msg;
  }

  const res = await tencentRequest(config, "dnspod", "DescribeRecordList", {
    Domain: domain, Limit: 100,
  });
  if (!res.ok) return `❌ 查询DNS失败: ${res.error}`;

  const records = (res.data?.RecordList as Array<Record<string, unknown>>) || [];
  if (records.length === 0) return `📋 域名 ${domain} 无解析记录`;

  let msg = `📋 ${domain} 解析记录 (${records.length}条)\n━━━━━━━━━━━━━━━━━━━━\n`;
  for (const r of records) {
    const status = r.Status === "ENABLE" ? "✅" : "❌";
    msg += `${status} ${r.Name}.${domain} → ${r.Value} [${r.Type}] TTL:${r.TTL}\n`;
  }
  return msg;
}

async function addDnsRecord(
  config: CloudConfig, domain: string, rr: string, type: string, value: string, ttl = 600,
): Promise<string> {
  if (config.provider === "aliyun") {
    const res = await aliyunRequest(config, "alidns.aliyuncs.com", "AddDomainRecord", {
      DomainName: domain, RR: rr, Type: type, Value: value, TTL: String(ttl),
    });
    return res.ok ? `✅ 已添加解析: ${rr}.${domain} → ${value} [${type}]` : `❌ 添加失败: ${res.error}`;
  }

  const res = await tencentRequest(config, "dnspod", "CreateRecord", {
    Domain: domain, SubDomain: rr, RecordType: type, Value: value, RecordLine: "默认", TTL: ttl,
  });
  return res.ok ? `✅ 已添加解析: ${rr}.${domain} → ${value} [${type}]` : `❌ 添加失败: ${res.error}`;
}

async function ossUpload(config: CloudConfig, localPath: string, bucket: string, objectKey: string): Promise<string> {
  try {
    const fs = await import("fs");
    const crypto = await import("crypto");

    if (!fs.existsSync(localPath)) return `❌ 文件不存在: ${localPath}`;
    const fileContent = fs.readFileSync(localPath);

    if (config.provider === "aliyun") {
      const date = new Date().toUTCString();
      const contentType = "application/octet-stream";
      const strToSign = `PUT\n\n${contentType}\n${date}\n/${bucket}/${objectKey}`;
      const signature = crypto.createHmac("sha1", config.accessKeySecret).update(strToSign).digest("base64");

      const endpoint = `https://${bucket}.oss-${config.region}.aliyuncs.com/${objectKey}`;
      const resp = await fetch(endpoint, {
        method: "PUT",
        headers: {
          Date: date,
          "Content-Type": contentType,
          Authorization: `OSS ${config.accessKeyId}:${signature}`,
        },
        body: fileContent,
        signal: AbortSignal.timeout(60000),
      });

      if (resp.ok) return `✅ 上传成功: ${endpoint}\n📁 Bucket: ${bucket}\n📄 Key: ${objectKey}\n📊 大小: ${(fileContent.length / 1024).toFixed(1)}KB`;
      const errText = await resp.text();
      return `❌ 上传失败 (${resp.status}): ${errText.slice(0, 200)}`;
    }

    return "❌ 腾讯云COS上传建议使用 cos-nodejs-sdk-v5，请先安装: npm install cos-nodejs-sdk-v5";
  } catch (err) {
    return `❌ 上传异常: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function listBuckets(config: CloudConfig): Promise<string> {
  if (config.provider === "aliyun") {
    try {
      const crypto = await import("crypto");
      const date = new Date().toUTCString();
      const strToSign = `GET\n\n\n${date}\n/`;
      const signature = crypto.createHmac("sha1", config.accessKeySecret).update(strToSign).digest("base64");

      const resp = await fetch(`https://oss-${config.region}.aliyuncs.com/`, {
        headers: {
          Date: date,
          Authorization: `OSS ${config.accessKeyId}:${signature}`,
        },
        signal: AbortSignal.timeout(15000),
      });

      const xml = await resp.text();
      const buckets: string[] = [];
      const re = /<Name>([^<]+)<\/Name>/g;
      let m;
      while ((m = re.exec(xml)) !== null) buckets.push(m[1]);

      if (buckets.length === 0) return "📋 无OSS Bucket";
      return `📋 OSS Bucket列表 (${buckets.length}个)\n━━━━━━━━━━━━━━━━━━━━\n${buckets.map((b) => `  📦 ${b}`).join("\n")}`;
    } catch (err) {
      return `❌ 查询Bucket失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  try {
    const crypto = require("crypto");
    const date = new Date().toUTCString();
    const strToSign = `get\n\n\n${Math.floor(Date.now() / 1000) + 600}\n/`;
    const qSignKey = crypto.createHmac("sha1", config.accessKeySecret).update(`${Math.floor(Date.now() / 1000)};${Math.floor(Date.now() / 1000) + 600}`).digest("hex");
    void qSignKey;
    void strToSign;

    const resp = await fetch(`https://service.cos.myqcloud.com/`, {
      headers: {
        Authorization: `q-sign-algorithm=sha1&q-ak=${config.accessKeyId}&q-sign-time=${Math.floor(Date.now() / 1000)};${Math.floor(Date.now() / 1000) + 600}&q-key-time=${Math.floor(Date.now() / 1000)};${Math.floor(Date.now() / 1000) + 600}&q-header-list=host&q-url-param-list=&q-signature=placeholder`,
        Host: "service.cos.myqcloud.com",
      },
      signal: AbortSignal.timeout(15000),
    });
    const xml = await resp.text();
    const buckets: string[] = [];
    const re = /<Name>([^<]+)<\/Name>/g;
    let m;
    while ((m = re.exec(xml)) !== null) buckets.push(m[1]);
    if (buckets.length === 0) return "📋 无COS Bucket\n\n💡 注意: COS API使用XML签名，建议安装 cos-nodejs-sdk-v5 进行完整管理:\nnpm install cos-nodejs-sdk-v5";
    return `📋 COS Bucket列表 (${buckets.length}个)\n━━━━━━━━━━━━━━━━━━━━\n${buckets.map((b) => `  📦 ${b}`).join("\n")}`;
  } catch (err) {
    return `❌ 查询COS Bucket失败: ${err instanceof Error ? err.message : String(err)}\n\n💡 腾讯云COS建议使用官方SDK:\nnpm install cos-nodejs-sdk-v5`;
  }
}

export const cloudDeploySkill: SkillDefinition = {
  name: "cloud_deploy",
  displayName: "云服务部署",
  description:
    "管理阿里云/腾讯云资源：ECS/CVM实例管理（列表/启动/停止/重启）、域名DNS解析（添加/查看记录）、OSS/COS对象存储（上传文件/列出Bucket）。" +
    "用户说'云服务器'、'ECS'、'阿里云'、'腾讯云'、'域名解析'、'OSS上传'、'COS'时使用。",
  icon: "Cloud",
  category: "dev",
  setupGuide: {
    framework: "阿里云 / 腾讯云 API",
    frameworkUrl: "https://www.aliyun.com/",
    configSteps: [
      "阿里云: 前往 RAM 控制台创建 AccessKey",
      "腾讯云: 前往 CAM 控制台创建 SecretId/SecretKey",
      "使用 config 操作保存云平台凭证",
      "首次使用后凭证会加密存储在本地",
    ],
    requiredCredentials: [
      { key: "access_key_id", label: "AccessKey ID", description: "阿里云 AccessKey ID 或 腾讯云 SecretId" },
      { key: "access_key_secret", label: "AccessKey Secret", description: "阿里云 AccessKey Secret 或 腾讯云 SecretKey" },
    ],
    healthCheckAction: "list_instances",
    docsUrl: "https://help.aliyun.com/document_detail/53045.html",
  },
  parameters: z.object({
    action: z.enum([
      "config", "list_saved", "delete_saved",
      "list_instances", "start", "stop", "reboot",
      "dns_list", "dns_add",
      "oss_upload", "oss_list_buckets",
    ]).describe(
      "操作: config=配置凭证, list_saved=列出已保存, delete_saved=删除凭证, " +
      "list_instances=实例列表, start/stop/reboot=实例控制, " +
      "dns_list=DNS记录列表, dns_add=添加DNS记录, " +
      "oss_upload=上传文件到OSS/COS, oss_list_buckets=列出存储桶"
    ),
    provider: z.enum(["aliyun", "tencent"]).optional().describe("云服务商: aliyun=阿里云, tencent=腾讯云，默认aliyun"),
    accessKeyId: z.string().optional().describe("AccessKey ID (首次配置需要)"),
    accessKeySecret: z.string().optional().describe("AccessKey Secret (首次配置需要)"),
    region: z.string().optional().describe("区域ID，如cn-hangzhou/ap-guangzhou，默认cn-hangzhou"),
    instanceId: z.string().optional().describe("实例ID (start/stop/reboot时使用)"),
    domain: z.string().optional().describe("域名 (dns_list/dns_add时使用)"),
    rr: z.string().optional().describe("主机记录，如www、@ (dns_add时使用)"),
    recordType: z.string().optional().describe("记录类型: A/CNAME/MX/TXT等 (dns_add时使用)"),
    recordValue: z.string().optional().describe("记录值 (dns_add时使用)"),
    ttl: z.number().optional().describe("TTL (dns_add时使用，默认600)"),
    localPath: z.string().optional().describe("本地文件路径 (oss_upload时使用)"),
    bucket: z.string().optional().describe("Bucket名称 (oss_upload时使用)"),
    objectKey: z.string().optional().describe("对象Key/路径 (oss_upload时使用)"),
    credentialId: z.string().optional().describe("凭证ID (delete_saved时使用)"),
  }),
  execute: async (params) => {
    const p = params as {
      action: string; provider?: string;
      accessKeyId?: string; accessKeySecret?: string; region?: string;
      instanceId?: string;
      domain?: string; rr?: string; recordType?: string; recordValue?: string; ttl?: number;
      localPath?: string; bucket?: string; objectKey?: string;
      credentialId?: string;
    };

    try {
      if (p.action === "list_saved") {
        const saved = await listCredentials("cloud");
        if (saved.length === 0) return { success: true, message: "📋 暂无保存的云服务凭证。使用 config 操作配置。" };
        let msg = `📋 已保存的云服务凭证 (${saved.length}个)\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (const c of saved) {
          msg += `☁️ ${c.extra?.provider || "aliyun"} | AK: ${c.username.slice(0, 6)}...${c.username.slice(-4)}\n`;
          msg += `   ID: ${c.id} | 区域: ${c.extra?.region || "cn-hangzhou"} | 最后使用: ${c.lastUsedAt}\n\n`;
        }
        return { success: true, message: msg };
      }

      if (p.action === "delete_saved") {
        if (!p.credentialId) return { success: false, message: "❌ 需要提供 credentialId" };
        const ok = await deleteCredential(p.credentialId);
        return { success: ok, message: ok ? "✅ 云服务凭证已删除" : "❌ 未找到凭证" };
      }

      const loaded = await loadConfig(p.provider, p.accessKeyId, p.accessKeySecret, p.region);
      if (!loaded.ok || !loaded.config) return { success: false, message: loaded.message || "❌ 配置加载失败" };
      const config = loaded.config;

      if (p.action === "config") {
        return {
          success: true,
          message: `✅ 云服务凭证已配置\n━━━━━━━━━━━━━━━━━━━━\n☁️ 服务商: ${config.provider === "aliyun" ? "阿里云" : "腾讯云"}\n🔑 AK: ${config.accessKeyId.slice(0, 6)}...${config.accessKeyId.slice(-4)}\n🌍 区域: ${config.region}\n💾 凭证已加密保存`,
        };
      }

      if (p.action === "list_instances") {
        const msg = await listInstances(config);
        return { success: !msg.startsWith("❌"), message: msg };
      }

      if (["start", "stop", "reboot"].includes(p.action)) {
        if (!p.instanceId) return { success: false, message: "❌ 请提供实例ID (instanceId 参数)" };
        const msg = await controlInstance(config, p.instanceId, p.action);
        return { success: msg.startsWith("✅"), message: msg };
      }

      if (p.action === "dns_list") {
        if (!p.domain) return { success: false, message: "❌ 请提供域名 (domain 参数)" };
        const msg = await listDnsRecords(config, p.domain);
        return { success: !msg.startsWith("❌"), message: msg };
      }

      if (p.action === "dns_add") {
        if (!p.domain || !p.rr || !p.recordType || !p.recordValue) {
          return { success: false, message: "❌ 添加DNS记录需要: domain, rr, recordType, recordValue 参数" };
        }
        const msg = await addDnsRecord(config, p.domain, p.rr, p.recordType, p.recordValue, p.ttl);
        return { success: msg.startsWith("✅"), message: msg };
      }

      if (p.action === "oss_upload") {
        if (!p.localPath || !p.bucket || !p.objectKey) {
          return { success: false, message: "❌ 上传文件需要: localPath, bucket, objectKey 参数" };
        }
        const msg = await ossUpload(config, p.localPath, p.bucket, p.objectKey);
        return { success: msg.startsWith("✅"), message: msg };
      }

      if (p.action === "oss_list_buckets") {
        const msg = await listBuckets(config);
        return { success: !msg.startsWith("❌"), message: msg };
      }

      return { success: false, message: `❌ 未知操作: ${p.action}` };
    } catch (err) {
      return { success: false, message: `云服务操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
