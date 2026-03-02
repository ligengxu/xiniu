<p align="center">
  <img src="https://img.shields.io/badge/犀牛_Agent-v1.0-blue?style=for-the-badge" alt="Version" />
  <img src="https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" />
</p>

<h1 align="center">犀牛 Agent / Xiniu Agent</h1>

<p align="center">
  <b>中文</b> ｜ <a href="#english">English</a>
</p>

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [一句话安装](#一句话安装)
- [手动安装](#手动安装)
- [技能体系](#技能体系)
- [技能商店](#技能商店)
- [技术架构](#技术架构)
- [项目结构](#项目结构)
- [配置说明](#配置说明)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [开源协议](#开源协议)

---

## 项目简介

**犀牛 Agent** 是一个开源的全栈 AI Agent 平台，让用户通过自然语言对话驱动 AI 执行真实任务——文件操作、浏览器自动化、代码运行、网络请求、系统管理等。

项目采用**核心精简 + 商店扩展**架构：Git 仓库仅包含 ~50 个核心技能（约 2MB 源码），另有 76+ 社区技能通过技能商店按需下载安装，安装时自动解决依赖并根据用户所在区域选择最快的镜像源。

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **自然语言驱动** | 用户用中文/英文描述任务，AI 自动选择并调用合适的技能 |
| **50+ 内置核心技能** | 文件管理、浏览器自动化、代码执行、系统管理、网络工具等 |
| **76+ 社区技能商店** | 按需安装，四大分类（开发/创意/办公/生活），一键安装自动下载依赖 |
| **跨平台一键安装** | 一句命令完成环境检测 + 依赖安装 + 项目部署，支持 Windows/Linux/macOS |
| **智能镜像选择** | 自动检测用户区域，国内用 npmmirror/ghproxy，海外用官方源 |
| **多 AI 模型支持** | OpenAI GPT / Anthropic Claude / 通义千问 / 任何 OpenAI 兼容 API |
| **安全凭证管理** | API Key 和密码本地加密存储，不上传不泄露 |
| **Prompt 模块系统** | 按关键词动态加载技能组，避免 token 浪费 |
| **对接设置引导** | 外部服务（机器人/云平台/OCR）提供可视化设置向导 |

---

## 一句话安装

安装脚本会自动完成：环境检测 → Git/Node.js 安装引导 → npm 镜像配置 → 项目克隆 → 依赖安装 → 配置文件生成。

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

### Windows（以管理员身份运行 PowerShell）

```powershell
irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

### 自定义安装目录

```bash
XINIU_DIR=/opt/xiniu curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

```powershell
$env:XINIU_DIR="D:\xiniu"; irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

### 安装脚本流程

```
步骤1  检测区域      → 时区/IP/语言三级判断，确定国内或海外
步骤2  检测 Git      → 缺失则自动通过 apt/yum/brew/winget/scoop 安装
步骤3  检测 Node.js  → 缺失或版本过低则提供 nvm / MSI / 包管理器选择
步骤4  配置 npm      → 国内用户提示切换淘宝镜像 (npmmirror.com)
步骤5  克隆项目      → 国内依次尝试 ghproxy 等多个加速镜像
步骤6  安装依赖      → npm install 自动使用对应镜像源
步骤7  生成配置      → 创建 .env.local 模板
步骤8  启动确认      → 询问是否立即启动开发服务器
```

---

## 手动安装

**前置要求**: Git 2+, Node.js 18+

```bash
git clone https://github.com/ligengxu/xiniu.git
cd xiniu
npm install
```

创建配置文件：

```bash
cp .env.example .env.local
```

编辑 `.env.local` 填入至少一个 AI 模型的 API Key（见 [配置说明](#配置说明)），然后启动：

```bash
npm run dev        # 开发模式，访问 http://localhost:3000
npm run build      # 生产构建
npm start          # 生产运行
```

---

## 技能体系

### 核心技能（内置，约 50 个）

核心技能编译在主仓库中，无需额外安装。

| 分类 | 技能 |
|------|------|
| **文件管理** | 创建文件夹、创建文本文件、读取文件、合并文件、批量处理、压缩解压、文件搜索 |
| **浏览器自动化** | 打开/关闭浏览器、点击、输入、截图、读取DOM、执行脚本、滚动、按键 |
| **代码执行** | 运行代码、沙箱执行、分析文件 |
| **文档生成** | Word、Excel、PPT、PDF 生成与读取 |
| **网络工具** | HTTP 请求、Web 搜索、网页爬取、下载文件/图片 |
| **系统管理** | 系统信息、进程管理、环境变量、网络诊断、端口扫描 |
| **数据处理** | JSON 校验、数据加工、文本差异比较、Base64 编解码、哈希计算 |
| **实用工具** | 二维码生成、单位换算、随机数生成、Markdown 转 HTML、文本统计、通知推送 |
| **计划任务** | 创建/列出/取消定时任务 |
| **智能调度** | 技能分发（自动选择最合适的技能）、上下文摘要 |

### 社区技能（商店按需安装，76 个）

社区技能从 GitHub `community-skills` 分支下载，安装时自动下载对应的 npm 依赖。

| 分类 | 技能数 | 包含 |
|------|--------|------|
| **开发工具** 🔧 | ~40 | Git管理、Docker管理、数据库管理、SSH远程、云部署(阿里云/腾讯云)、SSL证书、逆向工程、网络抓包、代理抓包、日志分析、编译原生代码、正则测试、JWT解析、子网计算、API Mock、Webhook接收... |
| **创意设计** 🎨 | ~15 | AI图片生成(DALL-E/SD/通义万相)、OCR文字识别、网页截图、图片压缩、SVG工具、视频分析/解说/脚本、文字转语音、占位图、媒体编辑... |
| **办公效率** 📋 | ~8 | 智能邮件、多语言翻译、PDF合并拆分、CSV工具、飞书机器人、剪贴板历史、密码生成、批量重命名... |
| **生活服务** ☕ | ~5 | 天气查询、汇率换算、股票行情、RSS订阅、电报机器人、微信机器人... |

---

## 技能商店

启动项目后访问 `http://localhost:3000/skills` → 「商店」标签页。

### 商店功能

- **分类浏览** — 四大分类卡片（开发/创意/办公/生活），点击快速筛选
- **搜索过滤** — 按名称、描述、技能ID模糊搜索
- **状态筛选** — 全部 / 已安装 / 未安装
- **视图切换** — 分类折叠视图 / 网格平铺视图
- **一键安装** — 点击即下载源码 + 自动 `npm install` 依赖
- **全部安装** — 批量安装所有 76 个社区技能
- **智能镜像** — 自动检测区域，国内用 npmmirror，海外用 npmjs
- **卸载管理** — 已安装技能支持一键卸载

### 工作原理

```
用户点击「安装」
    ↓
后端从 GitHub community-skills 分支下载 index.ts 源码
    ↓
写入 src/skills/community/{skill-dir}/index.ts
    ↓
读取 skills-manifest.json 中该技能的 deps 字段
    ↓
执行 npm install {deps} （国内自动 --registry=npmmirror）
    ↓
刷新技能注册缓存，技能立即可用
```

---

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                   浏览器客户端                      │
│         Next.js 页面 + React 19 组件               │
│     Tailwind CSS 4 · Zustand 状态 · AI SDK        │
├─────────────────────────────────────────────────┤
│                   Next.js 16 服务端                 │
│     API Routes · 技能执行引擎 · SSR/RSC            │
├───────────────┬───────────────┬──────────────────┤
│   核心技能层    │   社区技能层    │    外部服务层      │
│   (~50 内置)   │  (76+ 按需装)  │ OpenAI/Claude/   │
│   编译在仓库中  │  从 GitHub 下载 │ DashScope/...   │
├───────────────┴───────────────┴──────────────────┤
│                  基础设施层                         │
│   Node.js 18+ · TypeScript 5 · Zod 校验          │
│   凭证加密存储 · Prompt 模块动态加载                  │
└─────────────────────────────────────────────────┘
```

### 技术栈详情

| 层面 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16 |
| 前端 | React + React DOM | 19 |
| 语言 | TypeScript | 5 |
| 样式 | Tailwind CSS | 4 |
| 状态管理 | Zustand | 5 |
| AI 集成 | Vercel AI SDK + @ai-sdk/openai | 6 / 3 |
| 参数校验 | Zod | 4 |
| 图标 | Lucide React | 0.575 |
| Markdown | react-markdown + remark-gfm + rehype-katex | - |
| 文档生成 | docx / exceljs / pptxgenjs / pdf-lib | - |
| 浏览器自动化 | Puppeteer | 24 |
| 邮件 | Nodemailer | 8 |
| 爬虫 | Cheerio | 1.2 |

---

## 项目结构

```
xiniu/
├── install.sh                 # Linux/macOS 一键安装脚本
├── install.ps1                # Windows 一键安装脚本
├── package.json               # 依赖配置
├── .env.local                 # 环境变量（API Key 等，不入库）
├── .gitattributes             # Git 属性（行尾控制）
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # 主页（聊天界面）
│   │   ├── skills/page.tsx    # 技能管理页
│   │   ├── settings/page.tsx  # 设置页
│   │   └── api/               # API 路由
│   │       ├── chat/          # AI 对话接口
│   │       ├── skills/        # 技能 CRUD + 商店 + 安装 + 设置
│   │       └── ...
│   │
│   ├── components/            # React 组件
│   │   ├── chat/              # 聊天界面组件
│   │   ├── skills/            # 技能卡片、商店列表、设置引导
│   │   └── settings/          # 模型配置、主题选择
│   │
│   ├── lib/                   # 工具函数
│   │   ├── credential-store.ts  # 凭证加密存储
│   │   ├── skill-store.ts       # 本地技能索引
│   │   ├── skill-remote.ts      # 远程技能获取
│   │   └── ...
│   │
│   └── skills/                # 技能层
│       ├── types.ts           # SkillDefinition 类型定义 + SetupGuide
│       ├── registry.ts        # 技能注册中心（核心 + 社区动态加载）
│       ├── prompt-modules.ts  # Prompt 模块（按关键词分组）
│       ├── [core-skills]/     # ~50 个核心技能目录
│       └── community/         # 社区技能目录（按需安装，不入主库）
│           ├── skills-manifest.json  # 76 个技能的元数据清单
│           ├── .gitkeep
│           └── {skill-name}/index.ts # 各社区技能源码
│
└── public/                    # 静态资源
```

---

## 配置说明

所有配置通过 `.env.local` 文件管理：

```bash
# ═══ AI 模型（至少配置一个）═══

# OpenAI GPT (或任何 OpenAI 兼容 API)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1      # 可改为第三方代理地址

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

# 通义千问 (国内推荐，无需翻墙)
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx

# ═══ 可选配置 ═══

# Stability AI (图片生成)
STABILITY_API_KEY=sk-xxxxxxxxxxxxxxxx

# 邮件发送 (smart_email 技能)
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=you@example.com
SMTP_PASS=your-password
```

---

## 常见问题

**Q: 国内用户安装速度慢怎么办？**
A: 安装脚本已自动处理。如果手动安装，执行 `npm config set registry https://registry.npmmirror.com` 切换淘宝镜像。

**Q: 支持哪些 AI 模型？**
A: 支持所有 OpenAI API 兼容的模型（GPT-4o、DeepSeek、Qwen 等）、Anthropic Claude、通义千问。通过 `OPENAI_BASE_URL` 可接入任何兼容 API。

**Q: 社区技能安装后存在哪里？**
A: 存放在 `src/skills/community/{技能名}/index.ts`，不会影响 Git 仓库（已在 `.gitignore` 中排除）。

**Q: 如何开发自定义技能？**
A: 在技能管理页的「创建」标签页编写，或参照 `src/skills/types.ts` 中的 `SkillDefinition` 接口手动创建。

**Q: 如何更新到最新版本？**
A: 进入项目目录执行 `git pull origin main && npm install`。

---

## 贡献指南

1. Fork 本仓库
2. 创建功能分支: `git checkout -b feat/your-feature`
3. 提交改动: `git commit -m "feat: add your feature"`
4. 推送分支: `git push origin feat/your-feature`
5. 创建 Pull Request

### 贡献社区技能

1. 在 `src/skills/community/` 下创建新目录
2. 编写符合 `SkillDefinition` 接口的 `index.ts`
3. 在 `skills-manifest.json` 中添加技能元数据
4. 提交 PR 到 `community-skills` 分支

---

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。

---

<a id="english"></a>

<p align="center">
  <a href="#目录">中文</a> ｜ <b>English</b>
</p>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [One-Line Install](#one-line-install)
- [Manual Installation](#manual-installation)
- [Skill System](#skill-system)
- [Skill Store](#skill-store)
- [Architecture](#architecture)
- [Project Structure](#project-structure-1)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Xiniu Agent** is an open-source full-stack AI Agent platform that lets users drive AI to perform real tasks through natural language — file operations, browser automation, code execution, network requests, system management, and more.

The project follows a **lean core + store extension** architecture: the Git repository contains only ~50 core skills (~2MB source), while 76+ community skills are available for on-demand download from the Skill Store. Dependencies are automatically resolved during installation, with the fastest mirror selected based on the user's geographic region.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Natural Language Driven** | Describe tasks in plain Chinese or English, AI selects and invokes the right skill |
| **50+ Built-in Core Skills** | File management, browser automation, code execution, system admin, network tools |
| **76+ Community Skill Store** | Install on-demand across 4 categories (Dev/Creative/Office/Life), auto-resolve dependencies |
| **Cross-Platform One-Liner** | Single command installs everything — env detection + dependency setup + project deploy |
| **Smart Mirror Selection** | Auto-detects region — China uses npmmirror/ghproxy, international uses official sources |
| **Multi-Model AI Support** | OpenAI GPT / Anthropic Claude / Tongyi Qwen / any OpenAI-compatible API |
| **Secure Credential Store** | API keys and passwords encrypted locally, never uploaded |
| **Dynamic Prompt Modules** | Skills loaded by keyword groups to minimize token usage |
| **Setup Wizard** | Visual guided setup for external services (bots, cloud, OCR) |

---

## One-Line Install

The install script auto-handles: environment detection → Git/Node.js install guidance → npm registry setup → project clone → dependency install → config generation.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

### Windows (Run PowerShell as Administrator)

```powershell
irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

### Custom Install Directory

```bash
XINIU_DIR=/opt/xiniu curl -fsSL https://raw.githubusercontent.com/ligengxu/xiniu/main/install.sh | bash
```

```powershell
$env:XINIU_DIR="D:\xiniu"; irm https://raw.githubusercontent.com/ligengxu/xiniu/main/install.ps1 | iex
```

### Install Script Flow

```
Step 1  Detect Region    → Timezone/IP/locale triple check
Step 2  Check Git        → Auto-install via apt/yum/brew/winget/scoop if missing
Step 3  Check Node.js    → Offer nvm / MSI / package manager if missing or outdated
Step 4  Configure npm    → Prompt to switch to China mirror for domestic users
Step 5  Clone Project    → Try multiple GitHub proxy mirrors for China
Step 6  Install Deps     → npm install with appropriate registry
Step 7  Generate Config  → Create .env.local template
Step 8  Launch Prompt    → Ask whether to start dev server immediately
```

---

## Manual Installation

**Prerequisites**: Git 2+, Node.js 18+

```bash
git clone https://github.com/ligengxu/xiniu.git
cd xiniu
npm install
```

Create a config file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with at least one AI model API key (see [Configuration](#configuration)), then start:

```bash
npm run dev        # Development mode at http://localhost:3000
npm run build      # Production build
npm start          # Production server
```

---

## Skill System

### Core Skills (Built-in, ~50)

Core skills are compiled into the main repository and require no extra installation.

| Category | Skills |
|----------|--------|
| **File Management** | Create folder, create text, read file, merge files, batch process, zip/unzip, file search |
| **Browser Automation** | Open/close browser, click, type, screenshot, read DOM, execute script, scroll, keypress |
| **Code Execution** | Run code, sandbox execute, analyze file |
| **Document Generation** | Word, Excel, PPT, PDF generation and reading |
| **Network Tools** | HTTP requests, web search, web scraping, download files/images |
| **System Admin** | System info, process manager, env variables, network diagnostics, port scan |
| **Data Processing** | JSON validation, data processing, text diff, Base64, hash calculation |
| **Utilities** | QR code, unit conversion, random generation, Markdown to HTML, text stats, notifications |
| **Scheduling** | Create/list/cancel scheduled tasks |
| **Smart Dispatch** | Skill dispatch (auto-select best skill), context digest |

### Community Skills (Store Install, 76)

Community skills are downloaded from the GitHub `community-skills` branch. Dependencies are automatically installed.

| Category | Count | Includes |
|----------|-------|----------|
| **Dev Tools** 🔧 | ~40 | Git, Docker, Database, SSH, Cloud Deploy (Alibaba/Tencent), SSL, Reverse Engineering, Network Capture, Proxy, Log Analysis, Native Compile, Regex, JWT, Subnet Calc, API Mock, Webhook... |
| **Creative** 🎨 | ~15 | AI Image Gen (DALL-E/SD/Tongyi), OCR, Screenshots, Image Compress, SVG, Video Analysis/Narration/Script, TTS, Placeholder, Media Edit... |
| **Office** 📋 | ~8 | Smart Email, Translation, PDF Merge/Split, CSV, Feishu Bot, Clipboard History, Password Gen, Batch Rename... |
| **Life** ☕ | ~5 | Weather, Exchange Rate, Stock Quotes, RSS Reader, Telegram Bot, WeChat Bot... |

---

## Skill Store

Visit `http://localhost:3000/skills` → "Store" tab after starting the project.

### Store Features

- **Category Browsing** — Four category cards (Dev/Creative/Office/Life) with quick filter
- **Search & Filter** — Fuzzy search by name, description, or skill ID
- **Status Filter** — All / Installed / Not Installed
- **View Modes** — Categorized collapsible view / Grid view
- **One-Click Install** — Downloads source + auto `npm install` dependencies
- **Batch Install** — Install all 76 community skills at once
- **Smart Mirror** — Auto-detects region for optimal download speed
- **Uninstall** — One-click removal of installed skills

### How It Works

```
User clicks "Install"
    ↓
Backend downloads index.ts from GitHub community-skills branch
    ↓
Saves to src/skills/community/{skill-dir}/index.ts
    ↓
Reads deps field from skills-manifest.json
    ↓
Runs npm install {deps} (auto --registry=npmmirror for China)
    ↓
Refreshes skill registry cache — skill is immediately available
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                Browser Client                    │
│       Next.js Pages + React 19 Components        │
│     Tailwind CSS 4 · Zustand State · AI SDK      │
├─────────────────────────────────────────────────┤
│               Next.js 16 Server                  │
│     API Routes · Skill Engine · SSR/RSC          │
├───────────────┬──────────────┬───────────────────┤
│  Core Skills  │ Community    │ External Services  │
│  (~50 built-in)│ (76+ on-demand)│ OpenAI/Claude/ │
│  In repository │ From GitHub  │ DashScope/...    │
├───────────────┴──────────────┴───────────────────┤
│               Infrastructure                     │
│   Node.js 18+ · TypeScript 5 · Zod Validation   │
│   Encrypted Credential Store · Dynamic Prompts   │
└─────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16 |
| Frontend | React + React DOM | 19 |
| Language | TypeScript | 5 |
| Styling | Tailwind CSS | 4 |
| State | Zustand | 5 |
| AI Integration | Vercel AI SDK + @ai-sdk/openai | 6 / 3 |
| Validation | Zod | 4 |
| Icons | Lucide React | 0.575 |
| Markdown | react-markdown + remark-gfm + rehype-katex | - |
| Documents | docx / exceljs / pptxgenjs / pdf-lib | - |
| Browser Automation | Puppeteer | 24 |
| Email | Nodemailer | 8 |
| Scraping | Cheerio | 1.2 |

---

## Project Structure

```
xiniu/
├── install.sh                 # Linux/macOS one-line installer
├── install.ps1                # Windows one-line installer
├── package.json               # Dependencies
├── .env.local                 # Environment variables (not committed)
│
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Home (chat interface)
│   │   ├── skills/page.tsx    # Skill management
│   │   ├── settings/page.tsx  # Settings
│   │   └── api/               # API routes
│   │       ├── chat/          # AI conversation endpoint
│   │       ├── skills/        # Skill CRUD + Store + Install + Setup
│   │       └── ...
│   │
│   ├── components/            # React components
│   │   ├── chat/              # Chat UI
│   │   ├── skills/            # Skill cards, store list, setup wizard
│   │   └── settings/          # Model config, theme selector
│   │
│   ├── lib/                   # Utilities
│   │   ├── credential-store.ts  # Encrypted credential storage
│   │   ├── skill-store.ts       # Local skill index
│   │   └── skill-remote.ts      # Remote skill fetcher
│   │
│   └── skills/                # Skill layer
│       ├── types.ts           # SkillDefinition types + SetupGuide
│       ├── registry.ts        # Skill registry (core + dynamic community)
│       ├── prompt-modules.ts  # Prompt modules (keyword-grouped)
│       ├── [core-skills]/     # ~50 core skill directories
│       └── community/         # Community skills (on-demand, gitignored)
│           ├── skills-manifest.json  # Metadata for 76 skills
│           └── {skill-name}/index.ts
│
└── public/                    # Static assets
```

---

## Configuration

All configuration is managed via `.env.local`:

```bash
# ═══ AI Models (configure at least one) ═══

# OpenAI GPT (or any OpenAI-compatible API)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxx
OPENAI_BASE_URL=https://api.openai.com/v1      # Can point to third-party proxy

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx

# Tongyi Qwen (recommended for China, no VPN needed)
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx

# ═══ Optional ═══

# Stability AI (image generation)
STABILITY_API_KEY=sk-xxxxxxxxxxxxxxxx

# Email (smart_email skill)
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_USER=you@example.com
SMTP_PASS=your-password
```

---

## FAQ

**Q: Slow installation for users in China?**
A: The install script handles this automatically. For manual install, run `npm config set registry https://registry.npmmirror.com`.

**Q: Which AI models are supported?**
A: All OpenAI API-compatible models (GPT-4o, DeepSeek, Qwen, etc.), Anthropic Claude, and Tongyi Qwen. Use `OPENAI_BASE_URL` to connect any compatible API.

**Q: Where are community skills stored after installation?**
A: In `src/skills/community/{skill-name}/index.ts`. They don't affect the Git repo (excluded in `.gitignore`).

**Q: How to develop custom skills?**
A: Use the "Create" tab on the skill management page, or manually create skills following the `SkillDefinition` interface in `src/skills/types.ts`.

**Q: How to update to the latest version?**
A: Run `git pull origin main && npm install` in the project directory.

---

## Contributing

1. Fork this repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit changes: `git commit -m "feat: add your feature"`
4. Push the branch: `git push origin feat/your-feature`
5. Open a Pull Request

### Contributing Community Skills

1. Create a new directory under `src/skills/community/`
2. Write an `index.ts` conforming to the `SkillDefinition` interface
3. Add skill metadata to `skills-manifest.json`
4. Submit a PR to the `community-skills` branch

---

## License

This project is open-sourced under the [MIT License](LICENSE).
