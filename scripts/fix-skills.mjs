const BASE = "http://localhost:3000/api/skills/manage";

const fixes = [
  {
    name: "translate_text",
    displayName: "多语言翻译",
    description: "将文本翻译为指定语言。支持中英日韩法德西等主流语言，使用免费翻译API。",
    icon: "Languages",
    category: "life",
    version: "1.0.1",
    author: "xiniu",
    tags: ["翻译", "多语言", "文本"],
    parameters: [
      { name: "text", type: "string", description: "要翻译的文本", required: true },
      { name: "to", type: "string", description: "目标语言代码：zh(中文), en(英语), ja(日语), ko(韩语), fr(法语), de(德语), es(西班牙语)", required: true },
      { name: "from", type: "string", description: "源语言代码，如 en/zh/ja（不支持auto，请指定具体语言）", required: false, default: "en" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const text = params.text;
    const to = params.to || 'en';
    let from = params.from || 'en';
    if (from === 'auto') {
      const hasChinese = /[\\u4e00-\\u9fff]/.test(text);
      const hasJapanese = /[\\u3040-\\u309f\\u30a0-\\u30ff]/.test(text);
      const hasKorean = /[\\uac00-\\ud7af]/.test(text);
      if (hasChinese) from = 'zh';
      else if (hasJapanese) from = 'ja';
      else if (hasKorean) from = 'ko';
      else from = 'en';
    }
    const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text.substring(0, 500)) + "&langpair=" + from + "|" + to;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData) {
      const translated = data.responseData.translatedText;
      const match = data.responseData.match;
      const langNames = {zh:"中文",en:"英语",ja:"日语",ko:"韩语",fr:"法语",de:"德语",es:"西班牙语",ru:"俄语",pt:"葡萄牙语",it:"意大利语",ar:"阿拉伯语"};
      const fromName = langNames[from] || from;
      const toName = langNames[to] || to;
      return {
        success: true,
        message: "翻译结果 (" + fromName + " → " + toName + "):\\n\\n" + translated + "\\n\\n匹配度: " + (match * 100).toFixed(0) + "%",
        data: { original: text, translated, from, to, match }
      };
    }
    return { success: false, message: "翻译失败: " + (data.responseDetails || "未知错误") };
  } catch(e) {
    return { success: false, message: "翻译失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  },
  {
    name: "cron_parser",
    displayName: "Cron表达式解析",
    description: "解析Cron表达式，显示人类可读的中文描述和未来N次执行时间。辅助定时任务配置。",
    icon: "Clock",
    category: "dev",
    version: "1.0.1",
    author: "xiniu",
    tags: ["Cron", "定时任务", "工具"],
    parameters: [
      { name: "expression", type: "string", description: "Cron表达式，如 0 9 * * 1-5 (工作日9点)", required: true },
      { name: "count", type: "number", description: "显示未来几次执行时间（默认5次）", required: false, default: 5 }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const cronParser = require('cron-parser');
  try {
    const expr = params.expression;
    const count = Number(params.count) || 5;
    let interval;
    if (typeof cronParser.parseExpression === 'function') {
      interval = cronParser.parseExpression(expr);
    } else if (typeof cronParser === 'function') {
      interval = cronParser(expr);
    } else if (cronParser.CronExpressionParser) {
      interval = cronParser.CronExpressionParser.parse(expr);
    } else if (cronParser.default) {
      const mod = cronParser.default;
      if (typeof mod.parseExpression === 'function') interval = mod.parseExpression(expr);
      else if (typeof mod === 'function') interval = mod(expr);
    }
    if (!interval) {
      const keys = Object.keys(cronParser);
      return { success: false, message: "cron-parser API 不兼容。可用导出: " + keys.join(", ") };
    }
    const nextTimes = [];
    for (let i = 0; i < count; i++) {
      const next = interval.next();
      const d = next.toDate ? next.toDate() : (next.value ? next.value.toDate() : new Date(next));
      nextTimes.push(d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    }
    const parts = expr.trim().split(/\\s+/);
    let desc = "Cron: " + expr + "\\n";
    if (parts.length >= 5) {
      const labels = ["分钟", "小时", "日", "月", "星期"];
      desc += "\\n字段解析:\\n";
      parts.slice(0, 5).forEach((p, i) => {
        desc += "  " + labels[i] + ": " + p + "\\n";
      });
    }
    desc += "\\n未来 " + count + " 次执行时间:\\n";
    nextTimes.forEach((t, i) => { desc += "  " + (i+1) + ". " + t + "\\n"; });
    return { success: true, message: desc, data: { expression: expr, nextTimes } };
  } catch(e) {
    return { success: false, message: "Cron解析失败: " + e.message + "\\n\\n常用示例:\\n* * * * * = 每分钟\\n0 9 * * * = 每天9点\\n0 9 * * 1-5 = 工作日9点" };
  }
}`,
      runtime: "node",
      dependencies: ["cron-parser"],
      timeout: 10000
    },
    enabled: true
  }
];

async function fixSkills() {
  for (const skill of fixes) {
    console.log("修复: " + skill.displayName);
    try {
      const res = await fetch(BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      console.log(data.success ? "  [OK] 更新成功" : "  [FAIL] " + data.message);
    } catch (e) {
      console.log("  [ERROR] " + e.message);
    }
  }
}

fixSkills();
