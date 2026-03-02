# 犀牛 Agent

全栈 AI Agent 平台，内置 20+ 核心技能，商店提供 76+ 社区技能按需安装。

## 一句话安装

自动检测系统环境（Git/Node.js），国内用户自动切换加速镜像，缺少依赖交互式引导安装。

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

**Windows（PowerShell 管理员）：**

```powershell
irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

**自定义安装目录：**

```bash
XINIU_DIR=/opt/xiniu curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

```powershell
$env:XINIU_DIR="D:\xiniu"; irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

## 安装脚本做了什么

```
1. 检测区域 → 国内自动用 ghproxy/npmmirror 镜像
2. 检测 Git   → 缺失则通过 apt/yum/brew/winget/scoop 自动安装
3. 检测 Node  → 缺失则提供 nvm / MSI / 包管理器 三种安装方式
4. 配置 npm   → 国内用户提示切换淘宝镜像
5. 克隆项目   → 国内依次尝试多个 GitHub 加速镜像
6. 安装依赖   → npm install (自动使用对应镜像源)
7. 生成配置   → 创建 .env.local 模板
8. 启动询问   → 可选立即启动开发服务器
```

## 手动安装

```bash
git clone https://github.com/ligengxu/xiniu.git
cd xiniu
npm install
cp .env.example .env.local   # 编辑填入 API Key
npm run dev
```

## 技能商店

启动后访问 `http://localhost:3000/skills` → 「商店」标签页：

- 76 个社区技能一键安装，自动下载依赖
- 国内用户自动使用 npmmirror 镜像
- 支持单个安装 / 全部安装 / 卸载
- 技能分类：办公、开发、生活、创意

## 技术栈

- **框架**: Next.js 16 + React 19
- **语言**: TypeScript 5
- **样式**: Tailwind CSS 4
- **AI SDK**: Vercel AI SDK + OpenAI/Anthropic/DashScope
- **运行时**: Node.js 18+

## 项目结构

```
src/
├── app/              # Next.js 页面和 API
├── components/       # React 组件
├── lib/              # 工具函数
└── skills/
    ├── *.ts          # 核心技能 (~20个，内置)
    ├── community/    # 社区技能 (按需安装)
    │   ├── skills-manifest.json  # 技能清单
    │   └── {skill-name}/index.ts
    ├── registry.ts   # 技能注册中心
    ├── prompt-modules.ts
    └── types.ts
```

## License

MIT
