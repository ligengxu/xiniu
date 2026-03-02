const BASE = "http://localhost:3000/api/skills/manage";

const skills = [
  {
    name: "weather_query",
    displayName: "天气查询",
    description: "查询指定城市的实时天气信息，包括温度、湿度、风速、天气状况等。支持中国城市和全球主要城市。",
    icon: "Cloud",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["天气", "查询", "生活"],
    parameters: [
      { name: "city", type: "string", description: "城市名称，如：北京、上海、Tokyo", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const city = params.city;
  try {
    const geoRes = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(city) + "&count=1&language=zh");
    const geoData = await geoRes.json();
    if (!geoData.results || geoData.results.length === 0) {
      return { success: false, message: "未找到城市: " + city };
    }
    const loc = geoData.results[0];
    const weatherRes = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude + "&longitude=" + loc.longitude + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto");
    const weatherData = await weatherRes.json();
    const cur = weatherData.current;
    const codes = {0:"晴天",1:"大部晴朗",2:"多云",3:"阴天",45:"雾",48:"雾凇",51:"小毛毛雨",53:"中毛毛雨",55:"大毛毛雨",61:"小雨",63:"中雨",65:"大雨",71:"小雪",73:"中雪",75:"大雪",80:"小阵雨",81:"中阵雨",82:"大阵雨",95:"雷暴"};
    const desc = codes[cur.weather_code] || "未知(" + cur.weather_code + ")";
    return {
      success: true,
      message: loc.name + "(" + (loc.country || "") + ") 当前天气:\\n温度: " + cur.temperature_2m + "°C\\n体感温度: " + cur.apparent_temperature + "°C\\n湿度: " + cur.relative_humidity_2m + "%\\n风速: " + cur.wind_speed_10m + " km/h\\n天气: " + desc,
      data: { city: loc.name, country: loc.country, temperature: cur.temperature_2m, humidity: cur.relative_humidity_2m, windSpeed: cur.wind_speed_10m, weather: desc }
    };
  } catch(e) {
    return { success: false, message: "天气查询失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 15000
    },
    enabled: true
  },
  {
    name: "currency_convert",
    displayName: "汇率换算",
    description: "实时货币汇率转换。支持全球主要货币（USD、CNY、EUR、JPY、GBP等），使用ECB官方汇率数据。",
    icon: "Calculator",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["汇率", "货币", "换算"],
    parameters: [
      { name: "amount", type: "number", description: "金额数量", required: true },
      { name: "from", type: "string", description: "源货币代码，如 USD、CNY、EUR", required: true },
      { name: "to", type: "string", description: "目标货币代码，如 CNY、USD、JPY", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const { amount, from, to } = params;
  const fromUp = String(from).toUpperCase();
  const toUp = String(to).toUpperCase();
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/" + fromUp.toLowerCase() + ".json");
    const data = await res.json();
    const rates = data[fromUp.toLowerCase()];
    if (!rates) return { success: false, message: "不支持的源货币: " + fromUp };
    const rate = rates[toUp.toLowerCase()];
    if (rate === undefined) return { success: false, message: "不支持的目标货币: " + toUp };
    const result = (Number(amount) * rate).toFixed(4);
    return {
      success: true,
      message: amount + " " + fromUp + " = " + result + " " + toUp + "\\n汇率: 1 " + fromUp + " = " + rate.toFixed(6) + " " + toUp,
      data: { amount, from: fromUp, to: toUp, rate, result: parseFloat(result) }
    };
  } catch(e) {
    return { success: false, message: "汇率查询失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  },
  {
    name: "email_sender",
    displayName: "邮件发送",
    description: "通过SMTP协议发送电子邮件。支持HTML内容、附件（文件路径）、多收件人。需要提供SMTP服务器配置。",
    icon: "Mail",
    category: "office",
    version: "1.0.0",
    author: "xiniu",
    tags: ["邮件", "SMTP", "办公"],
    parameters: [
      { name: "to", type: "string", description: "收件人邮箱（多个用逗号分隔）", required: true },
      { name: "subject", type: "string", description: "邮件主题", required: true },
      { name: "body", type: "string", description: "邮件正文（支持HTML）", required: true },
      { name: "smtp_host", type: "string", description: "SMTP服务器地址，如 smtp.qq.com", required: true },
      { name: "smtp_port", type: "number", description: "SMTP端口，如 465（SSL）或 587（TLS）", required: true },
      { name: "smtp_user", type: "string", description: "SMTP用户名/发件人邮箱", required: true },
      { name: "smtp_pass", type: "string", description: "SMTP密码或授权码", required: true }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const nodemailer = require('nodemailer');
  try {
    const transporter = nodemailer.createTransport({
      host: params.smtp_host,
      port: Number(params.smtp_port),
      secure: Number(params.smtp_port) === 465,
      auth: { user: params.smtp_user, pass: params.smtp_pass }
    });
    const info = await transporter.sendMail({
      from: params.smtp_user,
      to: params.to,
      subject: params.subject,
      html: params.body
    });
    return {
      success: true,
      message: "邮件发送成功！\\n收件人: " + params.to + "\\n主题: " + params.subject + "\\nMessageID: " + info.messageId,
      data: { messageId: info.messageId, accepted: info.accepted }
    };
  } catch(e) {
    return { success: false, message: "邮件发送失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: ["nodemailer"],
      timeout: 30000
    },
    enabled: true
  },
  {
    name: "rss_reader",
    displayName: "RSS订阅读取",
    description: "抓取并解析RSS/Atom订阅源，返回最新文章列表。支持任意RSS源URL，自动提取标题、摘要、链接、发布时间。",
    icon: "BookOpen",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["RSS", "订阅", "新闻"],
    parameters: [
      { name: "url", type: "string", description: "RSS订阅源URL", required: true },
      { name: "limit", type: "number", description: "返回条目数量，默认10", required: false, default: 10 }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const { parseStringPromise } = require('xml2js');
  try {
    const res = await fetch(params.url, {
      headers: { 'User-Agent': 'Xiniu-RSS-Reader/1.0' }
    });
    if (!res.ok) return { success: false, message: "获取RSS失败: HTTP " + res.status };
    const xml = await res.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    let items = [];
    if (parsed.rss && parsed.rss.channel) {
      const rawItems = parsed.rss.channel.item;
      items = Array.isArray(rawItems) ? rawItems : (rawItems ? [rawItems] : []);
    } else if (parsed.feed && parsed.feed.entry) {
      const entries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
      items = entries.map(e => ({
        title: e.title && typeof e.title === 'object' ? e.title._ || e.title : e.title,
        link: e.link && e.link.$ ? e.link.$.href : (typeof e.link === 'string' ? e.link : ''),
        description: e.summary || e.content || '',
        pubDate: e.updated || e.published || ''
      }));
    }
    const limit = Number(params.limit) || 10;
    const result = items.slice(0, limit).map((item, i) => {
      const title = typeof item.title === 'object' ? (item.title._ || JSON.stringify(item.title)) : (item.title || '无标题');
      const link = typeof item.link === 'object' ? (item.link.$ ? item.link.$.href : '') : (item.link || '');
      const desc = (item.description || item['content:encoded'] || '').replace(/<[^>]*>/g, '').substring(0, 150);
      return (i+1) + ". " + title + "\\n   " + link + "\\n   " + (desc ? desc + "..." : "") + "\\n   " + (item.pubDate || '');
    });
    const feedTitle = parsed.rss ? (parsed.rss.channel.title || 'RSS') : (parsed.feed.title || 'Feed');
    return {
      success: true,
      message: "📰 " + feedTitle + " (共 " + items.length + " 条，显示 " + Math.min(limit, items.length) + " 条)\\n\\n" + result.join("\\n\\n"),
      data: { total: items.length, shown: Math.min(limit, items.length) }
    };
  } catch(e) {
    return { success: false, message: "RSS解析失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: ["xml2js"],
      timeout: 15000
    },
    enabled: true
  },
  {
    name: "ocr_image",
    displayName: "图像文字识别",
    description: "对图片进行OCR文字识别，提取图片中的文本内容。支持本地文件路径和网络URL，支持中英文识别。",
    icon: "Camera",
    category: "office",
    version: "1.0.0",
    author: "xiniu",
    tags: ["OCR", "文字识别", "图片"],
    parameters: [
      { name: "image", type: "string", description: "图片路径（本地绝对路径或网络URL）", required: true },
      { name: "language", type: "string", description: "识别语言：chi_sim(中文简体), eng(英文), 默认chi_sim+eng", required: false, default: "chi_sim+eng" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const Tesseract = require('tesseract.js');
  const path = require('path');
  const fs = require('fs');
  try {
    let imagePath = params.image;
    let tempFile = null;
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
      const res = await fetch(imagePath);
      const buffer = Buffer.from(await res.arrayBuffer());
      tempFile = path.join(os.tmpdir(), 'xiniu_ocr_' + Date.now() + '.png');
      fs.writeFileSync(tempFile, buffer);
      imagePath = tempFile;
    }
    if (!imagePath.startsWith('http') && !fs.existsSync(imagePath)) {
      return { success: false, message: "图片文件不存在: " + imagePath };
    }
    const lang = params.language || 'chi_sim+eng';
    const { data } = await Tesseract.recognize(imagePath, lang, {
      logger: () => {}
    });
    if (tempFile) fs.unlinkSync(tempFile);
    if (!data.text || data.text.trim().length === 0) {
      return { success: true, message: "未识别到文字内容", data: { text: "", confidence: data.confidence } };
    }
    return {
      success: true,
      message: "OCR识别结果 (置信度: " + Math.round(data.confidence) + "%):\\n\\n" + data.text.trim(),
      data: { text: data.text.trim(), confidence: data.confidence, words: data.words?.length || 0 }
    };
  } catch(e) {
    return { success: false, message: "OCR识别失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: ["tesseract.js"],
      timeout: 60000
    },
    enabled: true
  },
  {
    name: "ip_lookup",
    displayName: "IP地理位置查询",
    description: "查询IP地址的地理位置信息，包括国家、城市、ISP、经纬度等。不提供IP则查询本机公网IP。",
    icon: "Globe",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["IP", "地理位置", "网络"],
    parameters: [
      { name: "ip", type: "string", description: "要查询的IP地址，留空则查询本机公网IP", required: false, default: "" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const ip = params.ip || '';
    const url = ip ? "http://ip-api.com/json/" + ip + "?lang=zh-CN&fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query" : "http://ip-api.com/json/?lang=zh-CN&fields=status,message,country,regionName,city,zip,lat,lon,timezone,isp,org,as,query";
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'success') {
      return { success: false, message: "IP查询失败: " + (data.message || "未知错误") };
    }
    return {
      success: true,
      message: "IP地址: " + data.query + "\\n国家: " + data.country + "\\n地区: " + data.regionName + "\\n城市: " + data.city + "\\n邮编: " + (data.zip || "N/A") + "\\n经纬度: " + data.lat + ", " + data.lon + "\\n时区: " + data.timezone + "\\nISP: " + data.isp + "\\n组织: " + (data.org || "N/A") + "\\nAS: " + (data.as || "N/A"),
      data
    };
  } catch(e) {
    return { success: false, message: "IP查询失败: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 10000
    },
    enabled: true
  },
  {
    name: "translate_text",
    displayName: "多语言翻译",
    description: "将文本翻译为指定语言。支持中英日韩法德西等主流语言，使用免费翻译API。",
    icon: "Languages",
    category: "life",
    version: "1.0.0",
    author: "xiniu",
    tags: ["翻译", "多语言", "文本"],
    parameters: [
      { name: "text", type: "string", description: "要翻译的文本", required: true },
      { name: "to", type: "string", description: "目标语言代码：zh(中文), en(英语), ja(日语), ko(韩语), fr(法语), de(德语), es(西班牙语)", required: true },
      { name: "from", type: "string", description: "源语言代码（可选，自动检测）", required: false, default: "auto" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const text = params.text;
    const to = params.to || 'en';
    const from = params.from || 'auto';
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
    name: "dns_lookup",
    displayName: "DNS域名解析",
    description: "查询域名的DNS记录，支持A、AAAA、MX、TXT、NS、CNAME等记录类型。可用于域名诊断和信息收集。",
    icon: "Search",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["DNS", "域名", "网络"],
    parameters: [
      { name: "domain", type: "string", description: "要查询的域名，如 example.com", required: true },
      { name: "type", type: "string", description: "记录类型: A, AAAA, MX, TXT, NS, CNAME, SOA (默认A)", required: false, default: "A" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  const dns = require('dns').promises;
  const domain = params.domain;
  const recordType = (params.type || 'A').toUpperCase();
  try {
    let result;
    switch(recordType) {
      case 'A': result = await dns.resolve4(domain); break;
      case 'AAAA': result = await dns.resolve6(domain); break;
      case 'MX': result = await dns.resolveMx(domain); break;
      case 'TXT': result = await dns.resolveTxt(domain); break;
      case 'NS': result = await dns.resolveNs(domain); break;
      case 'CNAME': result = await dns.resolveCname(domain); break;
      case 'SOA': result = await dns.resolveSoa(domain); break;
      default: return { success: false, message: "不支持的记录类型: " + recordType };
    }
    let formatted;
    if (recordType === 'MX') {
      formatted = result.map(r => "优先级 " + r.priority + ": " + r.exchange).join("\\n");
    } else if (recordType === 'TXT') {
      formatted = result.map(r => Array.isArray(r) ? r.join('') : String(r)).join("\\n");
    } else if (recordType === 'SOA') {
      formatted = "主DNS: " + result.nsname + "\\n管理邮箱: " + result.hostmaster + "\\n序列号: " + result.serial + "\\n刷新: " + result.refresh + "s\\n重试: " + result.retry + "s\\n过期: " + result.expire + "s\\nTTL: " + result.minttl + "s";
    } else {
      formatted = Array.isArray(result) ? result.join("\\n") : String(result);
    }
    return {
      success: true,
      message: "DNS查询结果 - " + domain + " [" + recordType + "]:\\n\\n" + formatted,
      data: { domain, type: recordType, records: result }
    };
  } catch(e) {
    if (e.code === 'ENODATA') return { success: true, message: domain + " 没有 " + recordType + " 记录", data: { domain, type: recordType, records: [] } };
    if (e.code === 'ENOTFOUND') return { success: false, message: "域名不存在: " + domain };
    return { success: false, message: "DNS查询失败: " + e.message };
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
    version: "1.0.0",
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
    const interval = cronParser.parseExpression(expr);
    const nextTimes = [];
    for (let i = 0; i < count; i++) {
      const next = interval.next();
      nextTimes.push(next.toDate().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
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
    return {
      success: true,
      message: desc,
      data: { expression: expr, nextTimes }
    };
  } catch(e) {
    return { success: false, message: "Cron表达式解析失败: " + e.message + "\\n\\n常用示例:\\n* * * * * = 每分钟\\n0 9 * * * = 每天9点\\n0 9 * * 1-5 = 工作日9点\\n0 */2 * * * = 每2小时\\n30 8 1 * * = 每月1日8:30" };
  }
}`,
      runtime: "node",
      dependencies: ["cron-parser"],
      timeout: 5000
    },
    enabled: true
  },
  {
    name: "regex_tester",
    displayName: "正则表达式测试",
    description: "测试正则表达式匹配结果。输入正则和测试文本，返回所有匹配项、捕获组和位置信息。支持调试和验证正则。",
    icon: "Terminal",
    category: "dev",
    version: "1.0.0",
    author: "xiniu",
    tags: ["正则", "regex", "开发工具"],
    parameters: [
      { name: "pattern", type: "string", description: "正则表达式（不含斜杠，如 \\d+\\.\\d+）", required: true },
      { name: "text", type: "string", description: "要测试的文本", required: true },
      { name: "flags", type: "string", description: "正则标志: g(全局) i(忽略大小写) m(多行) s(dotAll)，默认g", required: false, default: "g" }
    ],
    execution: {
      type: "code",
      code: `async function execute(params) {
  try {
    const { pattern, text, flags = 'g' } = params;
    const regex = new RegExp(pattern, flags);
    const matches = [];
    let match;
    if (flags.includes('g')) {
      while ((match = regex.exec(text)) !== null) {
        const m = { full: match[0], index: match.index, groups: [] };
        for (let i = 1; i < match.length; i++) {
          m.groups.push({ group: i, value: match[i] || null });
        }
        matches.push(m);
        if (matches.length > 100) break;
      }
    } else {
      match = regex.exec(text);
      if (match) {
        const m = { full: match[0], index: match.index, groups: [] };
        for (let i = 1; i < match.length; i++) {
          m.groups.push({ group: i, value: match[i] || null });
        }
        matches.push(m);
      }
    }
    if (matches.length === 0) {
      return { success: true, message: "无匹配结果\\n\\n正则: /" + pattern + "/" + flags + "\\n测试文本: " + text.substring(0, 200), data: { matches: [], count: 0 } };
    }
    let msg = "匹配结果 (共 " + matches.length + " 个):\\n\\n正则: /" + pattern + "/" + flags + "\\n\\n";
    matches.forEach((m, i) => {
      msg += "匹配 " + (i+1) + ": \\"" + m.full + "\\" (位置: " + m.index + ")\\n";
      if (m.groups.length > 0) {
        m.groups.forEach(g => {
          msg += "  捕获组 " + g.group + ": " + (g.value !== null ? "\\"" + g.value + "\\"" : "null") + "\\n";
        });
      }
    });
    return { success: true, message: msg, data: { matches, count: matches.length } };
  } catch(e) {
    return { success: false, message: "正则表达式错误: " + e.message };
  }
}`,
      runtime: "node",
      dependencies: [],
      timeout: 5000
    },
    enabled: true
  }
];

async function addSkills() {
  console.log("开始添加 " + skills.length + " 个技能...\n");
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
        results.push({ name: skill.name, status: "failed", error: data.message || data.errors });
      }
    } catch (e) {
      console.log("[ERROR] " + skill.displayName + ": " + e.message);
      results.push({ name: skill.name, status: "error", error: e.message });
    }
  }

  console.log("\n=== 添加完成 ===");
  console.log("成功: " + results.filter(r => r.status === "created").length);
  console.log("失败: " + results.filter(r => r.status !== "created").length);
}

addSkills();
