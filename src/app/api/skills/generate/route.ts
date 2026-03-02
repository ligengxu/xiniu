import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getModel } from "@/lib/models";
import { validateSkillConfig, skillConfigToJsonSchema } from "@/skills/schema";
import { getAllSkills } from "@/skills/registry";

function buildGeneratePrompt(): string {
  const allSkills = getAllSkills();
  const toolListStr = allSkills.map((s) => s.name).join(", ");

  return `你是一个技能配置生成器。用户会用自然语言描述他们想要的技能，你需要生成一个完整的 SkillConfig JSON。

JSON Schema 如下：
${JSON.stringify(skillConfigToJsonSchema(), null, 2)}

规则：
1. name 字段只能用小写字母、数字和下划线，以字母开头
2. displayName 用中文
3. description 要清晰描述功能，便于 AI 理解何时调用
4. icon 使用 Lucide 图标名（如 Languages, Globe, FileText, Terminal, Wrench, Search, BookOpen, Calculator, Database, Cpu, HardDrive, Network, Shield, Code2, Palette）
5. category 从 office/dev/life/creative 中选择
6. parameters 定义用户需要提供的输入参数
7. execution 选择 prompt、compose 或 code 类型：
   - prompt: 通过 AI Prompt 模板实现（适合文本处理、翻译、分析等纯文本任务）
   - compose: 组合已有工具按步骤执行（适合多步骤自动化流程）
   - code: 编写 Node.js 代码直接执行（适合需要调用系统API、文件操作、网络请求、数据计算等需要真正运行代码的任务）

## 三种类型的选择标准：
- 如果任务只需要AI理解和生成文本 → 用 prompt
- 如果任务需要串联已有的工具完成多步流程 → 用 compose
- 如果任务需要真正执行代码（文件读写、网络请求、数据计算、调用系统命令、操作数据库等） → 用 code

## code 类型的代码规范：
- 代码必须定义一个 async function execute(params) 函数
- params 是用户传入的参数对象
- 函数必须返回 { success: boolean, message: string, data?: any }
- 可以使用 require() 加载 Node.js 内置模块（fs, path, os, child_process, http, https, crypto, url, querystring 等）
- 如果需要第三方npm包，在 dependencies 数组中列出包名
- 可以使用全局 fetch API
- 代码中可用的预定义变量: path, fs, os, __execAsync (promisified exec)

## code 类型示例：
{
  "name": "disk_usage",
  "displayName": "磁盘使用分析",
  "description": "分析指定目录的磁盘使用情况",
  "icon": "HardDrive",
  "category": "dev",
  "parameters": [{"name": "directory", "type": "string", "description": "目标目录路径", "required": true}],
  "execution": {
    "type": "code",
    "code": "async function execute(params) { const dir = params.directory; const items = fs.readdirSync(dir); return { success: true, message: 'Found ' + items.length + ' items in ' + dir }; }",
    "runtime": "node",
    "dependencies": [],
    "timeout": 15000
  }
}

## prompt 类型模板规则：
- 模板中用 {{参数名}} 引用参数

已有内置工具列表（compose 模式可调用）：
${toolListStr}

只输出 JSON，不要包含任何其他文字、解释或 markdown 标记。`;
}

export async function POST(req: Request) {
  try {
    const { description, providerId = "claudelocal", modelId = "claude-sonnet-4-6", apiKey: clientApiKey, baseUrl: clientBaseUrl } = await req.json();

    if (!description || typeof description !== "string") {
      return NextResponse.json(
        { success: false, message: "请提供技能描述（description 字段）" },
        { status: 400 }
      );
    }

    const model = getModel(providerId, modelId, clientApiKey, clientBaseUrl);
    const systemPrompt = buildGeneratePrompt();

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: description,
      maxOutputTokens: 4096,
    });

    let parsed: unknown;
    try {
      let text = result.text.trim();
      const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) text = jsonMatch[1].trim();
      if (text.startsWith("{")) {
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > 0) text = text.substring(0, lastBrace + 1);
      }
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "AI 生成的内容不是有效 JSON",
          rawOutput: result.text,
        },
        { status: 422 }
      );
    }

    const validation = validateSkillConfig(parsed);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "AI 生成的配置校验失败",
          errors: validation.errors,
          rawConfig: parsed,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      skill: validation.data,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `生成失败: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }
}
