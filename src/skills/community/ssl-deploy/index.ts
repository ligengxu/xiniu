import { z } from "zod";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { SkillDefinition } from "../types";

function runCmd(cmd: string, args: string[], cwd?: string, timeout = 60000): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, timeout, shell: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, exitCode: code }));
    proc.on("error", (err) => resolve({ ok: false, stdout, stderr: err.message, exitCode: null }));
  });
}

async function checkCertInfo(domain: string): Promise<string> {
  const r = await runCmd("powershell", [
    "-NoProfile", "-Command",
    `try { $tcp = New-Object System.Net.Sockets.TcpClient('${domain}', 443); $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream()); $ssl.AuthenticateAsClient('${domain}'); $cert = $ssl.RemoteCertificate; $c2 = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cert); Write-Output "Subject: $($c2.Subject)"; Write-Output "Issuer: $($c2.Issuer)"; Write-Output "NotBefore: $($c2.NotBefore)"; Write-Output "NotAfter: $($c2.NotAfter)"; Write-Output "Thumbprint: $($c2.Thumbprint)"; $days = ($c2.NotAfter - (Get-Date)).Days; Write-Output "DaysRemaining: $days"; $ssl.Close(); $tcp.Close(); } catch { Write-Output "ERROR: $_" }`,
  ], undefined, 15000);
  return r.stdout.trim() || r.stderr.trim() || "无法获取证书信息";
}

export const sslDeploySkill: SkillDefinition = {
  name: "ssl_deploy",
  displayName: "安全证书管理",
  description:
    "SSL/TLS证书管理：查询域名证书信息、检查证书过期时间、生成自签名证书、生成CSR证书请求、部署证书到IIS/Nginx。用户说'SSL'、'HTTPS'、'证书'、'部署SSL'时使用。",
  icon: "ShieldCheck",
  category: "dev",
  parameters: z.object({
    action: z.enum(["check", "self_sign", "generate_csr", "deploy_iis", "deploy_nginx"])
      .describe("操作: check=检查域名证书, self_sign=生成自签名证书, generate_csr=生成CSR, deploy_iis=部署到IIS, deploy_nginx=生成Nginx配置"),
    domain: z.string().describe("域名，如 example.com"),
    outputDir: z.string().optional().describe("证书输出目录，默认桌面"),
    certPath: z.string().optional().describe("已有证书文件路径(deploy时使用)"),
    keyPath: z.string().optional().describe("已有私钥文件路径(deploy时使用)"),
    days: z.number().optional().describe("证书有效天数(self_sign时使用)，默认365"),
    nginxConfPath: z.string().optional().describe("Nginx配置文件输出路径"),
  }),
  execute: async (params) => {
    const {
      action, domain,
      outputDir = "C:/Users/Administrator/Desktop",
      certPath, keyPath,
      days = 365,
      nginxConfPath,
    } = params as {
      action: string; domain: string; outputDir?: string;
      certPath?: string; keyPath?: string; days?: number;
      nginxConfPath?: string;
    };

    try {
      switch (action) {
        case "check": {
          const info = await checkCertInfo(domain);
          const isError = info.startsWith("ERROR:");
          return {
            success: !isError,
            message: isError
              ? `❌ 无法获取 ${domain} 的SSL证书: ${info}`
              : `🔒 ${domain} SSL证书信息:\n${info}`,
            data: { domain, certInfo: info },
          };
        }

        case "self_sign": {
          const dir = path.resolve(outputDir);
          await fs.mkdir(dir, { recursive: true });
          const keyFile = path.join(dir, `${domain}.key`);
          const certFile = path.join(dir, `${domain}.crt`);

          const r = await runCmd("powershell", [
            "-NoProfile", "-Command",
            `$cert = New-SelfSignedCertificate -DnsName '${domain}','*.${domain}' -CertStoreLocation 'Cert:\\CurrentUser\\My' -NotAfter (Get-Date).AddDays(${days}) -KeyLength 2048 -KeyAlgorithm RSA -HashAlgorithm SHA256; $pwd = ConvertTo-SecureString -String 'xiniu123' -Force -AsPlainText; $pfxPath = '${path.join(dir, `${domain}.pfx`).replace(/\\/g, "\\\\")}'; Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd | Out-Null; Write-Output "Thumbprint: $($cert.Thumbprint)"; Write-Output "PFX: $pfxPath";`,
          ], dir, 30000);

          if (!r.ok) {
            const r2 = await runCmd("openssl", [
              "req", "-x509", "-newkey", "rsa:2048",
              "-keyout", keyFile, "-out", certFile,
              "-days", String(days), "-nodes",
              "-subj", `/CN=${domain}/O=SelfSigned/C=CN`,
              "-addext", `subjectAltName=DNS:${domain},DNS:*.${domain}`,
            ], dir, 30000);

            if (!r2.ok) {
              return { success: false, message: `❌ 自签名证书生成失败:\nPowerShell: ${r.stderr}\nOpenSSL: ${r2.stderr}` };
            }
            return {
              success: true,
              message: `✅ 自签名证书已生成 (OpenSSL, ${days}天有效)\n📄 证书: ${certFile}\n🔑 私钥: ${keyFile}`,
              data: { certPath: certFile, keyPath: keyFile, days, domain },
            };
          }

          return {
            success: true,
            message: `✅ 自签名证书已生成 (Windows, ${days}天有效)\n${r.stdout}`,
            data: { domain, days, output: r.stdout.trim() },
          };
        }

        case "generate_csr": {
          const dir = path.resolve(outputDir);
          await fs.mkdir(dir, { recursive: true });
          const keyFile = path.join(dir, `${domain}.key`);
          const csrFile = path.join(dir, `${domain}.csr`);

          const r = await runCmd("openssl", [
            "req", "-new", "-newkey", "rsa:2048",
            "-nodes", "-keyout", keyFile, "-out", csrFile,
            "-subj", `/CN=${domain}/O=Organization/C=CN/ST=Province/L=City`,
          ], dir, 30000);

          if (!r.ok) {
            return { success: false, message: `❌ CSR生成失败: ${r.stderr}` };
          }

          const csrContent = await fs.readFile(csrFile, "utf-8");
          return {
            success: true,
            message: `✅ CSR和私钥已生成\n📄 CSR: ${csrFile}\n🔑 私钥: ${keyFile}\n\n将CSR提交给CA机构(如Let's Encrypt/阿里云/腾讯云)即可申请正式证书`,
            data: { csrPath: csrFile, keyPath: keyFile, domain, csr: csrContent.slice(0, 500) },
          };
        }

        case "deploy_iis": {
          if (!certPath) return { success: false, message: "❌ 需要提供 certPath (PFX证书文件路径)" };

          const r = await runCmd("powershell", [
            "-NoProfile", "-Command",
            `Import-Module WebAdministration -ErrorAction SilentlyContinue; $pwd = ConvertTo-SecureString -String 'xiniu123' -Force -AsPlainText; $cert = Import-PfxCertificate -FilePath '${certPath.replace(/\\/g, "\\\\")}' -CertStoreLocation 'Cert:\\LocalMachine\\My' -Password $pwd; Write-Output "Imported: $($cert.Thumbprint)"; $binding = Get-WebBinding -Name 'Default Web Site' -Protocol https -ErrorAction SilentlyContinue; if (-not $binding) { New-WebBinding -Name 'Default Web Site' -Protocol https -Port 443 -HostHeader '${domain}' -SslFlags 1; Write-Output 'Binding created'; } $hash = $cert.Thumbprint; $guid = [guid]::NewGuid().ToString('B'); netsh http add sslcert hostnameport="${domain}:443" certhash=$hash certstorename=MY appid=$guid;`,
          ], undefined, 30000);

          return {
            success: r.ok,
            message: r.ok
              ? `✅ SSL证书已部署到IIS\n域名: ${domain}\n${r.stdout}`
              : `❌ IIS部署失败: ${r.stderr || r.stdout}`,
            data: { domain, output: r.stdout.trim() },
          };
        }

        case "deploy_nginx": {
          if (!certPath || !keyPath) return { success: false, message: "❌ 需要提供 certPath 和 keyPath" };

          const confPath = nginxConfPath || path.join(path.resolve(outputDir), `${domain}.nginx.conf`);
          const conf = `server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain} *.${domain};

    ssl_certificate     ${certPath.replace(/\\/g, "/")};
    ssl_certificate_key ${keyPath.replace(/\\/g, "/")};

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # HSTS (optional)
    add_header Strict-Transport-Security "max-age=63072000" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name ${domain} *.${domain};
    return 301 https://$server_name$request_uri;
}
`;
          await fs.mkdir(path.dirname(confPath), { recursive: true });
          await fs.writeFile(confPath, conf, "utf-8");

          return {
            success: true,
            message: `✅ Nginx SSL配置已生成\n📄 配置文件: ${confPath}\n\n使用方法:\n1. 将配置复制到 /etc/nginx/conf.d/ 或 include 目录\n2. nginx -t 验证配置\n3. nginx -s reload 重载`,
            data: { confPath, domain, certPath, keyPath },
          };
        }

        default:
          return { success: false, message: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, message: `SSL操作异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
