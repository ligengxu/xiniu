const skills = [
  {
    name: "text_translator",
    displayName: "多语言翻译",
    description: "将文本翻译为任意目标语言，支持中英日韩法德西俄等。用户说'翻译'、'translate'时调用。",
    icon: "Languages",
    category: "life",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["翻译", "多语言"],
    parameters: [
      { name: "text", type: "string", description: "要翻译的文本", required: true },
      { name: "targetLang", type: "string", description: "目标语言（如：英文、日文、法语）", required: true },
      { name: "sourceLang", type: "string", description: "源语言，默认自动检测", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "请将以下文本翻译为{{targetLang}}。要求：翻译准确自然，保持原文语气和风格，专业术语需注释。\n\n原文：\n{{text}}",
    },
  },
  {
    name: "sentiment_analysis",
    displayName: "情感分析",
    description: "分析文本的情感倾向（正面/负面/中性），给出评分和关键词。适用于评论分析、舆情监控、客户反馈分析。",
    icon: "Brain",
    category: "creative",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["NLP", "情感分析", "AI"],
    parameters: [
      { name: "text", type: "string", description: "要分析的文本", required: true },
      { name: "detail", type: "boolean", description: "是否输出详细分析（含关键词和置信度），默认true", required: false, default: true },
    ],
    execution: {
      type: "prompt",
      prompt: "请对以下文本进行情感分析，输出格式：\n1. 情感倾向：正面/负面/中性\n2. 情感评分：-1.0 到 1.0\n3. 关键情感词：列出影响判断的关键词\n4. 情感维度：快乐/悲伤/愤怒/恐惧/惊讶/厌恶（多选）\n5. 分析理由：简述判断依据\n\n文本：\n{{text}}",
    },
  },
  {
    name: "keyword_extractor",
    displayName: "关键词提取",
    description: "从文本中提取核心关键词和摘要。支持长文本、文章、报告的关键信息提取。",
    icon: "Sparkles",
    category: "creative",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["NLP", "关键词", "摘要"],
    parameters: [
      { name: "text", type: "string", description: "要提取关键词的文本", required: true },
      { name: "maxKeywords", type: "number", description: "最多提取多少个关键词，默认10", required: false, default: 10 },
    ],
    execution: {
      type: "prompt",
      prompt: "请从以下文本中提取核心信息，输出：\n1. 关键词（最多{{maxKeywords}}个）：按重要性排序\n2. 一句话摘要\n3. 主题分类\n4. 命名实体（人名/地名/组织/产品）\n\n文本：\n{{text}}",
    },
  },
  {
    name: "content_classifier",
    displayName: "内容分类",
    description: "对文本/文章进行自动分类，识别主题领域、内容类型、适用场景。可用于内容管理、自动打标签。",
    icon: "ListTodo",
    category: "creative",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["NLP", "分类", "标签"],
    parameters: [
      { name: "text", type: "string", description: "要分类的文本内容", required: true },
      { name: "categories", type: "string", description: "可选的自定义分类列表（逗号分隔），如 '科技,财经,体育,娱乐'。不填则自动识别", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "请对以下内容进行分类分析：\n\n1. 主题分类：{{categories}}\n2. 内容类型：新闻/评论/教程/广告/学术/其他\n3. 阅读难度：初级/中级/高级\n4. 目标读者：描述适合的读者群体\n5. 关键标签：5个以内\n6. 置信度：0-100%\n\n内容：\n{{text}}",
    },
  },
  {
    name: "email_drafter",
    displayName: "邮件草稿生成",
    description: "根据场景和要求生成专业邮件草稿。支持商务邮件、求职信、通知、道歉信、感谢信等各种场景。",
    icon: "Mail",
    category: "office",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["邮件", "写作", "办公"],
    parameters: [
      { name: "scenario", type: "string", description: "邮件场景，如 '商务合作洽谈', '求职应聘', '项目延期通知', '感谢客户'", required: true },
      { name: "recipient", type: "string", description: "收件人角色/称呼，如 '张总', 'HR', '合作伙伴'", required: true },
      { name: "keyPoints", type: "string", description: "邮件核心要点（用分号分隔）", required: true },
      { name: "tone", type: "string", description: "语气风格：正式/友好/紧急/诚恳，默认正式", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "请撰写一封{{tone}}风格的中文邮件草稿：\n\n场景：{{scenario}}\n收件人：{{recipient}}\n核心要点：{{keyPoints}}\n\n要求：\n- 格式完整（称呼、正文、结语、落款）\n- 语言得体专业\n- 逻辑清晰\n- 控制在300字以内",
    },
  },
  {
    name: "code_reviewer",
    displayName: "代码审查",
    description: "AI审查代码质量，检查潜在bug、安全漏洞、性能问题，给出改进建议。支持所有主流编程语言。",
    icon: "Code",
    category: "dev",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["代码", "审查", "安全"],
    parameters: [
      { name: "code", type: "string", description: "要审查的代码", required: true },
      { name: "language", type: "string", description: "编程语言，如 Python, JavaScript, Java, Go", required: false },
      { name: "focus", type: "string", description: "审查重点：安全/性能/可读性/全面，默认全面", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "请作为资深代码审查员审查以下{{language}}代码，重点关注{{focus}}：\n\n```\n{{code}}\n```\n\n请输出：\n1. 总体评分（1-10分）\n2. 严重问题（Bug/安全漏洞）\n3. 改进建议（性能/可读性/最佳实践）\n4. 代码亮点\n5. 修复后的代码片段（针对严重问题）",
    },
  },
  {
    name: "data_converter",
    displayName: "数据格式转换",
    description: "在JSON、CSV、YAML、XML、Markdown表格等格式之间互相转换。支持数据清洗和格式化。",
    icon: "FileSpreadsheet",
    category: "dev",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["数据", "转换", "JSON", "CSV"],
    parameters: [
      { name: "data", type: "string", description: "输入数据", required: true },
      { name: "fromFormat", type: "string", description: "源格式：json/csv/yaml/xml/markdown，不填自动检测", required: false },
      { name: "toFormat", type: "string", description: "目标格式：json/csv/yaml/xml/markdown", required: true },
    ],
    execution: {
      type: "prompt",
      prompt: "请将以下{{fromFormat}}数据转换为{{toFormat}}格式：\n\n```\n{{data}}\n```\n\n要求：\n- 保持数据完整性\n- 格式规范（缩进、引号、分隔符等）\n- 如果数据有问题，指出并修正\n- 只输出转换后的数据，不需要额外解释",
    },
  },
  {
    name: "regex_helper",
    displayName: "正则表达式助手",
    description: "根据需求生成正则表达式，或解释已有正则的含义。支持匹配测试、常用模式推荐。",
    icon: "Terminal",
    category: "dev",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["正则", "开发工具"],
    parameters: [
      { name: "request", type: "string", description: "描述你的需求，如 '匹配中国手机号', '提取URL中的域名', 或直接粘贴正则表达式求解释", required: true },
      { name: "testString", type: "string", description: "用于测试的示例字符串", required: false },
      { name: "language", type: "string", description: "目标语言(JavaScript/Python/Java/Go)，影响正则语法，默认JavaScript", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "作为正则表达式专家，处理以下请求：\n\n需求：{{request}}\n目标语言：{{language}}\n测试字符串：{{testString}}\n\n请输出：\n1. 正则表达式\n2. 逐段解释\n3. 使用示例代码（{{language}}）\n4. 匹配结果（如有测试字符串）\n5. 边缘情况提醒",
    },
  },
  {
    name: "meeting_minutes",
    displayName: "会议纪要生成",
    description: "根据会议录音文字稿或笔记，自动生成结构化会议纪要。包含要点、决议、待办事项、责任人。",
    icon: "BookOpen",
    category: "office",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["会议", "纪要", "办公"],
    parameters: [
      { name: "content", type: "string", description: "会议内容（文字稿、笔记或要点）", required: true },
      { name: "meetingTitle", type: "string", description: "会议主题", required: false },
      { name: "participants", type: "string", description: "参会人员列表，逗号分隔", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "请根据以下内容生成专业会议纪要：\n\n会议主题：{{meetingTitle}}\n参会人员：{{participants}}\n\n会议内容：\n{{content}}\n\n输出格式：\n1. 会议概要（一句话）\n2. 主要议题及讨论内容\n3. 决议事项（编号列出）\n4. 待办事项（含责任人和截止时间）\n5. 下次会议安排建议",
    },
  },
  {
    name: "api_tester",
    displayName: "API测试助手",
    description: "根据API描述生成测试请求（curl/fetch/axios），分析API响应，生成接口文档。适合接口联调和测试。",
    icon: "Zap",
    category: "dev",
    version: "1.0.0",
    author: "xiniu-store",
    tags: ["API", "测试", "接口"],
    parameters: [
      { name: "apiInfo", type: "string", description: "API描述：URL、方法、参数、认证方式等", required: true },
      { name: "action", type: "string", description: "操作：generate_curl(生成curl命令)/generate_docs(生成文档)/analyze_response(分析响应)/generate_test(生成测试用例)", required: true },
      { name: "response", type: "string", description: "API响应内容（analyze_response模式时使用）", required: false },
    ],
    execution: {
      type: "prompt",
      prompt: "作为API测试专家，执行以下任务：\n\n操作：{{action}}\nAPI信息：{{apiInfo}}\n{{response}}\n\n根据操作类型输出：\n- generate_curl: 生成可直接运行的curl命令，含完整headers和body\n- generate_docs: 生成Markdown格式API文档（含请求/响应示例）\n- analyze_response: 分析响应状态、数据结构、异常点\n- generate_test: 生成正向/反向/边界测试用例",
    },
  },
];

async function seed() {
  let ok = 0, fail = 0;
  for (const skill of skills) {
    try {
      const res = await fetch("http://localhost:3000/api/skills/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skill),
      });
      const data = await res.json();
      if (data.success) {
        console.log("[OK]", skill.name, skill.displayName);
        ok++;
      } else {
        console.log("[FAIL]", skill.name, data.message || data.errors?.join(", "));
        fail++;
      }
    } catch (err) {
      console.log("[ERR]", skill.name, err.message);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} success, ${fail} failed`);
}

seed();
