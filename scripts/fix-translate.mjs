const BASE = "http://localhost:3000/api/skills/manage";

const skill = {
  name: "translate_text",
  displayName: "多语言翻译",
  description: "将文本翻译为指定语言。支持中英日韩法德西等主流语言，使用免费翻译API。",
  icon: "Languages",
  category: "life",
  version: "1.0.2",
  author: "xiniu",
  tags: ["翻译", "多语言", "文本"],
  parameters: [
    { name: "text", type: "string", description: "要翻译的文本", required: true },
    { name: "to", type: "string", description: "目标语言：zh-CN(中文), en-GB(英语), ja(日语), ko(韩语), fr-FR(法语), de-DE(德语), es-ES(西班牙语)", required: true },
    { name: "from", type: "string", description: "源语言代码，如 en-GB/zh-CN/ja（留空自动检测）", required: false, default: "" }
  ],
  execution: {
    type: "code",
    code: `async function execute(params) {
  try {
    const text = params.text;
    let to = params.to || 'en-GB';
    let from = params.from || '';
    const langMap = {zh:'zh-CN',en:'en-GB',fr:'fr-FR',de:'de-DE',es:'es-ES',pt:'pt-PT',it:'it-IT',ru:'ru-RU'};
    if (langMap[to]) to = langMap[to];
    if (from && langMap[from]) from = langMap[from];
    if (!from) {
      const hasChinese = /[\\u4e00-\\u9fff]/.test(text);
      const hasJapanese = /[\\u3040-\\u309f\\u30a0-\\u30ff]/.test(text);
      const hasKorean = /[\\uac00-\\ud7af]/.test(text);
      if (hasChinese) from = 'zh-CN';
      else if (hasJapanese) from = 'ja';
      else if (hasKorean) from = 'ko';
      else from = 'en-GB';
    }
    if (from.split('-')[0] === to.split('-')[0]) {
      return { success: false, message: "源语言和目标语言相同: " + from + " → " + to + "，请指定不同的语言" };
    }
    const url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text.substring(0, 500)) + "&langpair=" + from + "|" + to;
    const res = await fetch(url);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData) {
      const translated = data.responseData.translatedText;
      const match = data.responseData.match;
      const langNames = {'zh-CN':"中文",'en-GB':"英语",ja:"日语",ko:"韩语",'fr-FR':"法语",'de-DE':"德语",'es-ES':"西班牙语",'ru-RU':"俄语",'pt-PT':"葡萄牙语",'it-IT':"意大利语",ar:"阿拉伯语"};
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
};

async function fix() {
  const res = await fetch(BASE, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(skill) });
  const data = await res.json();
  console.log(data.success ? "翻译技能更新成功 v1.0.2" : "更新失败: " + data.message);

  // 测试
  const tests = [
    { text: "Hello World", to: "zh-CN", from: "en-GB" },
    { text: "你好世界", to: "en-GB" },
    { text: "こんにちは", to: "zh-CN" },
  ];
  for (const t of tests) {
    const r = await fetch("http://localhost:3000/api/skills/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName: "translate_text", params: t }),
    });
    const d = await r.json();
    console.log((d.success ? "[PASS]" : "[FAIL]"), JSON.stringify(t), "→", (d.message || "").substring(0, 100));
  }
}

fix();
