import { z } from "zod";

export interface SkillResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export type SkillCategory = "office" | "dev" | "life" | "creative";

export interface SetupGuide {
  framework: string;
  frameworkUrl: string;
  installCommands?: { label: string; cmd: string; mirror?: string }[];
  configSteps: string[];
  requiredCredentials?: {
    key: string;
    label: string;
    description: string;
    envVar?: string;
  }[];
  healthCheckAction?: string;
  docsUrl?: string;
}

export interface SkillDefinition {
  name: string;
  displayName: string;
  description: string;
  icon: string;
  category?: SkillCategory;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (params: Record<string, unknown>, ctx?: unknown) => Promise<SkillResult>;
  setupGuide?: SetupGuide;
}
