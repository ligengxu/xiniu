$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info  { param($m) Write-Host "[犀牛] $m" -ForegroundColor Cyan }
function Write-Ok    { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Warn  { param($m) Write-Host "[!] $m" -ForegroundColor Yellow }
function Write-Fail  { param($m) Write-Host "[X] $m" -ForegroundColor Red }
function Ask {
    param($m)
    $r = Read-Host "$m [Y/n]"
    return ($r -eq "" -or $r -match "^[Yy]")
}

$INSTALL_DIR = if ($env:XINIU_DIR) { $env:XINIU_DIR } else { Join-Path $HOME "xiniu" }
$REPO = "https://github.com/ligengxu/xiniu.git"
$MIN_NODE = 18

function Detect-Region {
    try {
        $tz = [System.TimeZoneInfo]::Local.Id
        if ($tz -match "China|Beijing|Shanghai|Taipei|Hong Kong") { return "china" }
    } catch {}
    try {
        $resp = Invoke-RestMethod -Uri "http://ip-api.com/json/?fields=countryCode" -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($resp.countryCode -eq "CN") { return "china" }
    } catch {}
    $lang = (Get-Culture).Name
    if ($lang -match "^zh-CN") { return "china" }
    return "global"
}

$Region = Detect-Region
if ($Region -eq "china") {
    Write-Info "检测到国内网络环境，将使用加速镜像"
    $NPM_REGISTRY = "https://registry.npmmirror.com"
    $GIT_MIRRORS = @(
        "https://ghproxy.net/https://github.com/ligengxu/xiniu.git",
        "https://mirror.ghproxy.com/https://github.com/ligengxu/xiniu.git",
        "https://github.com/ligengxu/xiniu.git"
    )
    $NVM_URL = "https://npmmirror.com/mirrors/nvm-setup/v1.2.2/nvm-setup.exe"
    $NODE_URL = "https://npmmirror.com/mirrors/node/v22.16.0/node-v22.16.0-x64.msi"
} else {
    Write-Info "检测到海外网络环境，使用官方源"
    $NPM_REGISTRY = "https://registry.npmjs.org"
    $GIT_MIRRORS = @("https://github.com/ligengxu/xiniu.git")
    $NVM_URL = "https://github.com/coreybutler/nvm-windows/releases/download/1.2.2/nvm-setup.exe"
    $NODE_URL = "https://nodejs.org/dist/v22.16.0/node-v22.16.0-x64.msi"
}

function Test-Speed {
    param($Urls)
    $fastest = $null
    $bestTime = 99999
    foreach ($url in $Urls) {
        try {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $req = [System.Net.WebRequest]::Create($url)
            $req.Method = "HEAD"
            $req.Timeout = 5000
            $resp = $req.GetResponse()
            $resp.Close()
            $sw.Stop()
            $ms = $sw.ElapsedMilliseconds
            Write-Info "  $url -> ${ms}ms"
            if ($ms -lt $bestTime) { $bestTime = $ms; $fastest = $url }
        } catch {
            Write-Warn "  $url -> 不可达"
        }
    }
    return $fastest
}

function Check-Git {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git) {
        $ver = (git --version) -replace "[^0-9.]",""
        $major = [int]($ver.Split('.')[0])
        if ($major -ge 2) {
            Write-Ok "Git $ver"
            return
        }
        Write-Warn "Git $ver 版本过低"
    } else {
        Write-Warn "未检测到 Git"
    }

    if (Ask "是否自动安装 Git?") {
        Install-Git
    } else {
        Write-Fail "Git 是必需依赖，无法继续"; exit 1
    }
}

function Install-Git {
    Write-Info "正在安装 Git..."

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $scoop = Get-Command scoop -ErrorAction SilentlyContinue
    $choco = Get-Command choco -ErrorAction SilentlyContinue

    if ($winget) {
        Write-Info "使用 winget 安装..."
        winget install Git.Git --accept-source-agreements --accept-package-agreements
    } elseif ($scoop) {
        Write-Info "使用 scoop 安装..."
        scoop install git
    } elseif ($choco) {
        Write-Info "使用 choco 安装..."
        choco install git -y
    } else {
        Write-Info "下载 Git 安装包..."
        $gitUrl = "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
        if ($Region -eq "china") {
            $gitUrl = "https://npmmirror.com/mirrors/git-for-windows/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
        }
        $gitInstaller = Join-Path $env:TEMP "git-installer.exe"
        Invoke-WebRequest -Uri $gitUrl -OutFile $gitInstaller -UseBasicParsing
        Start-Process -Wait -FilePath $gitInstaller -ArgumentList "/VERYSILENT","/NORESTART"
        Remove-Item $gitInstaller -ErrorAction SilentlyContinue
    }

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    $g = Get-Command git -ErrorAction SilentlyContinue
    if ($g) { Write-Ok "Git 安装完成: $(git --version)" }
    else { Write-Fail "Git 安装失败，请手动安装后重试"; exit 1 }
}

function Check-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) {
        $ver = (node -v) -replace "v",""
        $major = [int]($ver.Split('.')[0])
        if ($major -ge $MIN_NODE) {
            Write-Ok "Node.js v$ver"
            return
        }
        Write-Warn "Node.js v$ver 版本过低 (需要 >= $MIN_NODE)"
    } else {
        Write-Warn "未检测到 Node.js"
    }

    Write-Host ""
    Write-Info "请选择 Node.js 安装方式:"
    Write-Host "  1) nvm-windows (推荐 - 版本管理方便)"
    Write-Host "  2) 直接安装 Node.js MSI"
    Write-Host "  3) 使用 winget/scoop/choco"
    Write-Host "  4) 跳过"
    $choice = Read-Host "  选择 [1/2/3/4]"

    switch ($choice) {
        "1" { Install-NodeNvm }
        "2" { Install-NodeMsi }
        "3" { Install-NodePkg }
        "4" { Write-Fail "Node.js 是必需依赖"; exit 1 }
        default { Install-NodeNvm }
    }
}

function Install-NodeNvm {
    Write-Info "正在安装 nvm-windows..."
    $nvmInstaller = Join-Path $env:TEMP "nvm-setup.exe"
    Invoke-WebRequest -Uri $NVM_URL -OutFile $nvmInstaller -UseBasicParsing
    Start-Process -Wait -FilePath $nvmInstaller
    Remove-Item $nvmInstaller -ErrorAction SilentlyContinue

    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

    $nvm = Get-Command nvm -ErrorAction SilentlyContinue
    if ($nvm) {
        if ($Region -eq "china") {
            nvm node_mirror https://npmmirror.com/mirrors/node/
            nvm npm_mirror https://npmmirror.com/mirrors/npm/
        }
        nvm install lts
        nvm use lts
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Ok "Node.js $(node -v) (nvm-windows)"
    } else {
        Write-Warn "nvm 安装后需重启终端，请重新运行此脚本"
        exit 0
    }
}

function Install-NodeMsi {
    Write-Info "正在下载 Node.js 安装包..."
    $msi = Join-Path $env:TEMP "node-setup.msi"
    Invoke-WebRequest -Uri $NODE_URL -OutFile $msi -UseBasicParsing
    Start-Process -Wait -FilePath msiexec.exe -ArgumentList "/i",$msi,"/qn","/norestart"
    Remove-Item $msi -ErrorAction SilentlyContinue
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Ok "Node.js $(node -v)"
}

function Install-NodePkg {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    $scoop  = Get-Command scoop  -ErrorAction SilentlyContinue
    $choco  = Get-Command choco  -ErrorAction SilentlyContinue
    if ($winget) {
        winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    } elseif ($scoop) {
        scoop install nodejs-lts
    } elseif ($choco) {
        choco install nodejs-lts -y
    } else {
        Write-Fail "未找到 winget/scoop/choco，请选择其他方式"; return
    }
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Ok "Node.js $(node -v)"
}

function Setup-NpmRegistry {
    $current = npm config get registry 2>$null
    if ($Region -eq "china" -and $current -notmatch "npmmirror") {
        if (Ask "检测到国内环境，是否切换 npm 到淘宝镜像?") {
            npm config set registry $NPM_REGISTRY
            Write-Ok "npm 镜像: $NPM_REGISTRY"
        }
    }
}

function Clone-Repo {
    if (Test-Path (Join-Path $INSTALL_DIR ".git")) {
        Write-Ok "项目目录已存在: $INSTALL_DIR"
        Write-Info "拉取最新代码..."
        Set-Location $INSTALL_DIR
        git pull origin main
        return
    }

    if ((Test-Path $INSTALL_DIR) -and (Get-ChildItem $INSTALL_DIR -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
        Write-Warn "目录 $INSTALL_DIR 已存在且非空"
        if (Ask "是否删除后重新克隆?") {
            Remove-Item -Recurse -Force $INSTALL_DIR
        } else {
            Write-Fail "请清理目录后重试"; exit 1
        }
    }

    Write-Info "正在克隆项目..."
    if ($Region -eq "china") {
        Write-Info "测试镜像速度..."
        $cloned = $false
        foreach ($m in $GIT_MIRRORS) {
            Write-Info "尝试: $m"
            try {
                git clone --depth 1 $m $INSTALL_DIR 2>&1 | Out-Null
                Set-Location $INSTALL_DIR
                git remote set-url origin $REPO
                Write-Ok "克隆成功 (来源: $m)"
                $cloned = $true
                break
            } catch {
                Write-Warn "镜像不可用，切换下一个..."
            }
        }
        if (-not $cloned) {
            Write-Fail "所有镜像均不可用，请检查网络"; exit 1
        }
    } else {
        git clone --depth 1 $REPO $INSTALL_DIR
        Set-Location $INSTALL_DIR
        Write-Ok "克隆成功"
    }
}

function Install-Deps {
    Set-Location $INSTALL_DIR
    Write-Info "正在安装项目依赖 (可能需要几分钟)..."
    if ($Region -eq "china") {
        npm install --registry="$NPM_REGISTRY"
    } else {
        npm install
    }
    Write-Ok "依赖安装完成"
}

function Setup-Env {
    Set-Location $INSTALL_DIR
    $envFile = Join-Path $INSTALL_DIR ".env.local"
    if (-not (Test-Path $envFile)) {
        Write-Info "创建默认配置文件 .env.local"
        @"
# AI 模型配置 (至少配置一个)
# OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://api.openai.com/v1

# 通义千问 (国内推荐)
# DASHSCOPE_API_KEY=sk-xxx

# Anthropic Claude
# ANTHROPIC_API_KEY=sk-xxx
"@ | Set-Content $envFile -Encoding UTF8
        Write-Ok "已创建 .env.local"
    } else {
        Write-Ok ".env.local 已存在"
    }
}

function Print-Done {
    Write-Host ""
    Write-Host "================================================" -ForegroundColor Green
    Write-Host "  犀牛 Agent 安装完成!" -ForegroundColor Green
    Write-Host "================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  项目目录:  $INSTALL_DIR" -ForegroundColor Cyan
    try { Write-Host "  Node.js:   $(node -v)" -ForegroundColor Cyan } catch {}
    try { Write-Host "  npm:       $(npm -v)" -ForegroundColor Cyan } catch {}
    try { Write-Host "  npm 镜像:  $(npm config get registry)" -ForegroundColor Cyan } catch {}
    Write-Host ""
    Write-Host "  下一步:" -ForegroundColor White
    Write-Host "  1. 编辑配置: notepad $INSTALL_DIR\.env.local" -ForegroundColor Yellow
    Write-Host "  2. 启动开发: cd $INSTALL_DIR; npm run dev" -ForegroundColor Yellow
    Write-Host "  3. 生产构建: cd $INSTALL_DIR; npm run build; npm start" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  技能商店: 启动后访问 http://localhost:3000/skills" -ForegroundColor Cyan
    Write-Host "  文档:     https://github.com/ligengxu/xiniu" -ForegroundColor Cyan
    Write-Host ""

    if (Ask "是否现在启动开发服务器?") {
        Set-Location $INSTALL_DIR
        Write-Info "正在启动..."
        npm run dev
    }
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  犀牛 Agent 一键安装脚本" -ForegroundColor Cyan
Write-Host "  https://github.com/ligengxu/xiniu" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$sysInfo = "$([System.Runtime.InteropServices.RuntimeInformation]::OSDescription) | $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
Write-Info "系统: $sysInfo  区域: $Region"

Check-Git
Check-Node
Setup-NpmRegistry
Clone-Repo
Install-Deps
Setup-Env
Print-Done
