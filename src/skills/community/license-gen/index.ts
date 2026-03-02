import { z } from "zod";
import type { SkillDefinition } from "../types";

const LICENSES: Record<string, { name: string; spdx: string; template: string }> = {
  mit: {
    name: "MIT License",
    spdx: "MIT",
    template: `MIT License

Copyright (c) {{year}} {{author}}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`,
  },
  apache2: {
    name: "Apache License 2.0",
    spdx: "Apache-2.0",
    template: `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

Copyright {{year}} {{author}}

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,
  },
  gpl3: {
    name: "GNU General Public License v3.0",
    spdx: "GPL-3.0",
    template: `{{project}} - {{description}}
Copyright (C) {{year}} {{author}}

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.`,
  },
  bsd2: {
    name: "BSD 2-Clause License",
    spdx: "BSD-2-Clause",
    template: `BSD 2-Clause License

Copyright (c) {{year}}, {{author}}
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`,
  },
  isc: {
    name: "ISC License",
    spdx: "ISC",
    template: `ISC License

Copyright (c) {{year}}, {{author}}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.`,
  },
  unlicense: {
    name: "The Unlicense",
    spdx: "Unlicense",
    template: `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>`,
  },
};

export const licenseGenSkill: SkillDefinition = {
  name: "license_gen",
  displayName: "开源协议生成",
  description:
    "生成开源LICENSE文件，支持MIT、Apache 2.0、GPL 3.0、BSD、ISC、Unlicense等主流协议。" +
    "用户说'LICENSE'、'开源协议'、'许可证'时使用。",
  icon: "Scale",
  category: "dev",
  parameters: z.object({
    license: z.enum(["mit", "apache2", "gpl3", "bsd2", "isc", "unlicense", "list"]).describe(
      "协议类型: mit/apache2/gpl3/bsd2/isc/unlicense，或 list 列出所有可用协议"
    ),
    author: z.string().optional().describe("作者/版权持有者名称"),
    year: z.string().optional().describe("版权年份，默认当前年"),
    project: z.string().optional().describe("项目名称 (GPL需要)"),
    savePath: z.string().optional().describe("保存路径，默认桌面/LICENSE"),
  }),
  execute: async (params) => {
    const { license, author, year, project, savePath } = params as {
      license: string; author?: string; year?: string; project?: string; savePath?: string;
    };

    if (license === "list") {
      let msg = `📜 可用开源协议\n━━━━━━━━━━━━━━━━━━━━\n`;
      for (const [key, info] of Object.entries(LICENSES)) {
        msg += `  • ${key} — ${info.name} (${info.spdx})\n`;
      }
      msg += `\n💡 最流行: MIT (宽松) > Apache 2.0 (专利保护) > GPL 3.0 (传染性)`;
      return { success: true, message: msg };
    }

    const licenseInfo = LICENSES[license];
    if (!licenseInfo) return { success: false, message: `❌ 未知协议: ${license}\n可用: ${Object.keys(LICENSES).join(", ")}` };

    try {
      const fs = await import("fs");
      const path = await import("path");

      const y = year || String(new Date().getFullYear());
      const a = author || "Your Name";
      const p = project || "Project";

      let content = licenseInfo.template
        .replace(/{{year}}/g, y)
        .replace(/{{author}}/g, a)
        .replace(/{{project}}/g, p)
        .replace(/{{description}}/g, "");

      const outputPath = savePath || path.join("C:\\Users\\Administrator\\Desktop", "LICENSE");
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, content + "\n", "utf-8");

      let msg = `✅ LICENSE 文件已生成\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `📜 协议: ${licenseInfo.name} (${licenseInfo.spdx})\n`;
      msg += `👤 作者: ${a}\n📅 年份: ${y}\n`;
      msg += `📁 保存: ${outputPath}`;

      return { success: true, message: msg, data: { path: outputPath, license: licenseInfo.spdx } };
    } catch (err) {
      return { success: false, message: `❌ 生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
