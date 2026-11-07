#!/usr/bin/env bash
# ---------------------------------------------------------------
# InterpLab -> GitHub 一键发布
# 用法（不要用账号密码，GitHub 已停用密码鉴权）：
#   export GH_TOKEN=ghp_xxxxxxxx      # 需要 repo + workflow 权限
#   bash push-to-github.sh terenceyb interplab
# ---------------------------------------------------------------
set -euo pipefail

OWNER="${1:-terenceyb}"
REPO="${2:-interplab}"
BRANCH="main"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${GH_TOKEN:-}" ]]; then
  echo "❌ 缺少 GH_TOKEN。请先在 https://github.com/settings/tokens 生成 token（勾 repo + workflow），再："
  echo "   export GH_TOKEN=ghp_xxx && bash $0 $OWNER $REPO"
  exit 1
fi

cd "$ROOT"

echo "→ 1/6 校验 token"
GH_TOKEN="$GH_TOKEN" gh auth status >/dev/null 2>&1 || {
  echo "❌ token 无效或无权限"; exit 1;
}
echo "   token 可用"

echo "→ 2/6 确认仓库 $OWNER/$REPO"
if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "   仓库不存在，创建中..."
  gh repo create "$OWNER/$REPO" --public \
    --description "InterpLab · 口译自学训练与复盘工作台（本地优先，纯前端）" >/dev/null
  echo "   已创建（public，GitHub Pages 需要）"
else
  echo "   仓库已存在"
fi

echo "→ 3/6 配置 git 身份与远端"
git config user.name  "terenceyb"
git config user.email "terenceyb@users.noreply.github.com"
git branch -M "$BRANCH"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "https://github.com/$OWNER/$REPO.git"
else
  git remote add origin "https://github.com/$OWNER/$REPO.git"
fi

echo "→ 4/6 构建校验（失败就不推）"
( cd frontend && pnpm install --silent && pnpm build >/dev/null 2>&1 ) || {
  echo "❌ 构建失败，已中止推送"; exit 1;
}
echo "   构建通过"

echo "→ 5/6 推送 $BRANCH"
GH_TOKEN="$GH_TOKEN" git push -u origin "$BRANCH" --force

echo "→ 6/6 开启 GitHub Pages（workflow 模式）"
if gh api "repos/$OWNER/$REPO/pages" >/dev/null 2>&1; then
  echo "   Pages 已开启"
else
  gh api -X POST "repos/$OWNER/$REPO/pages" \
    -f build_type=workflow >/dev/null 2>&1 \
    && echo "   已开启" \
    || echo "   ⚠️ 自动开启失败，请手动到 Settings → Pages → Source 选 GitHub Actions"
fi

cat <<EOF

✅ 完成
   仓库：https://github.com/$OWNER/$REPO
   Actions：https://github.com/$OWNER/$REPO/actions
   站点（等 Actions 跑完 1-2 分钟）：https://$OWNER.github.io/$REPO/

提醒：token 用完建议在设置页删除；账号密码请不要用于任何自动化登录。
EOF
