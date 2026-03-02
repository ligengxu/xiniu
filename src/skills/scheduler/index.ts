import { z } from "zod";
import type { SkillDefinition } from "../types";
import {
  addTask, loadTasks, removeTask, toggleTask,
  loadHistory, getTaskHistory, parseSchedule,
  type TaskStep, type TaskCondition,
} from "@/lib/cron-manager";

export const scheduleTaskSkill: SkillDefinition = {
  name: "schedule_task",
  displayName: "创建定时任务",
  description: "创建一个定时/周期执行的任务。支持自然语言时间表达（如 every 5m, every 1h），cron 表达式（如 */10 * * * *），条件判断（仅在特定时间/星期执行），以及多步骤链式任务。agentMode=true 时 AI 会根据中间结果决定是否继续。",
  icon: "CalendarClock",
  category: "dev",
  parameters: z.object({
    name: z.string().describe("任务名称"),
    description: z.string().optional().describe("任务描述"),
    schedule: z.string().describe("执行周期。格式: 'every 5m'(每5分钟), 'every 1h'(每小时), 'every 30s'(每30秒), 或cron表达式如 '*/10 * * * *'"),
    steps: z.array(z.object({
      skillName: z.string().describe("要执行的技能名称"),
      skillParams: z.record(z.string(), z.unknown()).describe("技能参数"),
      onFail: z.enum(["stop", "skip", "retry"]).optional().describe("失败时策略: stop=终止, skip=跳过继续, retry=重试"),
      retryCount: z.number().optional().describe("重试次数，默认2"),
      outputAs: z.string().optional().describe("将结果存为变量名，后续步骤可用 {{变量名}} 引用"),
    })).describe("任务步骤列表，按顺序执行"),
    conditions: z.array(z.object({
      type: z.enum(["time_range", "weekday", "file_exists", "url_reachable", "env_check"]).describe("条件类型"),
      value: z.string().describe("条件值。time_range: '09:00-18:00', weekday: '1,2,3,4,5'(周一到五), file_exists: 文件路径, url_reachable: URL"),
    })).optional().describe("执行条件，全部满足才执行"),
    maxRuns: z.number().optional().describe("最大执行次数，0=无限循环，默认0"),
    agentMode: z.boolean().optional().describe("是否启用AI Agent决策模式，AI根据步骤结果决定是否继续"),
    agentPrompt: z.string().optional().describe("Agent模式下的决策指令"),
  }),
  execute: async (params) => {
    const p = params as {
      name: string; description?: string; schedule: string;
      steps: TaskStep[]; conditions?: TaskCondition[];
      maxRuns?: number; agentMode?: boolean; agentPrompt?: string;
    };

    const parsed = parseSchedule(p.schedule);
    if (!parsed) {
      return { success: false, message: `无法解析时间表达式: "${p.schedule}"。支持格式: "every 5m", "every 1h", "*/10 * * * *"` };
    }

    const task = await addTask({
      name: p.name,
      description: p.description || "",
      schedule: p.schedule,
      steps: p.steps,
      conditions: p.conditions || [],
      enabled: true,
      maxRuns: p.maxRuns ?? 0,
      agentMode: p.agentMode,
      agentPrompt: p.agentPrompt,
    });

    const intervalDesc = parsed.intervalMs >= 3600000
      ? `${Math.round(parsed.intervalMs / 3600000)}小时`
      : parsed.intervalMs >= 60000
        ? `${Math.round(parsed.intervalMs / 60000)}分钟`
        : `${Math.round(parsed.intervalMs / 1000)}秒`;

    return {
      success: true,
      message: `定时任务已创建: "${task.name}"\n` +
        `ID: ${task.id}\n` +
        `周期: 每 ${intervalDesc}\n` +
        `步骤数: ${task.steps.length}\n` +
        `条件数: ${task.conditions.length}\n` +
        `最大执行次数: ${task.maxRuns || '无限'}\n` +
        `Agent模式: ${task.agentMode ? '启用' : '关闭'}\n` +
        `下次执行: ${task.nextRun}`,
      data: { taskId: task.id, nextRun: task.nextRun },
    };
  },
};

export const listSchedulesSkill: SkillDefinition = {
  name: "list_schedules",
  displayName: "查看定时任务",
  description: "列出所有定时任务及其状态、执行历史。可以查看特定任务的详细历史记录。",
  icon: "ListTodo",
  category: "dev",
  parameters: z.object({
    taskId: z.string().optional().describe("指定任务ID查看其详细历史。不填则列出所有任务概览"),
  }),
  execute: async (params) => {
    const { taskId } = params as { taskId?: string };

    if (taskId) {
      const history = await getTaskHistory(taskId);
      if (history.length === 0) {
        return { success: true, message: `任务 ${taskId} 暂无执行记录` };
      }
      const lines = history.map((h) => {
        const steps = h.stepResults.map((s) => `  ${s.step}. ${s.skill}: ${s.success ? '✓' : '✗'} (${s.duration}ms)`).join("\n");
        return `[${h.startTime}] ${h.status} (${h.duration}ms)\n${steps}`;
      });
      return {
        success: true,
        message: `任务 ${taskId} 执行历史 (最近${history.length}条):\n\n${lines.join("\n\n")}`,
        data: { history },
      };
    }

    const tasks = await loadTasks();
    if (tasks.length === 0) {
      return { success: true, message: "暂无定时任务" };
    }

    const lines = tasks.map((t) => {
      const status = t.enabled ? "✅启用" : "⏸️暂停";
      const lastInfo = t.lastRun ? `上次: ${t.lastStatus} @ ${t.lastRun}` : "未执行过";
      return `[${t.id}] ${t.name} | ${status} | 周期: ${t.schedule} | 已执行: ${t.runCount}次 | ${lastInfo}`;
    });

    return {
      success: true,
      message: `定时任务列表 (${tasks.length}个):\n\n${lines.join("\n")}`,
      data: { tasks },
    };
  },
};

export const cancelScheduleSkill: SkillDefinition = {
  name: "cancel_schedule",
  displayName: "管理定时任务",
  description: "删除、暂停或恢复定时任务。",
  icon: "CalendarX",
  category: "dev",
  parameters: z.object({
    taskId: z.string().describe("任务ID"),
    action: z.enum(["delete", "toggle"]).describe("操作: delete=删除任务, toggle=暂停/恢复"),
  }),
  execute: async (params) => {
    const { taskId, action } = params as { taskId: string; action: "delete" | "toggle" };

    if (action === "delete") {
      const removed = await removeTask(taskId);
      if (!removed) return { success: false, message: `任务 ${taskId} 不存在` };
      return { success: true, message: `已删除定时任务: ${taskId}` };
    }

    const toggled = await toggleTask(taskId);
    if (!toggled) return { success: false, message: `任务 ${taskId} 不存在` };
    return { success: true, message: `已切换任务 ${taskId} 的启用状态` };
  },
};
