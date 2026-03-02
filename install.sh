#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()  { echo -e "${CYAN}[犀牛]${NC} $*"; }
ok()    { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[✗]${NC} $*"; }
ask()   { echo -en "${YELLOW}[?]${NC} $* [Y/n] "; read -r ans; [[ -z "$ans" || "$ans" =~ ^[Yy] ]]; }

INSTALL_DIR="${XINIU_DIR:-$HOME/xiniu}"
REPO="https://github.com/ligengxu/xiniu.git"
MIN_NODE=18
MIN_GIT=2

# ─── 区域检测 ───
detect_region() {
  if command -v curl &>/dev/null; then
    local tz
    tz=$(curl -s --max-time 3 "http://ip-api.com/line/?fields=timezone" 2>/dev/null || echo "")
    if [[ "$tz" == Asia/Shanghai* || "$tz" == Asia/Chongqing* || "$tz" == Asia/Harbin* || "$tz" == Asia/Urumqi* ]]; then
      echo "china"; return
    fi
  fi
  local sys_tz
  sys_tz=$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null || echo "")
  if [[ "$sys_tz" == *Shanghai* || "$sys_tz" == *Chongqing* || "$sys_tz" == *PRC* ]]; then
    echo "china"; return
  fi
  if [[ "$(echo "$LANG" 2>/dev/null)" == zh_CN* ]]; then
    echo "china"; return
  fi
  echo "global"
}

REGION=$(detect_region)
if [[ "$REGION" == "china" ]]; then
  info "检测到国内网络环境，将使用加速镜像"
  GIT_MIRROR="https://ghproxy.net/https://github.com/ligengxu/xiniu.git"
  NPM_REGISTRY="https://registry.npmmirror.com"
  NVM_MIRROR="https://npmmirror.com/mirrors/node/"
  NVM_INSTALL="https://gitee.com/mirrors/nvm/raw/master/install.sh"
else
  info "检测到海外网络环境，使用官方源"
  GIT_MIRROR="$REPO"
  NPM_REGISTRY="https://registry.npmjs.org"
  NVM_MIRROR=""
  NVM_INSTALL="https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh"
fi

# ─── 测速选节点 ───
pick_fastest_mirror() {
  local mirrors=("$@")
  local fastest="" best_time=99999
  for m in "${mirrors[@]}"; do
    local t
    t=$(curl -o /dev/null -s -w '%{time_total}' --max-time 5 "$m" 2>/dev/null || echo "99999")
    local ms
    ms=$(echo "$t * 1000" | bc 2>/dev/null || echo "99999")
    if (( $(echo "$t < $best_time" | bc 2>/dev/null || echo 0) )); then
      best_time=$t; fastest=$m
    fi
  done
  echo "$fastest"
}

# ─── 版本比较 ───
ver_ge() {
  local v1=$1 v2=$2
  [[ "$(printf '%s\n' "$v2" "$v1" | sort -V | head -n1)" == "$v2" ]]
}

# ─── 系统检测 ───
detect_os() {
  local os
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in
    linux*)  echo "linux" ;;
    darwin*) echo "macos" ;;
    *)       echo "unknown" ;;
  esac
}

detect_pkg_manager() {
  if command -v apt-get &>/dev/null; then echo "apt"
  elif command -v yum &>/dev/null; then echo "yum"
  elif command -v dnf &>/dev/null; then echo "dnf"
  elif command -v pacman &>/dev/null; then echo "pacman"
  elif command -v brew &>/dev/null; then echo "brew"
  elif command -v apk &>/dev/null; then echo "apk"
  else echo "unknown"
  fi
}

OS=$(detect_os)
PKG=$(detect_pkg_manager)
info "系统: ${BOLD}$(uname -s) $(uname -m)${NC}  包管理: ${BOLD}$PKG${NC}  区域: ${BOLD}$REGION${NC}"

# ─── Git 检测与安装 ───
check_git() {
  if command -v git &>/dev/null; then
    local ver
    ver=$(git --version | grep -oP '\d+\.\d+' | head -1)
    if ver_ge "$ver" "$MIN_GIT"; then
      ok "Git $ver"
      return 0
    else
      warn "Git $ver 版本过低 (需要 >= $MIN_GIT)"
    fi
  else
    warn "未检测到 Git"
  fi

  if ask "是否自动安装 Git?"; then
    install_git
  else
    fail "Git 是必需依赖，无法继续"; exit 1
  fi
}

install_git() {
  info "正在安装 Git..."
  case "$PKG" in
    apt)    sudo apt-get update -qq && sudo apt-get install -y -qq git ;;
    yum)    sudo yum install -y git ;;
    dnf)    sudo dnf install -y git ;;
    pacman) sudo pacman -S --noconfirm git ;;
    brew)   brew install git ;;
    apk)    sudo apk add git ;;
    *)      fail "无法自动安装 Git，请手动安装后重试"; exit 1 ;;
  esac
  ok "Git 安装完成: $(git --version)"
}

# ─── Node.js 检测与安装 ───
check_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -v | sed 's/v//')
    local major
    major=$(echo "$ver" | cut -d. -f1)
    if [[ "$major" -ge "$MIN_NODE" ]]; then
      ok "Node.js v$ver"
      return 0
    else
      warn "Node.js v$ver 版本过低 (需要 >= $MIN_NODE)"
    fi
  else
    warn "未检测到 Node.js"
  fi

  echo ""
  info "请选择 Node.js 安装方式:"
  echo "  1) nvm (推荐 - 版本管理方便)"
  echo "  2) 系统包管理器"
  echo "  3) 跳过 (我稍后手动安装)"
  echo -n "  选择 [1/2/3]: "
  read -r choice
  case "$choice" in
    1) install_node_nvm ;;
    2) install_node_pkg ;;
    3) fail "Node.js 是必需依赖，无法继续"; exit 1 ;;
    *) install_node_nvm ;;
  esac
}

install_node_nvm() {
  info "正在通过 nvm 安装 Node.js..."
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    if [[ "$REGION" == "china" ]]; then
      curl -o- "$NVM_INSTALL" | NODEJS_ORG_MIRROR="$NVM_MIRROR" bash
    else
      curl -o- "$NVM_INSTALL" | bash
    fi
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  else
    . "$NVM_DIR/nvm.sh"
  fi

  if [[ "$REGION" == "china" ]]; then
    export NVM_NODEJS_ORG_MIRROR="$NVM_MIRROR"
  fi
  nvm install --lts
  nvm use --lts
  ok "Node.js $(node -v) 安装完成 (nvm)"
}

install_node_pkg() {
  info "正在通过系统包管理器安装 Node.js..."
  case "$PKG" in
    apt)
      if [[ "$REGION" == "china" ]]; then
        curl -fsSL https://npmmirror.com/mirrors/node/latest-v22.x/SHASUMS256.txt &>/dev/null 2>&1 || true
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      else
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      fi
      sudo apt-get install -y nodejs
      ;;
    yum|dnf)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo ${PKG} install -y nodejs
      ;;
    pacman) sudo pacman -S --noconfirm nodejs npm ;;
    brew)   brew install node ;;
    apk)    sudo apk add nodejs npm ;;
    *)      fail "无法自动安装，请手动安装 Node.js >= $MIN_NODE"; exit 1 ;;
  esac
  ok "Node.js $(node -v) 安装完成"
}

# ─── npm 镜像设置 ───
setup_npm_registry() {
  local current
  current=$(npm config get registry 2>/dev/null || echo "")
  if [[ "$REGION" == "china" && "$current" != *"npmmirror"* ]]; then
    if ask "检测到国内环境，是否切换 npm 到淘宝镜像 (npmmirror.com)?"; then
      npm config set registry "$NPM_REGISTRY"
      ok "npm 镜像已切换: $NPM_REGISTRY"
    fi
  fi
}

# ─── 克隆项目 ───
clone_repo() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    ok "项目目录已存在: $INSTALL_DIR"
    info "正在拉取最新代码..."
    cd "$INSTALL_DIR"
    git pull --ff-only origin main 2>/dev/null || git pull origin main
    return
  fi

  if [[ -d "$INSTALL_DIR" && "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]]; then
    warn "目录 $INSTALL_DIR 已存在且非空"
    if ask "是否删除后重新克隆?"; then
      rm -rf "$INSTALL_DIR"
    else
      fail "请清理目录后重试"; exit 1
    fi
  fi

  info "正在克隆项目..."
  if [[ "$REGION" == "china" ]]; then
    local mirrors=(
      "https://ghproxy.net/https://github.com/ligengxu/xiniu.git"
      "https://mirror.ghproxy.com/https://github.com/ligengxu/xiniu.git"
      "https://github.com/ligengxu/xiniu.git"
    )
    local cloned=false
    for m in "${mirrors[@]}"; do
      info "尝试: $m"
      if git clone --depth 1 "$m" "$INSTALL_DIR" 2>/dev/null; then
        cloned=true
        cd "$INSTALL_DIR"
        git remote set-url origin "$REPO"
        ok "克隆成功 (来源: $m)"
        break
      fi
      warn "镜像不可用，切换下一个..."
    done
    if ! $cloned; then
      fail "所有镜像均不可用，请检查网络"; exit 1
    fi
  else
    git clone --depth 1 "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    ok "克隆成功"
  fi
}

# ─── 安装依赖 ───
install_deps() {
  cd "$INSTALL_DIR"
  info "正在安装项目依赖..."
  if [[ "$REGION" == "china" ]]; then
    npm install --registry="$NPM_REGISTRY" 2>&1 | tail -5
  else
    npm install 2>&1 | tail -5
  fi
  ok "依赖安装完成"
}

# ─── 环境配置 ───
setup_env() {
  cd "$INSTALL_DIR"
  if [[ ! -f ".env.local" ]]; then
    info "创建默认配置文件 .env.local"
    cat > .env.local <<'ENVEOF'
# AI 模型配置 (至少配置一个)
# OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL=https://api.openai.com/v1

# 通义千问 (国内推荐)
# DASHSCOPE_API_KEY=sk-xxx

# Anthropic Claude
# ANTHROPIC_API_KEY=sk-xxx
ENVEOF
    ok "已创建 .env.local，请编辑填入 API Key"
  else
    ok ".env.local 已存在"
  fi
}

# ─── 完成提示 ───
print_done() {
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  犀牛 Agent 安装完成!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${CYAN}项目目录:${NC}  $INSTALL_DIR"
  echo -e "  ${CYAN}Node.js:${NC}   $(node -v 2>/dev/null || echo '未知')"
  echo -e "  ${CYAN}npm:${NC}       $(npm -v 2>/dev/null || echo '未知')"
  echo -e "  ${CYAN}npm 镜像:${NC}  $(npm config get registry 2>/dev/null)"
  echo ""
  echo -e "  ${BOLD}下一步:${NC}"
  echo -e "  ${CYAN}1.${NC} 编辑配置:  ${YELLOW}nano $INSTALL_DIR/.env.local${NC}"
  echo -e "  ${CYAN}2.${NC} 启动开发:  ${YELLOW}cd $INSTALL_DIR && npm run dev${NC}"
  echo -e "  ${CYAN}3.${NC} 生产构建:  ${YELLOW}cd $INSTALL_DIR && npm run build && npm start${NC}"
  echo ""
  echo -e "  ${CYAN}技能商店:${NC}  启动后访问 http://localhost:3000/skills → 商店标签页"
  echo -e "  ${CYAN}文档:${NC}      https://github.com/ligengxu/xiniu"
  echo ""

  if ask "是否现在启动开发服务器?"; then
    cd "$INSTALL_DIR"
    info "正在启动 npm run dev ..."
    npm run dev
  fi
}

# ─── 主流程 ───
main() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}${BOLD}  犀牛 Agent 一键安装脚本${NC}"
  echo -e "${CYAN}${BOLD}  https://github.com/ligengxu/xiniu${NC}"
  echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  check_git
  check_node
  setup_npm_registry
  clone_repo
  install_deps
  setup_env
  print_done
}

main "$@"
