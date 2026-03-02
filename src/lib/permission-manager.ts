export type RiskLevel = "safe" | "moderate" | "dangerous";

const DEFAULT_RISK_LEVELS: Record<string, RiskLevel> = {
  browse_webpage: "safe",
  summarize_webpage: "safe",
  open_webpage: "safe",
  web_search: "safe",
  analyze_file: "safe",
  generate_word: "safe",
  generate_excel: "safe",
  generate_ppt: "safe",
  generate_pdf: "safe",

  create_folder: "moderate",
  create_txt: "moderate",
  download_file: "moderate",
  download_images: "moderate",

  run_code: "dangerous",
  batch_files: "dangerous",
};

let customRiskLevels: Record<string, RiskLevel> = {};

try {
  const stored = typeof window !== "undefined"
    ? localStorage.getItem("xiniu-risk-levels")
    : null;
  if (stored) customRiskLevels = JSON.parse(stored);
} catch { /* noop */ }

export function getRiskLevel(skillName: string): RiskLevel {
  return customRiskLevels[skillName] || DEFAULT_RISK_LEVELS[skillName] || "moderate";
}

export function setRiskLevel(skillName: string, level: RiskLevel) {
  customRiskLevels[skillName] = level;
  try {
    localStorage.setItem("xiniu-risk-levels", JSON.stringify(customRiskLevels));
  } catch { /* noop */ }
}

export function getAllRiskLevels(): Record<string, RiskLevel> {
  return { ...DEFAULT_RISK_LEVELS, ...customRiskLevels };
}

export function needsApproval(skillName: string): boolean {
  const level = getRiskLevel(skillName);
  return level === "moderate" || level === "dangerous";
}

export function isDangerous(skillName: string): boolean {
  return getRiskLevel(skillName) === "dangerous";
}
