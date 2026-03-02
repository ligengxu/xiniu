const BASE = "http://localhost:3000";

const testCodeSkill = {
  name: "test_code_skill",
  displayName: "代码技能测试",
  description: "测试 code 类型技能的执行能力",
  icon: "Code2",
  category: "dev",
  parameters: [
    { name: "name", type: "string", description: "名字", required: true },
  ],
  execution: {
    type: "code",
    code: [
      "async function execute(params) {",
      "  const uptime = os.uptime();",
      "  const platform = os.platform();",
      "  const mem = (os.totalmem() / 1073741824).toFixed(1);",
      "  return {",
      "    success: true,",
      "    message: `Hello ${params.name}! Platform: ${platform}, RAM: ${mem}GB, Uptime: ${Math.floor(uptime/3600)}h`",
      "  };",
      "}",
    ].join("\n"),
    runtime: "node",
    dependencies: [],
    timeout: 10000,
  },
};

async function run() {
  console.log("=== Test Code Skill System ===\n");

  // 1. Save the code skill
  console.log("1. Saving code skill...");
  let res = await fetch(`${BASE}/api/skills/manage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(testCodeSkill),
  });
  let data = await res.json();
  console.log("   Save:", data.success ? "OK" : "FAIL - " + (data.message || JSON.stringify(data.errors)));

  // 2. Execute via test API
  console.log("2. Executing code skill...");
  res = await fetch(`${BASE}/api/skills/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillName: "test_code_skill", params: { name: "犀牛" } }),
  });
  data = await res.json();
  console.log("   Result:", data.success ? "PASS" : "FAIL", "-", data.message);

  // 3. Test a code skill with dependencies
  const skillWithDeps = {
    name: "test_dayjs_skill",
    displayName: "日期格式化",
    description: "测试带依赖的 code 技能",
    icon: "Calendar",
    category: "dev",
    parameters: [
      { name: "format", type: "string", description: "日期格式", required: false, default: "YYYY-MM-DD HH:mm:ss" },
    ],
    execution: {
      type: "code",
      code: [
        "async function execute(params) {",
        "  const dayjs = require('dayjs');",
        "  const now = dayjs().format(params.format || 'YYYY-MM-DD HH:mm:ss');",
        "  return { success: true, message: `当前时间: ${now}` };",
        "}",
      ].join("\n"),
      runtime: "node",
      dependencies: ["dayjs"],
      timeout: 30000,
    },
  };

  console.log("3. Saving skill with dependency (dayjs)...");
  res = await fetch(`${BASE}/api/skills/manage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(skillWithDeps),
  });
  data = await res.json();
  console.log("   Save:", data.success ? "OK" : "FAIL - " + (data.message || JSON.stringify(data.errors)));

  console.log("4. Executing skill with dependency...");
  res = await fetch(`${BASE}/api/skills/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skillName: "test_dayjs_skill", params: { format: "YYYY年MM月DD日" } }),
  });
  data = await res.json();
  console.log("   Result:", data.success ? "PASS" : "FAIL", "-", data.message);

  // 5. Cleanup
  console.log("5. Cleanup test skills...");
  await fetch(`${BASE}/api/skills/manage?name=test_code_skill`, { method: "DELETE" });
  await fetch(`${BASE}/api/skills/manage?name=test_dayjs_skill`, { method: "DELETE" });
  console.log("   Done");

  // 6. Verify total skill count
  res = await fetch(`${BASE}/api/skills`);
  data = await res.json();
  console.log(`\n=== Skills: ${data.length} total ===`);
}

run().catch(console.error);
