import fs from "fs/promises";
import path from "path";
import os from "os";

// ---------- Types ----------

export type TaskStatus = "idle" | "running" | "success" | "failure" | "skipped";

export interface TaskCondition {
  type: "time_range" | "weekday" | "env_check" | "url_reachable" | "file_exists" | "custom_js";
  value: string;
}

export interface TaskStep {
  skillName: string;
  skillParams: Record<string, unknown>;
  onFail?: "stop" | "skip" | "retry";
  retryCount?: number;
  outputAs?: string;
}

export interface CronTask {
  id: string;
  name: string;
  description: string;
  schedule: string; // cron expression or interval like "every 5m", "every 1h"
  steps: TaskStep[];
  conditions: TaskCondition[];
  enabled: boolean;
  maxRuns?: number; // 0 = infinite
  createdAt: string;
  updatedAt?: string;
  lastRun?: string;
  lastStatus?: TaskStatus;
  runCount: number;
  nextRun?: string;
  tags?: string[];
  agentMode?: boolean; // AI decides whether to proceed based on step results
  agentPrompt?: string; // instructions for AI decision making
}

export interface CronHistory {
  id: string;
  taskId: string;
  taskName: string;
  startTime: string;
  endTime: string;
  status: TaskStatus;
  stepResults: { step: number; skill: string; success: boolean; message: string; duration: number }[];
  conditionsMet: boolean;
  skippedReason?: string;
  duration: number;
}

// ---------- Storage ----------

const CRON_DIR = path.join(os.homedir(), ".xiniu", "scheduler");
const TASKS_FILE = path.join(CRON_DIR, "tasks.json");
const HISTORY_FILE = path.join(CRON_DIR, "history.json");

async function ensureDir() {
  await fs.mkdir(CRON_DIR, { recursive: true });
}

export async function loadTasks(): Promise<CronTask[]> {
  await ensureDir();
  try {
    const data = await fs.readFile(TASKS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveTasks(tasks: CronTask[]) {
  await ensureDir();
  await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), "utf-8");
}

export async function addTask(task: Omit<CronTask, "id" | "createdAt" | "runCount">): Promise<CronTask> {
  const tasks = await loadTasks();
  const newTask: CronTask = {
    ...task,
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    runCount: 0,
  };
  newTask.nextRun = calculateNextRun(newTask.schedule);
  tasks.push(newTask);
  await saveTasks(tasks);
  return newTask;
}

export async function updateTask(taskId: string, updates: Partial<CronTask>): Promise<CronTask | null> {
  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  if (updates.schedule) {
    tasks[idx].nextRun = calculateNextRun(updates.schedule);
  }
  await saveTasks(tasks);
  return tasks[idx];
}

export async function removeTask(taskId: string): Promise<boolean> {
  const tasks = await loadTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  await saveTasks(filtered);
  return true;
}

export async function toggleTask(taskId: string): Promise<boolean> {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return false;
  task.enabled = !task.enabled;
  if (task.enabled) task.nextRun = calculateNextRun(task.schedule);
  await saveTasks(tasks);
  return true;
}

export async function loadHistory(limit = 200): Promise<CronHistory[]> {
  await ensureDir();
  try {
    const data = await fs.readFile(HISTORY_FILE, "utf-8");
    const all: CronHistory[] = JSON.parse(data);
    return all.slice(-limit);
  } catch {
    return [];
  }
}

export async function addHistory(entry: CronHistory) {
  const history = await loadHistory(9999);
  history.push(entry);
  if (history.length > 5000) history.splice(0, history.length - 5000);
  await ensureDir();
  await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
}

export async function getTaskHistory(taskId: string, limit = 50): Promise<CronHistory[]> {
  const history = await loadHistory(9999);
  return history.filter((h) => h.taskId === taskId).slice(-limit);
}

// ---------- Schedule Parsing ----------

export function parseSchedule(schedule: string): { intervalMs: number } | null {
  const s = schedule.trim().toLowerCase();

  const intervalMatch = s.match(/^every\s+(\d+)\s*(s|sec|second|m|min|minute|h|hr|hour|d|day)s?$/);
  if (intervalMatch) {
    const num = parseInt(intervalMatch[1]);
    const unit = intervalMatch[2][0];
    const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    return { intervalMs: num * (multipliers[unit] || 60000) };
  }

  const cronParts = s.split(/\s+/);
  if (cronParts.length === 5) {
    return { intervalMs: cronToIntervalMs(cronParts) };
  }

  return null;
}

function cronToIntervalMs(parts: string[]): number {
  const [min, hour] = parts;
  if (min === "*" && hour === "*") return 60000;
  if (min.startsWith("*/")) return parseInt(min.slice(2)) * 60000;
  if (hour.startsWith("*/")) return parseInt(hour.slice(2)) * 3600000;
  if (min !== "*" && hour !== "*") return 86400000;
  if (hour !== "*") return 3600000;
  return 60000;
}

export function calculateNextRun(schedule: string): string {
  const parsed = parseSchedule(schedule);
  if (!parsed) return new Date(Date.now() + 60000).toISOString();
  return new Date(Date.now() + parsed.intervalMs).toISOString();
}

// ---------- Condition Evaluation ----------

export async function evaluateConditions(conditions: TaskCondition[]): Promise<{ met: boolean; reason?: string }> {
  for (const cond of conditions) {
    const result = await evaluateCondition(cond);
    if (!result.met) return result;
  }
  return { met: true };
}

async function evaluateCondition(cond: TaskCondition): Promise<{ met: boolean; reason?: string }> {
  try {
    switch (cond.type) {
      case "time_range": {
        const [start, end] = cond.value.split("-").map((s) => s.trim());
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const nowMin = h * 60 + m;
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        if (nowMin < startMin || nowMin > endMin) {
          return { met: false, reason: `当前时间 ${h}:${String(m).padStart(2, "0")} 不在 ${cond.value} 范围内` };
        }
        return { met: true };
      }
      case "weekday": {
        const days = cond.value.split(",").map((d) => parseInt(d.trim()));
        const today = new Date().getDay();
        if (!days.includes(today)) {
          return { met: false, reason: `今天是周${today}，不在允许日期 [${cond.value}] 内` };
        }
        return { met: true };
      }
      case "file_exists": {
        try {
          await fs.access(cond.value);
          return { met: true };
        } catch {
          return { met: false, reason: `文件不存在: ${cond.value}` };
        }
      }
      case "url_reachable": {
        try {
          const res = await fetch(cond.value, { method: "HEAD", signal: AbortSignal.timeout(5000) });
          if (!res.ok) return { met: false, reason: `URL 不可达: ${cond.value} (${res.status})` };
          return { met: true };
        } catch {
          return { met: false, reason: `URL 不可达: ${cond.value}` };
        }
      }
      case "env_check": {
        const [key, expected] = cond.value.split("=").map((s) => s.trim());
        const actual = process.env[key];
        if (expected && actual !== expected) {
          return { met: false, reason: `环境变量 ${key} 值不匹配 (期望: ${expected}, 实际: ${actual})` };
        }
        if (!expected && !actual) {
          return { met: false, reason: `环境变量 ${key} 未设置` };
        }
        return { met: true };
      }
      case "custom_js": {
        const fn = new Function("return " + cond.value);
        const result = await fn();
        if (!result) return { met: false, reason: `自定义条件不满足: ${cond.value}` };
        return { met: true };
      }
      default:
        return { met: true };
    }
  } catch (err) {
    return { met: false, reason: `条件评估异常: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------- Scheduler Engine ----------

type SkillExecutor = (skillName: string, params: Record<string, unknown>) => Promise<{ success: boolean; message: string }>;
type AgentDecider = (taskName: string, stepResults: CronHistory["stepResults"], prompt: string) => Promise<{ proceed: boolean; reason: string }>;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let executorFn: SkillExecutor | null = null;
let agentFn: AgentDecider | null = null;

export function registerExecutor(fn: SkillExecutor) {
  executorFn = fn;
}

export function registerAgentDecider(fn: AgentDecider) {
  agentFn = fn;
}

export function startScheduler(intervalMs = 15000) {
  if (schedulerTimer) return;
  console.log("[scheduler] 定时任务调度器已启动，检查间隔:", intervalMs, "ms");
  schedulerTimer = setInterval(() => tick(), intervalMs);
  tick();
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[scheduler] 调度器已停止");
  }
}

async function tick() {
  try {
    const tasks = await loadTasks();
    const now = Date.now();

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (task.maxRuns && task.maxRuns > 0 && task.runCount >= task.maxRuns) continue;
      if (task.lastStatus === "running") continue;

      const nextRun = task.nextRun ? new Date(task.nextRun).getTime() : 0;
      if (nextRun > now) continue;

      executeTask(task).catch((err) => {
        console.error(`[scheduler] 任务 ${task.name} 执行异常:`, err);
      });
    }
  } catch (err) {
    console.error("[scheduler] tick 异常:", err);
  }
}

async function executeTask(task: CronTask) {
  if (!executorFn) {
    console.warn("[scheduler] 未注册技能执行器，跳过任务:", task.name);
    return;
  }

  const historyId = `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const startTime = new Date().toISOString();
  const stepResults: CronHistory["stepResults"] = [];

  const tasks = await loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx !== -1) {
    tasks[idx].lastStatus = "running";
    await saveTasks(tasks);
  }

  const condResult = await evaluateConditions(task.conditions || []);
  if (!condResult.met) {
    const endTime = new Date().toISOString();
    await addHistory({
      id: historyId,
      taskId: task.id,
      taskName: task.name,
      startTime,
      endTime,
      status: "skipped",
      stepResults: [],
      conditionsMet: false,
      skippedReason: condResult.reason,
      duration: Date.now() - new Date(startTime).getTime(),
    });

    const tasksAfter = await loadTasks();
    const idxAfter = tasksAfter.findIndex((t) => t.id === task.id);
    if (idxAfter !== -1) {
      tasksAfter[idxAfter].lastStatus = "skipped";
      tasksAfter[idxAfter].lastRun = startTime;
      tasksAfter[idxAfter].nextRun = calculateNextRun(task.schedule);
      await saveTasks(tasksAfter);
    }
    return;
  }

  let overallSuccess = true;
  const context: Record<string, string> = {};

  for (let i = 0; i < task.steps.length; i++) {
    const step = task.steps[i];
    const stepStart = Date.now();

    const resolvedParams: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step.skillParams)) {
      if (typeof v === "string") {
        resolvedParams[k] = v.replace(/\{\{(\w+)\}\}/g, (_, key) => context[key] || "");
      } else {
        resolvedParams[k] = v;
      }
    }

    let result: { success: boolean; message: string };
    let attempts = 0;
    const maxAttempts = step.onFail === "retry" ? (step.retryCount || 2) : 1;

    do {
      attempts++;
      result = await executorFn(step.skillName, resolvedParams);
    } while (!result.success && attempts < maxAttempts);

    const stepDuration = Date.now() - stepStart;
    stepResults.push({
      step: i + 1,
      skill: step.skillName,
      success: result.success,
      message: result.message.substring(0, 500),
      duration: stepDuration,
    });

    if (step.outputAs) {
      context[step.outputAs] = result.message;
    }

    if (!result.success) {
      if (step.onFail === "stop") {
        overallSuccess = false;
        break;
      }
      if (step.onFail === "skip") continue;
      overallSuccess = false;
      break;
    }

    if (task.agentMode && agentFn && i < task.steps.length - 1) {
      const decision = await agentFn(
        task.name,
        stepResults,
        task.agentPrompt || "根据已完成步骤的结果，判断是否继续执行后续步骤",
      );
      if (!decision.proceed) {
        stepResults.push({
          step: i + 2,
          skill: "agent_decision",
          success: true,
          message: `AI 决定终止: ${decision.reason}`,
          duration: 0,
        });
        break;
      }
    }
  }

  const endTime = new Date().toISOString();
  const duration = Date.now() - new Date(startTime).getTime();
  const finalStatus: TaskStatus = overallSuccess ? "success" : "failure";

  await addHistory({
    id: historyId,
    taskId: task.id,
    taskName: task.name,
    startTime,
    endTime,
    status: finalStatus,
    stepResults,
    conditionsMet: true,
    duration,
  });

  const tasksAfter = await loadTasks();
  const idxAfter = tasksAfter.findIndex((t) => t.id === task.id);
  if (idxAfter !== -1) {
    tasksAfter[idxAfter].lastStatus = finalStatus;
    tasksAfter[idxAfter].lastRun = startTime;
    tasksAfter[idxAfter].runCount++;
    tasksAfter[idxAfter].nextRun = calculateNextRun(task.schedule);
    if (tasksAfter[idxAfter].maxRuns && tasksAfter[idxAfter].runCount >= tasksAfter[idxAfter].maxRuns!) {
      tasksAfter[idxAfter].enabled = false;
    }
    await saveTasks(tasksAfter);
  }
}
