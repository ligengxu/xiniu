import { z } from "zod";
import type { SkillDefinition } from "../types";

interface AdbDevice {
  serial: string;
  state: string;
  model?: string;
  android?: string;
}

async function runAdb(args: string[], serial?: string, timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const fullArgs = serial ? ["-s", serial, ...args] : args;
    const { stdout, stderr } = await execFileAsync("adb", fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT")) {
      return { ok: false, stdout: "", stderr: "❌ 未找到 adb 命令。请安装 Android SDK Platform Tools 并添加到 PATH。\n下载: https://developer.android.com/tools/releases/platform-tools" };
    }
    return { ok: false, stdout: "", stderr: msg };
  }
}

async function listDevices(): Promise<AdbDevice[]> {
  const res = await runAdb(["devices", "-l"]);
  if (!res.ok) return [];

  const devices: AdbDevice[] = [];
  for (const line of res.stdout.split("\n")) {
    const match = line.match(/^(\S+)\s+(device|offline|unauthorized)\s*(.*)/);
    if (!match) continue;
    const serial = match[1];
    const state = match[2];
    const extras = match[3] || "";
    const modelMatch = extras.match(/model:(\S+)/);
    devices.push({ serial, state, model: modelMatch?.[1] });
  }

  for (const dev of devices) {
    if (dev.state === "device") {
      const verRes = await runAdb(["shell", "getprop", "ro.build.version.release"], dev.serial);
      if (verRes.ok) dev.android = verRes.stdout;
    }
  }

  return devices;
}

async function getDeviceInfo(serial: string): Promise<Record<string, string>> {
  const props = [
    ["型号", "ro.product.model"],
    ["品牌", "ro.product.brand"],
    ["Android版本", "ro.build.version.release"],
    ["SDK版本", "ro.build.version.sdk"],
    ["设备名", "ro.product.device"],
    ["序列号", "ro.serialno"],
    ["CPU架构", "ro.product.cpu.abi"],
    ["屏幕密度", "ro.sf.lcd_density"],
  ];

  const info: Record<string, string> = {};
  for (const [label, prop] of props) {
    const res = await runAdb(["shell", "getprop", prop], serial);
    if (res.ok && res.stdout) info[label] = res.stdout;
  }

  const resolutionRes = await runAdb(["shell", "wm", "size"], serial);
  if (resolutionRes.ok) {
    const m = resolutionRes.stdout.match(/(\d+x\d+)/);
    if (m) info["分辨率"] = m[1];
  }

  const batteryRes = await runAdb(["shell", "dumpsys", "battery"], serial);
  if (batteryRes.ok) {
    const levelMatch = batteryRes.stdout.match(/level:\s*(\d+)/);
    const statusMatch = batteryRes.stdout.match(/status:\s*(\d+)/);
    if (levelMatch) {
      const statusMap: Record<string, string> = { "2": "充电中", "3": "放电中", "4": "未充电", "5": "已充满" };
      const statusText = statusMap[statusMatch?.[1] || ""] || "未知";
      info["电量"] = `${levelMatch[1]}% (${statusText})`;
    }
  }

  const memRes = await runAdb(["shell", "cat", "/proc/meminfo"], serial);
  if (memRes.ok) {
    const totalMatch = memRes.stdout.match(/MemTotal:\s*(\d+)/);
    const availMatch = memRes.stdout.match(/MemAvailable:\s*(\d+)/);
    if (totalMatch && availMatch) {
      const totalMB = Math.round(parseInt(totalMatch[1]) / 1024);
      const availMB = Math.round(parseInt(availMatch[1]) / 1024);
      info["内存"] = `${availMB}MB / ${totalMB}MB 可用`;
    }
  }

  const storageRes = await runAdb(["shell", "df", "/data"], serial);
  if (storageRes.ok) {
    const lines = storageRes.stdout.split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      if (parts.length >= 4) {
        const totalGB = (parseInt(parts[1]) / 1024 / 1024).toFixed(1);
        const usedGB = (parseInt(parts[2]) / 1024 / 1024).toFixed(1);
        const availGB = (parseInt(parts[3]) / 1024 / 1024).toFixed(1);
        info["存储"] = `已用 ${usedGB}GB / 共 ${totalGB}GB (可用 ${availGB}GB)`;
      }
    }
  }

  return info;
}

async function pickSerial(serial?: string): Promise<{ ok: boolean; serial: string; error?: string }> {
  if (serial) return { ok: true, serial };

  const devices = await listDevices();
  const online = devices.filter((d) => d.state === "device");
  if (online.length === 0) {
    return { ok: false, serial: "", error: "❌ 没有已连接的设备。请用 USB 连接手机并启用 USB 调试，或通过 connect 操作连接无线设备。" };
  }
  if (online.length === 1) return { ok: true, serial: online[0].serial };
  return { ok: false, serial: "", error: `⚠️ 检测到 ${online.length} 台设备，请通过 serial 参数指定设备:\n${online.map((d) => `  - ${d.serial} (${d.model || "未知"})`).join("\n")}` };
}

async function takeScreenshot(serial: string, savePath?: string): Promise<{ ok: boolean; path: string; message: string }> {
  const remotePath = "/sdcard/xiniu_screenshot.png";
  const pullRes = await runAdb(["shell", "screencap", "-p", remotePath], serial);
  if (!pullRes.ok) return { ok: false, path: "", message: `截图失败: ${pullRes.stderr}` };

  const path = await import("path");
  const localPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", `phone_screenshot_${Date.now()}.png`);

  const pullFileRes = await runAdb(["pull", remotePath, localPath], serial);
  if (!pullFileRes.ok) return { ok: false, path: "", message: `拉取截图失败: ${pullFileRes.stderr}` };

  await runAdb(["shell", "rm", remotePath], serial);
  return { ok: true, path: localPath, message: `📸 截图已保存: ${localPath}` };
}

async function tapScreen(serial: string, x: number, y: number): Promise<string> {
  const res = await runAdb(["shell", "input", "tap", String(x), String(y)], serial);
  return res.ok ? `👆 已点击坐标 (${x}, ${y})` : `点击失败: ${res.stderr}`;
}

async function swipeScreen(serial: string, x1: number, y1: number, x2: number, y2: number, duration: number): Promise<string> {
  const res = await runAdb(["shell", "input", "swipe", String(x1), String(y1), String(x2), String(y2), String(duration)], serial);
  return res.ok ? `👆 已滑动 (${x1},${y1}) → (${x2},${y2}) 持续${duration}ms` : `滑动失败: ${res.stderr}`;
}

async function inputText(serial: string, text: string): Promise<string> {
  const isAscii = /^[\x20-\x7e]+$/.test(text);

  if (isAscii) {
    const escaped = text.replace(/ /g, "%s").replace(/[&|<>()]/g, "\\$&");
    const res = await runAdb(["shell", "input", "text", escaped], serial);
    if (res.ok) return `⌨️ 已输入文本: ${text}`;
    return `❌ 输入失败: ${res.stderr}`;
  }

  const adbKbRes = await runAdb(["shell", "am", "broadcast", "-a", "ADB_INPUT_TEXT", "--es", "msg", text], serial);
  if (adbKbRes.ok && !adbKbRes.stdout.includes("No receivers")) {
    return `⌨️ 已输入文本(ADBKeyboard): ${text}`;
  }

  const clipRes = await runAdb(["shell", `service call clipboard 2 i32 1 i32 ${text.length} s16 '${text.replace(/'/g, "'\\''")}'`], serial);
  if (clipRes.ok) {
    const pasteRes = await runAdb(["shell", "input", "keyevent", "279"], serial);
    if (pasteRes.ok) return `⌨️ 已输入文本(剪贴板): ${text}`;
  }

  return (
    `❌ 中文输入需要ADBKeyboard辅助\n━━━━━━━━━━━━━━━━━━━━\n` +
    `adb shell input text 不支持非ASCII字符。\n\n` +
    `💡 安装ADBKeyboard:\n` +
    `1. 下载: https://github.com/nicossun/adbkeyboard/releases\n` +
    `2. adb install ADBKeyboard.apk\n` +
    `3. adb shell ime set com.android.adbkeyboard/.AdbIME\n` +
    `4. 重新执行本命令即可`
  );
}

async function pressKey(serial: string, keycode: string): Promise<string> {
  const keyMap: Record<string, string> = {
    home: "KEYCODE_HOME", back: "KEYCODE_BACK", recent: "KEYCODE_APP_SWITCH",
    menu: "KEYCODE_MENU", power: "KEYCODE_POWER", enter: "KEYCODE_ENTER",
    delete: "KEYCODE_DEL", tab: "KEYCODE_TAB", up: "KEYCODE_DPAD_UP",
    down: "KEYCODE_DPAD_DOWN", left: "KEYCODE_DPAD_LEFT", right: "KEYCODE_DPAD_RIGHT",
    volume_up: "KEYCODE_VOLUME_UP", volume_down: "KEYCODE_VOLUME_DOWN",
    mute: "KEYCODE_VOLUME_MUTE", camera: "KEYCODE_CAMERA",
    play_pause: "KEYCODE_MEDIA_PLAY_PAUSE", next: "KEYCODE_MEDIA_NEXT",
    prev: "KEYCODE_MEDIA_PREVIOUS", lock: "KEYCODE_SLEEP", unlock: "KEYCODE_WAKEUP",
  };

  const code = keyMap[keycode.toLowerCase()] || keycode;
  const res = await runAdb(["shell", "input", "keyevent", code], serial);
  return res.ok ? `🔘 已按键: ${keycode} (${code})` : `按键失败: ${res.stderr}`;
}

async function installApp(serial: string, apkPath: string): Promise<string> {
  const fs = await import("fs");
  if (!fs.existsSync(apkPath)) return `❌ APK文件不存在: ${apkPath}`;

  const res = await runAdb(["install", "-r", apkPath], serial);
  return res.ok ? `✅ 应用安装成功: ${apkPath}` : `❌ 安装失败: ${res.stderr}`;
}

async function uninstallApp(serial: string, packageName: string): Promise<string> {
  const res = await runAdb(["shell", "pm", "uninstall", packageName], serial);
  return res.ok ? `✅ 已卸载: ${packageName}` : `❌ 卸载失败: ${res.stderr}`;
}

async function listApps(serial: string, filter?: string): Promise<string> {
  const res = await runAdb(["shell", "pm", "list", "packages", "-3"], serial);
  if (!res.ok) return `❌ 获取应用列表失败: ${res.stderr}`;

  let packages = res.stdout
    .split("\n")
    .map((l) => l.replace("package:", "").trim())
    .filter(Boolean);

  if (filter) {
    const lf = filter.toLowerCase();
    packages = packages.filter((p) => p.toLowerCase().includes(lf));
  }

  if (packages.length === 0) return filter ? `未找到匹配 "${filter}" 的应用` : "无第三方应用";
  return `📱 第三方应用 (${packages.length}个):\n${packages.map((p) => `  • ${p}`).join("\n")}`;
}

async function launchApp(serial: string, packageName: string): Promise<string> {
  const res = await runAdb(["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"], serial);
  return res.ok ? `🚀 已启动: ${packageName}` : `❌ 启动失败: ${res.stderr}`;
}

async function stopApp(serial: string, packageName: string): Promise<string> {
  const res = await runAdb(["shell", "am", "force-stop", packageName], serial);
  return res.ok ? `⏹️ 已停止: ${packageName}` : `❌ 停止失败: ${res.stderr}`;
}

async function pushFile(serial: string, localPath: string, remotePath: string): Promise<string> {
  const fs = await import("fs");
  if (!fs.existsSync(localPath)) return `❌ 本地文件不存在: ${localPath}`;

  const dest = remotePath || `/sdcard/${localPath.split(/[/\\]/).pop()}`;
  const res = await runAdb(["push", localPath, dest], serial);
  return res.ok ? `📤 已推送: ${localPath} → ${dest}\n${res.stdout}` : `❌ 推送失败: ${res.stderr}`;
}

async function pullFile(serial: string, remotePath: string, localPath: string): Promise<string> {
  const path = await import("path");
  const dest = localPath || path.join("C:\\Users\\Administrator\\Desktop", remotePath.split("/").pop() || "pulled_file");
  const res = await runAdb(["pull", remotePath, dest], serial);
  return res.ok ? `📥 已拉取: ${remotePath} → ${dest}\n${res.stdout}` : `❌ 拉取失败: ${res.stderr}`;
}

async function shellCommand(serial: string, command: string): Promise<string> {
  const res = await runAdb(["shell", command], serial);
  let output = res.ok ? res.stdout : `错误: ${res.stderr}`;
  if (output.length > 5000) output = output.slice(0, 5000) + `\n...(已截断，共 ${output.length} 字符)`;
  return output;
}

async function connectWireless(ip: string, port = 5555): Promise<string> {
  const target = `${ip}:${port}`;
  const res = await runAdb(["connect", target]);
  if (res.ok && res.stdout.includes("connected")) {
    return `✅ 已连接到 ${target}`;
  }
  return `❌ 连接失败: ${res.stdout || res.stderr}\n\n💡 请确保:\n1. 手机和电脑在同一网络\n2. 手机已开启无线调试 (设置 → 开发者选项 → 无线调试)\n3. IP和端口正确`;
}

async function disconnectDevice(serial?: string): Promise<string> {
  const args = serial ? ["disconnect", serial] : ["disconnect"];
  const res = await runAdb(args, undefined);
  return res.ok ? `✅ ${serial ? `已断开 ${serial}` : "已断开所有无线连接"}` : `❌ 断开失败: ${res.stderr}`;
}

async function recordScreen(serial: string, duration: number, savePath?: string): Promise<string> {
  const remotePath = "/sdcard/xiniu_record.mp4";
  const sec = Math.min(Math.max(duration, 1), 180);

  const res = await runAdb(["shell", "screenrecord", "--time-limit", String(sec), remotePath], serial, (sec + 10) * 1000);
  if (!res.ok) return `❌ 录屏失败: ${res.stderr}`;

  const path = await import("path");
  const localPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", `phone_record_${Date.now()}.mp4`);
  const pullRes = await runAdb(["pull", remotePath, localPath], serial);
  if (!pullRes.ok) return `❌ 拉取录像失败: ${pullRes.stderr}`;

  await runAdb(["shell", "rm", remotePath], serial);
  return `🎬 录屏完成 (${sec}秒)\n📁 已保存: ${localPath}`;
}

async function listFiles(serial: string, remotePath: string): Promise<string> {
  const dir = remotePath || "/sdcard/";
  const res = await runAdb(["shell", "ls", "-la", dir], serial);
  if (!res.ok) return `❌ 列出目录失败: ${res.stderr}`;
  return `📂 ${dir}\n${"━".repeat(40)}\n${res.stdout}`;
}

async function getRunningApps(serial: string): Promise<string> {
  const res = await runAdb(["shell", "dumpsys", "activity", "recents"], serial);
  if (!res.ok) return `❌ 获取运行应用失败: ${res.stderr}`;

  const apps: string[] = [];
  for (const line of res.stdout.split("\n")) {
    const match = line.match(/baseIntent.*cmp=([^\s/}]+)/);
    if (match && !apps.includes(match[1])) apps.push(match[1]);
  }

  if (apps.length === 0) return "无正在运行的应用";
  return `📱 运行中的应用 (${apps.length}个):\n${apps.slice(0, 20).map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`;
}

async function clearAppData(serial: string, packageName: string): Promise<string> {
  const res = await runAdb(["shell", "pm", "clear", packageName], serial);
  return res.ok ? `🗑️ 已清除 ${packageName} 的数据` : `❌ 清除失败: ${res.stderr}`;
}

async function getAppInfo(serial: string, packageName: string): Promise<string> {
  const res = await runAdb(["shell", "dumpsys", "package", packageName], serial);
  if (!res.ok) return `❌ 获取应用信息失败: ${res.stderr}`;

  const info: string[] = [`📦 ${packageName}`];
  const versionMatch = res.stdout.match(/versionName=(\S+)/);
  const versionCodeMatch = res.stdout.match(/versionCode=(\d+)/);
  const installTimeMatch = res.stdout.match(/firstInstallTime=(.+)/);
  const updateTimeMatch = res.stdout.match(/lastUpdateTime=(.+)/);
  const targetSdkMatch = res.stdout.match(/targetSdk=(\d+)/);

  if (versionMatch) info.push(`版本: ${versionMatch[1]}${versionCodeMatch ? ` (${versionCodeMatch[1]})` : ""}`);
  if (targetSdkMatch) info.push(`目标SDK: ${targetSdkMatch[1]}`);
  if (installTimeMatch) info.push(`安装时间: ${installTimeMatch[1].trim()}`);
  if (updateTimeMatch) info.push(`更新时间: ${updateTimeMatch[1].trim()}`);

  const perms: string[] = [];
  const permSection = res.stdout.match(/requested permissions:([\s\S]*?)install permissions:/);
  if (permSection) {
    for (const line of permSection[1].split("\n")) {
      const pm = line.trim();
      if (pm.startsWith("android.permission.")) perms.push(pm.replace("android.permission.", ""));
    }
    if (perms.length > 0) info.push(`权限 (${perms.length}): ${perms.slice(0, 10).join(", ")}${perms.length > 10 ? "..." : ""}`);
  }

  return info.join("\n");
}

export const phoneControlSkill: SkillDefinition = {
  name: "phone_control",
  displayName: "手机远程控制",
  description:
    "通过ADB远程控制Android手机：连接设备、截图、点击、滑动、输入文字、安装/卸载应用、文件传输、录屏、执行Shell命令等。" +
    "用户说'手机控制'、'adb'、'安装apk'、'手机截图'、'手机操作'、'手机文件'时使用。",
  icon: "Smartphone",
  category: "dev",
  setupGuide: {
    framework: "Android SDK Platform Tools (ADB)",
    frameworkUrl: "https://developer.android.com/tools/releases/platform-tools",
    installCommands: [
      { label: "Windows - Scoop", cmd: "scoop install adb" },
      { label: "macOS - Homebrew", cmd: "brew install android-platform-tools" },
    ],
    configSteps: [
      "下载 Android SDK Platform Tools 并解压",
      "将解压目录添加到系统 PATH 环境变量",
      "手机开启开发者选项和USB调试",
      "用USB线连接手机，授权USB调试",
      "运行 adb devices 验证连接",
    ],
    healthCheckAction: "devices",
    docsUrl: "https://developer.android.com/tools/adb",
  },
  parameters: z.object({
    action: z.enum([
      "devices", "info", "connect", "disconnect",
      "screenshot", "tap", "swipe", "input_text", "key",
      "install", "uninstall", "list_apps", "launch", "stop", "app_info", "clear_data", "running_apps",
      "push", "pull", "list_files",
      "record", "shell",
    ]).describe(
      "操作: devices=列出设备, info=设备信息, connect=无线连接, disconnect=断开, " +
      "screenshot=截图, tap=点击, swipe=滑动, input_text=输入文字, key=按键, " +
      "install=安装APK, uninstall=卸载, list_apps=应用列表, launch=启动应用, stop=停止应用, app_info=应用详情, clear_data=清除应用数据, running_apps=运行中应用, " +
      "push=推送文件到手机, pull=从手机拉取文件, list_files=列出手机目录, " +
      "record=录屏, shell=执行Shell命令"
    ),
    serial: z.string().optional().describe("设备序列号(多设备时指定，单设备可省略)"),
    x: z.number().optional().describe("tap/swipe 的X坐标"),
    y: z.number().optional().describe("tap/swipe 的Y坐标"),
    x2: z.number().optional().describe("swipe 终点X坐标"),
    y2: z.number().optional().describe("swipe 终点Y坐标"),
    duration: z.number().optional().describe("swipe持续时间ms / record录屏秒数(最大180)"),
    text: z.string().optional().describe("input_text输入的文字"),
    keycode: z.string().optional().describe("key按键名(home/back/recent/menu/power/enter/volume_up/volume_down等)"),
    packageName: z.string().optional().describe("应用包名(如com.tencent.mm)"),
    apkPath: z.string().optional().describe("APK文件本地路径"),
    localPath: z.string().optional().describe("本地文件路径(push来源/pull目标)"),
    remotePath: z.string().optional().describe("手机端路径(push目标/pull来源/list_files目录)"),
    savePath: z.string().optional().describe("screenshot/record的保存路径"),
    command: z.string().optional().describe("shell命令"),
    ip: z.string().optional().describe("connect时的设备IP"),
    port: z.number().optional().describe("connect时的端口(默认5555)"),
    filter: z.string().optional().describe("list_apps的过滤关键词"),
  }),
  execute: async (params) => {
    const p = params as {
      action: string; serial?: string;
      x?: number; y?: number; x2?: number; y2?: number; duration?: number;
      text?: string; keycode?: string;
      packageName?: string; apkPath?: string;
      localPath?: string; remotePath?: string; savePath?: string;
      command?: string; ip?: string; port?: number; filter?: string;
    };

    try {
      switch (p.action) {
        case "devices": {
          const devices = await listDevices();
          if (devices.length === 0) {
            return {
              success: true,
              message: "📱 未检测到设备\n━━━━━━━━━━━━━━━━━━━━\n\n💡 连接方法:\n" +
                "1. USB连接: 手机开启USB调试 → 用数据线连接电脑\n" +
                "2. 无线连接: 使用 connect 操作 (需要手机IP和端口)\n\n" +
                "开启USB调试: 设置 → 关于手机 → 连续点击版本号7次 → 返回设置 → 开发者选项 → USB调试",
            };
          }
          let msg = `📱 已连接设备 (${devices.length}台)\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const d of devices) {
            const status = d.state === "device" ? "✅ 在线" : d.state === "unauthorized" ? "⚠️ 未授权" : "❌ 离线";
            msg += `\n${status} ${d.serial}\n   型号: ${d.model || "未知"}\n   Android: ${d.android || "未知"}\n`;
          }
          return { success: true, message: msg, data: { devices } };
        }

        case "info": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const info = await getDeviceInfo(pick.serial);
          let msg = `📱 设备详情\n━━━━━━━━━━━━━━━━━━━━\n`;
          for (const [k, v] of Object.entries(info)) msg += `${k}: ${v}\n`;
          return { success: true, message: msg, data: { info } };
        }

        case "connect": {
          if (!p.ip) return { success: false, message: "❌ 请提供设备IP地址 (ip 参数)" };
          const msg = await connectWireless(p.ip, p.port);
          return { success: msg.startsWith("✅"), message: msg };
        }

        case "disconnect": {
          const msg = await disconnectDevice(p.serial);
          return { success: msg.startsWith("✅"), message: msg };
        }

        case "screenshot": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const result = await takeScreenshot(pick.serial, p.savePath);
          return { success: result.ok, message: result.message, data: result.ok ? { path: result.path } : undefined };
        }

        case "tap": {
          if (p.x == null || p.y == null) return { success: false, message: "❌ 请提供 x 和 y 坐标" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await tapScreen(pick.serial, p.x, p.y);
          return { success: !msg.includes("失败"), message: msg };
        }

        case "swipe": {
          if (p.x == null || p.y == null || p.x2 == null || p.y2 == null) {
            return { success: false, message: "❌ 请提供起点 (x,y) 和终点 (x2,y2) 坐标" };
          }
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await swipeScreen(pick.serial, p.x, p.y, p.x2, p.y2, p.duration || 300);
          return { success: !msg.includes("失败"), message: msg };
        }

        case "input_text": {
          if (!p.text) return { success: false, message: "❌ 请提供要输入的文字 (text 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await inputText(pick.serial, p.text);
          return { success: !msg.includes("失败"), message: msg };
        }

        case "key": {
          if (!p.keycode) return { success: false, message: "❌ 请提供按键名 (keycode 参数)\n支持: home/back/recent/menu/power/enter/volume_up/volume_down 等" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await pressKey(pick.serial, p.keycode);
          return { success: !msg.includes("失败"), message: msg };
        }

        case "install": {
          if (!p.apkPath) return { success: false, message: "❌ 请提供APK文件路径 (apkPath 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await installApp(pick.serial, p.apkPath);
          return { success: msg.startsWith("✅"), message: msg };
        }

        case "uninstall": {
          if (!p.packageName) return { success: false, message: "❌ 请提供应用包名 (packageName 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await uninstallApp(pick.serial, p.packageName);
          return { success: msg.startsWith("✅"), message: msg };
        }

        case "list_apps": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await listApps(pick.serial, p.filter);
          return { success: true, message: msg };
        }

        case "launch": {
          if (!p.packageName) return { success: false, message: "❌ 请提供应用包名 (packageName 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await launchApp(pick.serial, p.packageName);
          return { success: msg.startsWith("🚀"), message: msg };
        }

        case "stop": {
          if (!p.packageName) return { success: false, message: "❌ 请提供应用包名 (packageName 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await stopApp(pick.serial, p.packageName);
          return { success: msg.startsWith("⏹️"), message: msg };
        }

        case "app_info": {
          if (!p.packageName) return { success: false, message: "❌ 请提供应用包名 (packageName 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await getAppInfo(pick.serial, p.packageName);
          return { success: true, message: msg };
        }

        case "clear_data": {
          if (!p.packageName) return { success: false, message: "❌ 请提供应用包名 (packageName 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await clearAppData(pick.serial, p.packageName);
          return { success: msg.startsWith("🗑️"), message: msg };
        }

        case "running_apps": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await getRunningApps(pick.serial);
          return { success: true, message: msg };
        }

        case "push": {
          if (!p.localPath) return { success: false, message: "❌ 请提供本地文件路径 (localPath 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await pushFile(pick.serial, p.localPath, p.remotePath || "");
          return { success: msg.startsWith("📤"), message: msg };
        }

        case "pull": {
          if (!p.remotePath) return { success: false, message: "❌ 请提供手机端文件路径 (remotePath 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await pullFile(pick.serial, p.remotePath, p.localPath || "");
          return { success: msg.startsWith("📥"), message: msg };
        }

        case "list_files": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await listFiles(pick.serial, p.remotePath || "");
          return { success: true, message: msg };
        }

        case "record": {
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const msg = await recordScreen(pick.serial, p.duration || 10, p.savePath);
          return { success: msg.startsWith("🎬"), message: msg };
        }

        case "shell": {
          if (!p.command) return { success: false, message: "❌ 请提供要执行的Shell命令 (command 参数)" };
          const pick = await pickSerial(p.serial);
          if (!pick.ok) return { success: false, message: pick.error! };
          const output = await shellCommand(pick.serial, p.command);
          return { success: true, message: `💻 Shell 执行结果:\n${"━".repeat(40)}\n${output}` };
        }

        default:
          return { success: false, message: `❌ 未知操作: ${p.action}` };
      }
    } catch (err) {
      return { success: false, message: `手机控制异常: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
