"use client";

import { useState } from "react";
import {
  X, ExternalLink, Download, CheckCircle2,
  XCircle, Loader2, ChevronRight, Copy, Check, Globe,
} from "lucide-react";

interface InstallCmd {
  label: string;
  cmd: string;
  mirror?: string;
}

interface CredentialDef {
  key: string;
  label: string;
  description: string;
  envVar?: string;
}

interface SetupGuideData {
  framework: string;
  frameworkUrl: string;
  installCommands?: InstallCmd[];
  configSteps: string[];
  requiredCredentials?: CredentialDef[];
  healthCheckAction?: string;
  docsUrl?: string;
}

interface Props {
  skillName: string;
  displayName: string;
  guide: SetupGuideData;
  onClose: () => void;
}

type StepId = "install" | "config" | "check";

export function SkillSetupGuide({ skillName, displayName, guide, onClose }: Props) {
  const [activeStep, setActiveStep] = useState<StepId>("install");
  const [installLog, setInstallLog] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installOk, setInstallOk] = useState<boolean | null>(null);
  const [useMirror, setUseMirror] = useState(true);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  const [credSaved, setCredSaved] = useState(false);

  const steps: { id: StepId; label: string; num: number }[] = [
    { id: "install", label: "安装依赖", num: 1 },
    { id: "config", label: "配置凭证", num: 2 },
    { id: "check", label: "检测连接", num: 3 },
  ];

  async function handleInstall(cmd: InstallCmd) {
    setInstalling(true);
    setInstallLog("正在安装...\n");
    setInstallOk(null);
    try {
      const resp = await fetch("/api/skills/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install",
          command: cmd.cmd,
          mirrorCommand: cmd.mirror,
          useMirror: useMirror && !!cmd.mirror,
        }),
      });
      const data = await resp.json();
      setInstallLog(data.output || data.message || "完成");
      setInstallOk(data.success);
    } catch (err) {
      setInstallLog(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
      setInstallOk(false);
    } finally {
      setInstalling(false);
    }
  }

  async function handleCheck() {
    setChecking(true);
    setCheckResult(null);
    try {
      const resp = await fetch("/api/skills/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check",
          skillName,
          checkAction: guide.healthCheckAction || "check_status",
        }),
      });
      const data = await resp.json();
      setCheckResult({ ok: data.success, msg: data.message });
    } catch (err) {
      setCheckResult({ ok: false, msg: `检测失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setChecking(false);
    }
  }

  async function handleSaveCreds() {
    if (!guide.requiredCredentials) return;
    for (const cred of guide.requiredCredentials) {
      const val = credValues[cred.key];
      if (!val) continue;
      await fetch("/api/skills/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "credential",
          type: "api",
          label: `${displayName} - ${cred.label}`,
          host: guide.frameworkUrl,
          username: cred.key,
          password: val,
          extra: cred.envVar ? { envVar: cred.envVar } : undefined,
        }),
      });
    }
    setCredSaved(true);
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div>
            <h2 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {displayName} - 对接设置
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{guide.framework}</span>
              <a
                href={guide.frameworkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] flex items-center gap-0.5 hover:underline"
                style={{ color: "var(--accent)" }}
              >
                <ExternalLink className="h-2.5 w-2.5" /> 官网
              </a>
              {guide.docsUrl && (
                <a
                  href={guide.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] flex items-center gap-0.5 hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  <ExternalLink className="h-2.5 w-2.5" /> 文档
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:opacity-70" style={{ color: "var(--text-muted)" }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step Tabs */}
        <div className="flex border-b px-6" style={{ borderColor: "var(--border)" }}>
          {steps.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStep(s.id)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors"
              style={{
                borderBottom: activeStep === s.id ? "2px solid var(--accent)" : "2px solid transparent",
                color: activeStep === s.id ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <span
                className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{
                  background: activeStep === s.id ? "var(--accent)" : "var(--surface-elevated)",
                  color: activeStep === s.id ? "white" : "var(--text-muted)",
                }}
              >
                {s.num}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-5 space-y-4">
          {/* Step 1: Install */}
          {activeStep === "install" && (
            <>
              {guide.installCommands && guide.installCommands.length > 0 ? (
                <>
                  {guide.installCommands.some((c) => c.mirror) && (
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                      <input
                        type="checkbox"
                        checked={useMirror}
                        onChange={(e) => setUseMirror(e.target.checked)}
                        className="rounded"
                      />
                      <Globe className="h-3 w-3" />
                      使用国内镜像源加速
                    </label>
                  )}
                  <div className="space-y-2">
                    {guide.installCommands.map((cmd, i) => (
                      <div key={i} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--surface-elevated)" }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>{cmd.label}</span>
                          <div className="flex gap-1">
                            <button
                              onClick={() => copyToClipboard(useMirror && cmd.mirror ? cmd.mirror : cmd.cmd, `cmd-${i}`)}
                              className="p-1 rounded hover:opacity-70"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {copied === `cmd-${i}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </button>
                            <button
                              onClick={() => handleInstall(cmd)}
                              disabled={installing}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
                              style={{ background: "var(--accent)", color: "white" }}
                            >
                              {installing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                              一键安装
                            </button>
                          </div>
                        </div>
                        <code className="block text-[11px] font-mono break-all" style={{ color: "var(--text-muted)" }}>
                          {useMirror && cmd.mirror ? cmd.mirror : cmd.cmd}
                        </code>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>此技能无需安装额外依赖</p>
              )}

              {installLog && (
                <pre
                  className="rounded-lg border p-3 text-[10px] font-mono max-h-40 overflow-y-auto whitespace-pre-wrap"
                  style={{
                    borderColor: installOk === true ? "var(--success)" : installOk === false ? "var(--error)" : "var(--border)",
                    background: "var(--background)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {installLog}
                </pre>
              )}

              {installOk !== null && (
                <div className="flex items-center gap-2 text-xs" style={{ color: installOk ? "var(--success)" : "var(--error)" }}>
                  {installOk ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {installOk ? "安装成功" : "安装失败，请查看上方日志"}
                </div>
              )}

              <div className="pt-2">
                <h4 className="text-[11px] font-medium mb-2" style={{ color: "var(--text-primary)" }}>配置步骤</h4>
                <ol className="space-y-1.5">
                  {guide.configSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                      <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />
                      {step}
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}

          {/* Step 2: Credentials */}
          {activeStep === "config" && (
            <>
              {guide.requiredCredentials && guide.requiredCredentials.length > 0 ? (
                <div className="space-y-3">
                  {guide.requiredCredentials.map((cred) => (
                    <div key={cred.key}>
                      <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-primary)" }}>
                        {cred.label}
                        {cred.envVar && (
                          <span className="ml-1 text-[9px] font-normal" style={{ color: "var(--text-muted)" }}>
                            (环境变量: {cred.envVar})
                          </span>
                        )}
                      </label>
                      <p className="text-[10px] mb-1" style={{ color: "var(--text-muted)" }}>{cred.description}</p>
                      <input
                        type="password"
                        placeholder={`输入 ${cred.label}`}
                        value={credValues[cred.key] || ""}
                        onChange={(e) => setCredValues({ ...credValues, [cred.key]: e.target.value })}
                        className="w-full rounded-lg border px-3 py-2 text-xs outline-none transition-colors focus:ring-1"
                        style={{
                          borderColor: "var(--border)",
                          background: "var(--background)",
                          color: "var(--text-primary)",
                        }}
                      />
                    </div>
                  ))}
                  <button
                    onClick={handleSaveCreds}
                    disabled={credSaved}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                    style={{
                      background: credSaved ? "var(--success)" : "var(--accent)",
                      color: "white",
                    }}
                  >
                    {credSaved ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                    {credSaved ? "已保存" : "保存凭证"}
                  </button>
                  {credSaved && (
                    <p className="text-[10px]" style={{ color: "var(--success)" }}>
                      凭证已加密保存到本地，下次使用时自动加载
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>此技能无需配置凭证</p>
              )}
            </>
          )}

          {/* Step 3: Check */}
          {activeStep === "check" && (
            <>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                点击下方按钮检测技能是否能正常连接到对应服务
              </p>
              <button
                onClick={handleCheck}
                disabled={checking}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {checking ? "检测中..." : "检测连接"}
              </button>

              {checkResult && (
                <div
                  className="rounded-lg border p-4"
                  style={{
                    borderColor: checkResult.ok ? "var(--success)" : "var(--error)",
                    background: checkResult.ok
                      ? "color-mix(in srgb, var(--success) 8%, transparent)"
                      : "color-mix(in srgb, var(--error) 8%, transparent)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {checkResult.ok ? (
                      <CheckCircle2 className="h-4 w-4" style={{ color: "var(--success)" }} />
                    ) : (
                      <XCircle className="h-4 w-4" style={{ color: "var(--error)" }} />
                    )}
                    <span
                      className="text-xs font-medium"
                      style={{ color: checkResult.ok ? "var(--success)" : "var(--error)" }}
                    >
                      {checkResult.ok ? "连接成功" : "连接失败"}
                    </span>
                  </div>
                  <pre
                    className="text-[10px] font-mono whitespace-pre-wrap max-h-60 overflow-y-auto"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {checkResult.msg}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
