const BASE = "http://localhost:3000/api/skills/manage";

const skills = [
  {
    name: "image_convert",
    displayName: "图片压缩转换",
    description: "对图片进行格式转换（PNG/JPEG/WebP/GIF互转）和压缩。支持本地文件路径，输出到指定位置。",
    icon: "Camera",
    category: "creative",
    version: "1.0.0",
    author: "xiniu",
    tags: ["图片", "压缩", "格式转换"],
    parameters: [
      { name: "input", type: "string", description: "输入图片文件路径", required: true },
      { name: "output", type: "string", description: "输出文件路径（含扩展名决定格式，如 output.webp）", required: true },
      { name: "quality", type: "number", description: "压缩质量 1-100（默认80，仅JPEG/WebP有效）", required: false, default: 80 }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const sharp = require('sharp');
  const path = require('path');
  const fs = require('fs');
  try {
    const input = params.input;
    const output = params.output;
    const quality = Number(params.quality) || 80;
    if (!fs.existsSync(input)) return { success: false, message: "输入文件不存在: " + input };
    const ext = path.extname(output).toLowerCase().replace('.', '');
    const inputStat = fs.statSync(input);
    let pipeline = sharp(input);
    switch(ext) {
      case 'jpg': case 'jpeg':
        pipeline = pipeline.jpeg({ quality }); break;
      case 'png':
        pipeline = pipeline.png({ quality: Math.min(quality, 100) }); break;
      case 'webp':
        pipeline = pipeline.webp({ quality }); break;
      case 'gif':
        pipeline = pipeline.gif(); break;
      case 'avif':
        pipeline = pipeline.avif({ quality }); break;
      default:
        return { success: false, message: "不支持的输出格式: " + ext };
    }
    const dir = path.dirname(output);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await pipeline.toFile(output);
    const outputStat = fs.statSync(output);
    const ratio = ((1 - outputStat.size / inputStat.size) * 100).toFixed(1);
    return {
      success: true,
      message: "图片转换完成!\\n输入: " + input + " (" + (inputStat.size/1024).toFixed(1) + "KB)\\n输出: " + output + " (" + (outputStat.size/1024).toFixed(1) + "KB)\\n格式: " + ext.toUpperCase() + "\\n压缩率: " + ratio + "%",
      data: { inputSize: inputStat.size, outputSize: outputStat.size, format: ext, compressionRatio: ratio }
    };
  } catch(e) {
    return { success: false, message: "图片转换失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: ["sharp"],
      timeout: 30000
    },
    enabled: true
  },
  {
    name: "csv_json_convert",
    displayName: "CSV/JSON互转",
    description: "CSV与JSON数据格式互相转换。支持本地文件或直接传入内容，自动检测分隔符。",
    icon: "FileText",
    category: "office",
    version: "1.0.0",
    author: "xiniu",
    tags: ["CSV", "JSON", "数据转换"],
    parameters: [
      { name: "input", type: "string", description: "输入内容（CSV/JSON文本或文件路径）", required: true },
      { name: "direction", type: "string", description: "转换方向: csv2json 或 json2csv", required: true },
      { name: "output_file", type: "string", description: "输出文件路径（可选，不填则直接返回内容）", required: false, default: "" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const fs = require('fs');
  const path = require('path');
  try {
    let input = params.input;
    if (fs.existsSync(input)) input = fs.readFileSync(input, 'utf-8');
    const direction = params.direction || 'csv2json';
    let result;
    if (direction === 'csv2json') {
      const lines = input.trim().split('\\n');
      const sep = lines[0].includes('\\t') ? '\\t' : ',';
      const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(sep).map(v => v.trim().replace(/^"|"$/g, ''));
        const obj = {};
        headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
        data.push(obj);
      }
      result = JSON.stringify(data, null, 2);
    } else if (direction === 'json2csv') {
      const data = JSON.parse(input);
      if (!Array.isArray(data) || data.length === 0) return { success: false, message: "JSON必须是非空数组" };
      const headers = Object.keys(data[0]);
      const csvLines = [headers.join(',')];
      for (const row of data) {
        csvLines.push(headers.map(h => {
          const v = String(row[h] ?? '');
          return v.includes(',') || v.includes('"') || v.includes('\\n') ? '"' + v.replace(/"/g, '""') + '"' : v;
        }).join(','));
      }
      result = csvLines.join('\\n');
    } else {
      return { success: false, message: "direction 必须是 csv2json 或 json2csv" };
    }
    if (params.output_file) {
      const dir = path.dirname(params.output_file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(params.output_file, result, 'utf-8');
      return { success: true, message: "转换完成，已保存至: " + params.output_file + "\\n内容预览:\\n" + result.substring(0, 500), data: { outputFile: params.output_file, lines: result.split('\\n').length } };
    }
    return { success: true, message: "转换结果:\\n\\n" + result.substring(0, 2000), data: { lines: result.split('\\n').length } };
  } catch(e) {
    return { success: false, message: "转换失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  },
  {
    name: "todo_manager",
    displayName: "TODO任务管理",
    description: "本地持久化TODO任务管理。支持添加/删除/完成/列表查看任务，带优先级和截止日期。数据存储在本地JSON文件。",
    icon: "Star",
    category: "office",
    version: "1.0.0",
    author: "xiniu",
    tags: ["TODO", "任务", "日程"],
    parameters: [
      { name: "action", type: "string", description: "操作: add(添加), list(列表), done(完成), delete(删除), clear(清空已完成)", required: true },
      { name: "title", type: "string", description: "任务标题（add时必填）", required: false, default: "" },
      { name: "priority", type: "string", description: "优先级: high/medium/low（默认medium）", required: false, default: "medium" },
      { name: "due", type: "string", description: "截止日期（如 2026-03-15）", required: false, default: "" },
      { name: "id", type: "number", description: "任务ID（done/delete时使用）", required: false, default: 0 }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const fs = require('fs');
  const path = require('path');
  const todoFile = path.join(os.homedir(), '.xiniu', 'todos.json');
  const dir = path.dirname(todoFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let todos = [];
  try { todos = JSON.parse(fs.readFileSync(todoFile, 'utf-8')); } catch {}
  const action = params.action;
  const priorityIcons = { high: '!!!', medium: '!!', low: '!' };
  if (action === 'add') {
    if (!params.title) return { success: false, message: "请提供任务标题" };
    const id = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
    const todo = { id, title: params.title, priority: params.priority || 'medium', due: params.due || '', done: false, createdAt: new Date().toISOString() };
    todos.push(todo);
    fs.writeFileSync(todoFile, JSON.stringify(todos, null, 2));
    return { success: true, message: "任务已添加 [#" + id + "]\\n标题: " + todo.title + "\\n优先级: " + (priorityIcons[todo.priority] || '!!') + " " + todo.priority + (todo.due ? "\\n截止: " + todo.due : ""), data: todo };
  } else if (action === 'list') {
    if (todos.length === 0) return { success: true, message: "暂无任务", data: { todos: [] } };
    const pending = todos.filter(t => !t.done);
    const completed = todos.filter(t => t.done);
    let msg = "待办任务 (" + pending.length + "):\\n";
    pending.sort((a, b) => { const p = {high:0,medium:1,low:2}; return (p[a.priority]||1) - (p[b.priority]||1); });
    pending.forEach(t => {
      const overdue = t.due && new Date(t.due) < new Date() ? ' [已过期]' : '';
      msg += "  [ ] #" + t.id + " " + (priorityIcons[t.priority]||'') + " " + t.title + (t.due ? " (截止:" + t.due + ")" : "") + overdue + "\\n";
    });
    if (completed.length > 0) {
      msg += "\\n已完成 (" + completed.length + "):\\n";
      completed.slice(-5).forEach(t => { msg += "  [x] #" + t.id + " " + t.title + "\\n"; });
    }
    return { success: true, message: msg, data: { total: todos.length, pending: pending.length, completed: completed.length } };
  } else if (action === 'done') {
    const id = Number(params.id);
    const todo = todos.find(t => t.id === id);
    if (!todo) return { success: false, message: "未找到任务 #" + id };
    todo.done = true;
    todo.completedAt = new Date().toISOString();
    fs.writeFileSync(todoFile, JSON.stringify(todos, null, 2));
    return { success: true, message: "已完成任务 #" + id + ": " + todo.title, data: todo };
  } else if (action === 'delete') {
    const id = Number(params.id);
    const idx = todos.findIndex(t => t.id === id);
    if (idx === -1) return { success: false, message: "未找到任务 #" + id };
    const removed = todos.splice(idx, 1)[0];
    fs.writeFileSync(todoFile, JSON.stringify(todos, null, 2));
    return { success: true, message: "已删除任务 #" + id + ": " + removed.title };
  } else if (action === 'clear') {
    const before = todos.length;
    todos = todos.filter(t => !t.done);
    fs.writeFileSync(todoFile, JSON.stringify(todos, null, 2));
    return { success: true, message: "已清空 " + (before - todos.length) + " 个已完成任务" };
  }
  return { success: false, message: "未知操作: " + action + "\\n支持: add/list/done/delete/clear" };
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "calendar_reminder",
    displayName: "日历事件提醒",
    description: "创建和管理本地日历事件。支持添加/查看/删除事件，带提醒时间。生成ICS日历文件可导入系统日历。",
    icon: "Clock",
    category: "office",
    version: "1.0.0",
    author: "xiniu",
    tags: ["日历", "提醒", "日程"],
    parameters: [
      { name: "action", type: "string", description: "操作: add(添加), list(查看), delete(删除), export(导出ICS)", required: true },
      { name: "title", type: "string", description: "事件标题", required: false, default: "" },
      { name: "date", type: "string", description: "日期 YYYY-MM-DD", required: false, default: "" },
      { name: "time", type: "string", description: "时间 HH:mm", required: false, default: "" },
      { name: "duration", type: "number", description: "持续时长（分钟，默认60）", required: false, default: 60 },
      { name: "id", type: "number", description: "事件ID（delete时使用）", required: false, default: 0 }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const fs = require('fs');
  const path = require('path');
  const evtFile = path.join(os.homedir(), '.xiniu', 'calendar.json');
  const dir = path.dirname(evtFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let events = [];
  try { events = JSON.parse(fs.readFileSync(evtFile, 'utf-8')); } catch {}
  const action = params.action;
  if (action === 'add') {
    if (!params.title || !params.date) return { success: false, message: "请提供事件标题和日期" };
    const id = events.length > 0 ? Math.max(...events.map(e => e.id)) + 1 : 1;
    const evt = { id, title: params.title, date: params.date, time: params.time || '09:00', duration: Number(params.duration) || 60, createdAt: new Date().toISOString() };
    events.push(evt);
    fs.writeFileSync(evtFile, JSON.stringify(events, null, 2));
    return { success: true, message: "事件已创建 [#" + id + "]\\n标题: " + evt.title + "\\n日期: " + evt.date + " " + evt.time + "\\n时长: " + evt.duration + "分钟", data: evt };
  } else if (action === 'list') {
    if (events.length === 0) return { success: true, message: "暂无日历事件", data: { events: [] } };
    events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const today = new Date().toISOString().split('T')[0];
    const upcoming = events.filter(e => e.date >= today);
    const past = events.filter(e => e.date < today);
    let msg = "即将到来的事件 (" + upcoming.length + "):\\n";
    upcoming.forEach(e => { msg += "  #" + e.id + " [" + e.date + " " + e.time + "] " + e.title + " (" + e.duration + "min)\\n"; });
    if (past.length > 0) {
      msg += "\\n已过去的事件 (" + past.length + "):\\n";
      past.slice(-3).forEach(e => { msg += "  #" + e.id + " [" + e.date + "] " + e.title + "\\n"; });
    }
    return { success: true, message: msg, data: { total: events.length, upcoming: upcoming.length } };
  } else if (action === 'delete') {
    const id = Number(params.id);
    const idx = events.findIndex(e => e.id === id);
    if (idx === -1) return { success: false, message: "未找到事件 #" + id };
    const removed = events.splice(idx, 1)[0];
    fs.writeFileSync(evtFile, JSON.stringify(events, null, 2));
    return { success: true, message: "已删除事件 #" + id + ": " + removed.title };
  } else if (action === 'export') {
    if (events.length === 0) return { success: false, message: "暂无事件可导出" };
    let ics = "BEGIN:VCALENDAR\\nVERSION:2.0\\nPRODID:-//Xiniu//Calendar//CN\\n";
    events.forEach(e => {
      const dtStart = e.date.replace(/-/g, '') + 'T' + (e.time || '09:00').replace(':', '') + '00';
      const endDate = new Date(e.date + 'T' + (e.time || '09:00'));
      endDate.setMinutes(endDate.getMinutes() + (e.duration || 60));
      const dtEnd = endDate.toISOString().replace(/[-:]/g, '').replace('.000', '').replace('Z', '');
      ics += "BEGIN:VEVENT\\nDTSTART:" + dtStart + "\\nDTEND:" + dtEnd + "\\nSUMMARY:" + e.title + "\\nEND:VEVENT\\n";
    });
    ics += "END:VCALENDAR";
    const icsFile = path.join(os.homedir(), '.xiniu', 'calendar.ics');
    fs.writeFileSync(icsFile, ics.replace(/\\\\n/g, '\\r\\n'));
    return { success: true, message: "已导出ICS文件: " + icsFile + "\\n共 " + events.length + " 个事件", data: { file: icsFile, count: events.length } };
  }
  return { success: false, message: "未知操作: " + action };
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "url_shortener",
    displayName: "URL短链生成",
    description: "将长URL生成短链接。使用免费短链服务，返回可访问的短链。",
    icon: "Zap",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["短链", "URL", "分享"],
    parameters: [
      { name: "url", type: "string", description: "要缩短的URL", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const url = params.url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { success: false, message: "请输入有效的URL (http:// 或 https://)" };
    }
    const res = await fetch('https://is.gd/create.php?format=json&url=' + encodeURIComponent(url));
    const data = await res.json();
    if (data.shorturl) {
      return {
        success: true,
        message: "短链生成成功!\\n\\n原始URL: " + url + "\\n短链接: " + data.shorturl + "\\n\\n可直接点击访问短链接",
        data: { original: url, short: data.shorturl }
      };
    }
    if (data.errormessage) {
      const res2 = await fetch('https://tinyurl.com/api-create.php?url=' + encodeURIComponent(url));
      const short2 = await res2.text();
      if (short2.startsWith('http')) {
        return { success: true, message: "短链生成成功!\\n原始: " + url + "\\n短链: " + short2, data: { original: url, short: short2 } };
      }
    }
    return { success: false, message: "短链生成失败: " + (data.errormessage || "未知错误") };
  } catch(e) {
    return { success: false, message: "短链生成失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  },
  {
    name: "whois_lookup",
    displayName: "Whois域名查询",
    description: "查询域名的Whois注册信息，包括注册人、注册商、创建日期、过期日期等。",
    icon: "Globe",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["Whois", "域名", "注册信息"],
    parameters: [
      { name: "domain", type: "string", description: "要查询的域名，如 example.com", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const whois = require('whois-json');
  try {
    const domain = params.domain.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '');
    const result = await whois(domain);
    if (!result || Object.keys(result).length === 0) {
      return { success: false, message: "未查询到域名信息: " + domain };
    }
    const fields = {
      domainName: '域名',
      registrar: '注册商',
      registrarUrl: '注册商网址',
      creationDate: '注册日期',
      expirationDate: '过期日期',
      updatedDate: '更新日期',
      registrantOrganization: '注册组织',
      registrantCountry: '注册国家',
      nameServer: 'DNS服务器',
      dnssec: 'DNSSEC',
      status: '状态'
    };
    let msg = "Whois 查询结果 - " + domain + "\\n\\n";
    for (const [key, label] of Object.entries(fields)) {
      if (result[key]) {
        const val = Array.isArray(result[key]) ? result[key].join(', ') : String(result[key]);
        msg += label + ": " + val + "\\n";
      }
    }
    if (result.expirationDate) {
      const expDate = new Date(result.expirationDate);
      const daysLeft = Math.ceil((expDate - new Date()) / (1000*60*60*24));
      msg += "\\n距过期还有: " + daysLeft + " 天";
      if (daysLeft < 30) msg += " (即将过期!)";
    }
    return { success: true, message: msg, data: result };
  } catch(e) {
    return { success: false, message: "Whois查询失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: ["whois-json"],
      timeout: 15000
    },
    enabled: true
  },
  {
    name: "color_convert",
    displayName: "颜色转换工具",
    description: "在HEX、RGB、HSL颜色格式之间互相转换。支持输入任意格式，返回所有格式的值和颜色名称。",
    icon: "Sparkles",
    category: "creative",
    version: "1.0.0",
    author: "xiniu",
    tags: ["颜色", "HEX", "RGB", "HSL"],
    parameters: [
      { name: "color", type: "string", description: "颜色值，支持 #FF5733 / rgb(255,87,51) / hsl(14,100%,60%) 等格式", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const input = params.color.trim();
    let r, g, b;
    const hexMatch = input.match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
    if (hexMatch) {
      let hex = hexMatch[1];
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      r = parseInt(hex.substring(0,2), 16);
      g = parseInt(hex.substring(2,4), 16);
      b = parseInt(hex.substring(4,6), 16);
    }
    const rgbMatch = input.match(/rgb\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\)/i);
    if (rgbMatch) { r = parseInt(rgbMatch[1]); g = parseInt(rgbMatch[2]); b = parseInt(rgbMatch[3]); }
    const hslMatch = input.match(/hsl\\s*\\(\\s*(\\d+)\\s*,\\s*(\\d+)%?\\s*,\\s*(\\d+)%?\\s*\\)/i);
    if (hslMatch) {
      const h = parseInt(hslMatch[1]) / 360;
      const s = parseInt(hslMatch[2]) / 100;
      const l = parseInt(hslMatch[3]) / 100;
      if (s === 0) { r = g = b = Math.round(l * 255); }
      else {
        const hue2rgb = (p, q, t) => { if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
        g = Math.round(hue2rgb(p, q, h) * 255);
        b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
      }
    }
    if (r === undefined) return { success: false, message: "无法解析颜色: " + input + "\\n\\n支持格式:\\n  HEX: #FF5733 或 FF5733\\n  RGB: rgb(255, 87, 51)\\n  HSL: hsl(14, 100%, 60%)" };
    const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
    const rn = r/255, gn = g/255, bn = b/255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      else if (max === gn) h = ((bn - rn) / d + 2) / 6;
      else h = ((rn - gn) / d + 4) / 6;
    }
    const H = Math.round(h * 360), S = Math.round(s * 100), L = Math.round(l * 100);
    return {
      success: true,
      message: "颜色转换结果:\\n\\n  HEX: " + hex.toUpperCase() + "\\n  RGB: rgb(" + r + ", " + g + ", " + b + ")\\n  HSL: hsl(" + H + ", " + S + "%, " + L + "%)\\n  CSS: " + hex,
      data: { hex: hex.toUpperCase(), rgb: { r, g, b }, hsl: { h: H, s: S, l: L } }
    };
  } catch(e) {
    return { success: false, message: "颜色转换失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "password_checker",
    displayName: "密码强度检测",
    description: "分析密码的安全强度，检查长度、复杂度、常见弱密码匹配，给出评分和改进建议。",
    icon: "Shield",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["密码", "安全", "强度检测"],
    parameters: [
      { name: "password", type: "string", description: "要检测的密码", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const pw = params.password;
    const weakPasswords = ['123456','password','12345678','qwerty','abc123','monkey','1234567','letmein','trustno1','dragon','baseball','iloveyou','master','sunshine','ashley','bailey','shadow','123123','654321','superman','qazwsx','michael','football','password1','000000','admin','admin123','root','toor','test','guest'];
    let score = 0;
    const issues = [];
    const tips = [];
    if (pw.length >= 8) score += 20; else issues.push('长度不足8位');
    if (pw.length >= 12) score += 10;
    if (pw.length >= 16) score += 10;
    if (/[a-z]/.test(pw)) score += 10; else issues.push('缺少小写字母');
    if (/[A-Z]/.test(pw)) score += 10; else issues.push('缺少大写字母');
    if (/[0-9]/.test(pw)) score += 10; else issues.push('缺少数字');
    if (/[^a-zA-Z0-9]/.test(pw)) score += 15; else issues.push('缺少特殊字符');
    const uniqueChars = new Set(pw).size;
    if (uniqueChars >= pw.length * 0.7) score += 10;
    if (/(.+)\\1{2,}/.test(pw)) { score -= 15; issues.push('包含重复模式'); }
    if (/^(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)/i.test(pw)) { score -= 10; issues.push('以连续字符开头'); }
    if (weakPasswords.includes(pw.toLowerCase())) { score = Math.min(score, 10); issues.push('属于常见弱密码'); }
    score = Math.max(0, Math.min(100, score));
    let level, color;
    if (score >= 80) { level = '强'; color = '绿色'; }
    else if (score >= 60) { level = '中等'; color = '黄色'; }
    else if (score >= 40) { level = '弱'; color = '橙色'; }
    else { level = '极弱'; color = '红色'; }
    if (issues.length > 0) tips.push('修复以下问题: ' + issues.join('、'));
    if (pw.length < 12) tips.push('建议使用12位以上密码');
    if (!/[^a-zA-Z0-9]/.test(pw)) tips.push('添加特殊字符如 !@#$%^&*');
    const entropy = Math.log2(Math.pow(uniqueChars, pw.length)).toFixed(1);
    let msg = "密码强度分析:\\n\\n  评分: " + score + "/100 [" + level + "]\\n  长度: " + pw.length + " 字符\\n  唯一字符: " + uniqueChars + "\\n  信息熵: " + entropy + " bits\\n";
    if (issues.length > 0) msg += "\\n问题:\\n" + issues.map(i => "  - " + i).join("\\n");
    if (tips.length > 0) msg += "\\n\\n建议:\\n" + tips.map(t => "  - " + t).join("\\n");
    return { success: true, message: msg, data: { score, level, length: pw.length, uniqueChars, entropy: parseFloat(entropy), issues, tips } };
  } catch(e) {
    return { success: false, message: "检测失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "timezone_convert",
    displayName: "时区转换",
    description: "在不同时区之间转换时间。支持全球主要时区（如北京、东京、纽约、伦敦等），可查看多个时区的当前时间。",
    icon: "Clock",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["时区", "时间", "转换"],
    parameters: [
      { name: "time", type: "string", description: "时间（如 2026-03-01 14:30 或 now）", required: true },
      { name: "from_tz", type: "string", description: "源时区: Asia/Shanghai, America/New_York, Europe/London, Asia/Tokyo 等", required: true },
      { name: "to_tz", type: "string", description: "目标时区（多个用逗号分隔），如 America/New_York,Europe/London", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const timeStr = params.time === 'now' ? new Date().toISOString() : params.time;
    const fromTz = params.from_tz;
    const toTzList = params.to_tz.split(',').map(s => s.trim());
    const tzNames = {
      'Asia/Shanghai': '北京',
      'Asia/Tokyo': '东京',
      'Asia/Seoul': '首尔',
      'Asia/Hong_Kong': '香港',
      'Asia/Singapore': '新加坡',
      'America/New_York': '纽约',
      'America/Los_Angeles': '洛杉矶',
      'America/Chicago': '芝加哥',
      'Europe/London': '伦敦',
      'Europe/Paris': '巴黎',
      'Europe/Berlin': '柏林',
      'Europe/Moscow': '莫斯科',
      'Australia/Sydney': '悉尼',
      'Pacific/Auckland': '奥克兰'
    };
    let sourceDate;
    if (params.time === 'now') {
      sourceDate = new Date();
    } else {
      sourceDate = new Date(timeStr);
      if (isNaN(sourceDate.getTime())) return { success: false, message: "无效的时间格式: " + timeStr };
    }
    const fromName = tzNames[fromTz] || fromTz;
    const sourceFormatted = sourceDate.toLocaleString('zh-CN', { timeZone: fromTz, hour12: false });
    let msg = "时区转换结果:\\n\\n源时间: " + sourceFormatted + " (" + fromName + " / " + fromTz + ")\\n\\n";
    toTzList.forEach(tz => {
      const name = tzNames[tz] || tz;
      try {
        const converted = sourceDate.toLocaleString('zh-CN', { timeZone: tz, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        msg += "  " + name + " (" + tz + "): " + converted + "\\n";
      } catch(e) {
        msg += "  " + tz + ": 无效时区\\n";
      }
    });
    return { success: true, message: msg, data: { source: sourceFormatted, fromTz, results: toTzList } };
  } catch(e) {
    return { success: false, message: "时区转换失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "sys_monitor",
    displayName: "系统资源监控",
    description: "实时监控系统资源使用情况，包括CPU使用率、内存占用、磁盘空间、系统运行时间等详细信息。",
    icon: "Cpu",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["系统", "监控", "CPU", "内存"],
    parameters: [
      { name: "detail", type: "boolean", description: "是否显示详细信息（进程列表等）", required: false, default: false }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const os = require('os');
  const { execSync } = require('child_process');
  try {
    const cpus = os.cpus();
    const cpuModel = cpus[0].model;
    const cpuCores = cpus.length;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);
    const uptime = os.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const formatBytes = (b) => {
      if (b > 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
      if (b > 1048576) return (b / 1048576).toFixed(2) + ' MB';
      return (b / 1024).toFixed(2) + ' KB';
    };
    let cpuUsage = 'N/A';
    try {
      const cpuTimes1 = os.cpus().map(c => c.times);
      await new Promise(r => setTimeout(r, 500));
      const cpuTimes2 = os.cpus().map(c => c.times);
      let idleDiff = 0, totalDiff = 0;
      for (let i = 0; i < cpuTimes1.length; i++) {
        const t1 = cpuTimes1[i], t2 = cpuTimes2[i];
        idleDiff += t2.idle - t1.idle;
        totalDiff += (t2.user - t1.user) + (t2.nice - t1.nice) + (t2.sys - t1.sys) + (t2.idle - t1.idle) + (t2.irq - t1.irq);
      }
      cpuUsage = totalDiff > 0 ? ((1 - idleDiff / totalDiff) * 100).toFixed(1) + '%' : 'N/A';
    } catch {}
    let diskInfo = '';
    try {
      if (process.platform === 'win32') {
        const out = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8', timeout: 5000 });
        const lines = out.trim().split('\\n').slice(1).filter(l => l.trim());
        lines.forEach(line => {
          const parts = line.trim().split(/\\s+/);
          if (parts.length >= 3) {
            const drive = parts[0];
            const free = parseInt(parts[1]);
            const total = parseInt(parts[2]);
            if (!isNaN(free) && !isNaN(total) && total > 0) {
              const used = total - free;
              diskInfo += "  " + drive + " 总计 " + formatBytes(total) + " | 已用 " + formatBytes(used) + " (" + ((used/total)*100).toFixed(1) + "%) | 可用 " + formatBytes(free) + "\\n";
            }
          }
        });
      }
    } catch {}
    let msg = "系统资源监控:\\n\\n";
    msg += "CPU: " + cpuModel.trim() + " (" + cpuCores + "核)\\n";
    msg += "CPU使用率: " + cpuUsage + "\\n\\n";
    msg += "内存: " + formatBytes(usedMem) + " / " + formatBytes(totalMem) + " (" + memPercent + "%)\\n";
    msg += "可用内存: " + formatBytes(freeMem) + "\\n\\n";
    msg += "运行时间: " + days + "天 " + hours + "小时 " + mins + "分钟\\n";
    msg += "系统: " + os.type() + " " + os.release() + " (" + os.arch() + ")\\n";
    msg += "主机名: " + os.hostname() + "\\n";
    if (diskInfo) msg += "\\n磁盘:\\n" + diskInfo;
    if (params.detail) {
      msg += "\\n网络接口:\\n";
      const nets = os.networkInterfaces();
      for (const [name, addrs] of Object.entries(nets)) {
        const ipv4 = addrs.filter(a => a.family === 'IPv4' && !a.internal);
        if (ipv4.length > 0) msg += "  " + name + ": " + ipv4.map(a => a.address).join(', ') + "\\n";
      }
    }
    return { success: true, message: msg, data: { cpuCores, cpuUsage, memTotal: totalMem, memUsed: usedMem, memPercent: parseFloat(memPercent), uptime } };
  } catch(e) {
    return { success: false, message: "系统监控失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  }
];

async function addSkills() {
  console.log("=== 第四轮：添加 " + skills.length + " 个新技能 ===\\n");
  const results = [];
  for (const skill of skills) {
    try {
      const res = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      if (data.success) {
        console.log("[OK] " + skill.displayName + " (" + skill.name + ")");
        results.push({ name: skill.name, status: "created" });
      } else {
        console.log("[FAIL] " + skill.displayName + ": " + (data.message || JSON.stringify(data.errors)));
        results.push({ name: skill.name, status: "failed", error: data.message });
      }
    } catch (e) {
      console.log("[ERROR] " + skill.displayName + ": " + e.message);
      results.push({ name: skill.name, status: "error", error: e.message });
    }
  }
  console.log("\\n成功: " + results.filter(r => r.status === "created").length + "/" + results.length);
}

addSkills();
