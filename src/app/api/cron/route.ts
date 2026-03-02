import { NextResponse } from "next/server";
import {
  loadTasks, addTask, updateTask, removeTask, toggleTask,
  loadHistory, getTaskHistory,
  registerExecutor, startScheduler,
  type CronTask,
} from "@/lib/cron-manager";
import { getAllSkills } from "@/skills/registry";

let initialized = false;

function ensureScheduler() {
  if (initialized) return;
  initialized = true;

  const skills = getAllSkills();
  registerExecutor(async (skillName, params) => {
    const skill = skills.find((s) => s.name === skillName);
    if (!skill) return { success: false, message: `技能不存在: ${skillName}` };
    try {
      return await skill.execute(params);
    } catch (err) {
      return { success: false, message: `执行异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  startScheduler(15000);
}

export async function GET(req: Request) {
  ensureScheduler();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "list";
  const taskId = url.searchParams.get("taskId");

  try {
    if (action === "history") {
      if (taskId) {
        const history = await getTaskHistory(taskId);
        return NextResponse.json({ success: true, history });
      }
      const history = await loadHistory();
      return NextResponse.json({ success: true, history });
    }

    const tasks = await loadTasks();
    const stats = {
      total: tasks.length,
      enabled: tasks.filter((t) => t.enabled).length,
      running: tasks.filter((t) => t.lastStatus === "running").length,
      success: tasks.filter((t) => t.lastStatus === "success").length,
      failure: tasks.filter((t) => t.lastStatus === "failure").length,
    };
    return NextResponse.json({ success: true, tasks, stats });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  ensureScheduler();

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "add": {
        const taskData = body.task as Omit<CronTask, "id" | "createdAt" | "runCount">;
        if (!taskData.name || !taskData.schedule || !taskData.steps?.length) {
          return NextResponse.json(
            { success: false, message: "缺少必要字段: name, schedule, steps" },
            { status: 400 }
          );
        }
        const newTask = await addTask(taskData);
        return NextResponse.json({ success: true, task: newTask });
      }
      case "update": {
        const { taskId, updates } = body;
        const updated = await updateTask(taskId, updates);
        if (!updated) return NextResponse.json({ success: false, message: "任务不存在" }, { status: 404 });
        return NextResponse.json({ success: true, task: updated });
      }
      case "remove": {
        const removed = await removeTask(body.taskId);
        if (!removed) return NextResponse.json({ success: false, message: "任务不存在" }, { status: 404 });
        return NextResponse.json({ success: true, message: "已删除" });
      }
      case "toggle": {
        const toggled = await toggleTask(body.taskId);
        if (!toggled) return NextResponse.json({ success: false, message: "任务不存在" }, { status: 404 });
        return NextResponse.json({ success: true, message: "状态已切换" });
      }
      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, message: String(err) },
      { status: 500 }
    );
  }
}
