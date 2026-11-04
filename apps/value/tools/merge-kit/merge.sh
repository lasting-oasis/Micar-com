#!/usr/bin/env bash
# Builds the MiCar monorepo from the three source repos, keeping every commit under its new path.
# Usage: merge.sh <workdir>   (needs git >= 2.40, git-filter-repo, node 22, corepack)
# The result is <workdir>/micar: a new repository with apps/value, apps/sim, apps/tuner and pnpm workspaces.
set -euo pipefail
KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # this kit folder, resolved before any cd
WORK=${1:-$PWD/work}; mkdir -p "$WORK"; cd "$WORK"
: "${VALUE_SRC:=https://github.com/lasting-oasis/queen_city_mycarvalue}"
: "${SIM_SRC:=https://github.com/lasting-oasis/car-dealer-sim}"
: "${SIM_REF:=main}"            # set to perf/3d-scene-optimizations until PR #1 lands
: "${TUNER_SRC:=https://github.com/lasting-oasis/micar-tuner}"
AUTHOR_NAME=lasting-oasis; AUTHOR_EMAIL=blueoceanlegacies@gmail.com
G="git -c user.name=$AUTHOR_NAME -c user.email=$AUTHOR_EMAIL"

import_repo() {  # <src> <ref> <subdir>
  local src=$1 ref=$2 sub=$3 dir="src-$3"
  rm -rf "$dir"; git clone -q --no-local --branch "$ref" "$src" "$dir"       # a fresh clone, as filter-repo requires
  ( cd "$dir" && git filter-repo --quiet --to-subdirectory-filter "apps/$sub" )   # rewrites every commit so history lives under apps/<sub>
}
import_repo "$VALUE_SRC" main value
import_repo "$SIM_SRC"   "$SIM_REF" sim
import_repo "$TUNER_SRC" main tuner

rm -rf micar; mkdir micar; cd micar; git init -q -b main
$G commit -q --allow-empty -m "Start the MiCar monorepo"
for sub in value sim tuner; do
  git remote add "$sub" "../src-$sub"; git fetch -q "$sub"
  $G merge -q --allow-unrelated-histories --no-edit -m "Import $sub with its history under apps/$sub" "$sub/$( [ $sub = sim ] && echo "${SIM_REF#refs/heads/}" || echo main )"
  git remote remove "$sub"
done

# --- pin each app's direct dependencies to what its package-lock resolves today (pnpm cannot import three lockfiles)
for app in value sim tuner; do node - "apps/$app" <<'EOF'
const fs=require('fs'),p=process.argv[2];const pkg=JSON.parse(fs.readFileSync(p+'/package.json'));const lock=JSON.parse(fs.readFileSync(p+'/package-lock.json'));
for(const k of ['dependencies','devDependencies'])for(const n of Object.keys(pkg[k]||{})){const v=(lock.packages&&lock.packages['node_modules/'+n]||{}).version;if(v)pkg[k][n]=v;}
pkg.name='@micar/'+p.split('/')[1];fs.writeFileSync(p+'/package.json',JSON.stringify(pkg,null,2)+'\n');fs.rmSync(p+'/package-lock.json',{force:true});
EOF
done

# --- workspace files from the kit (pnpm config, Pages site builder, CI, Render blueprint)
cp -r "$KIT/overlay/." .
mkdir -p apps/garage
# --- value's data workflows move to the repo root and run inside apps/value
mkdir -p .github/workflows
python3 - <<'PY'
import re, os, glob
src, dst = 'apps/value/.github/workflows', '.github/workflows'
for f in sorted(glob.glob(src + '/*.yml')):
    name = os.path.basename(f); s = open(f).read(); os.remove(f)
    if name == 'deploy.yml': continue                                       # replaced by pages.yml
    s = re.sub(r'^(jobs:\n  [\w-]+:\n)', r'\1    defaults:\n      run:\n        working-directory: apps/value\n', s, count=1, flags=re.M)
    s = re.sub(r'paths: \[([^\]]*)\]', lambda m: 'paths: [' + ', '.join('apps/value/' + p.strip() for p in m.group(1).split(',')) + ']', s)
    s = s.replace('apps/value/.github/workflows/', '.github/workflows/').replace('gh workflow run deploy.yml', 'gh workflow run pages.yml')
    open(os.path.join(dst, name), 'w').write(s)
os.rmdir(src); os.rmdir('apps/value/.github')
PY
git rm -q --cached apps/sim/render.yaml 2>/dev/null || true; rm -f apps/sim/render.yaml   # replaced by the root blueprint
# --- the saved design-session assets land where they belong
[ -d apps/value/assets/explainer ] && git mv apps/value/assets/explainer apps/explainer
[ -d apps/value/assets ] && git mv apps/value/assets assets
$G add -A && $G commit -q -m "pnpm workspace, pinned versions, one Pages site builder" \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UryQtHWSuXorh7sSdxJgvH"
# --- resolve the workspace once and commit the lockfile, so CI can use --frozen-lockfile
corepack enable >/dev/null 2>&1 || true
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --silent
$G add pnpm-lock.yaml && $G commit -q -m "pnpm lockfile for the workspace" \
  -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UryQtHWSuXorh7sSdxJgvH"
echo "monorepo ready at $PWD: $(git rev-list --count HEAD) commits"
