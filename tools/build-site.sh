#!/usr/bin/env bash
# One GitHub Pages site for the repo: /Micar-com/, /Micar-com/value/, /Micar-com/tuner/, /Micar-com/garage/
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf site && mkdir -p site/value site/tuner site/garage
BASE_PATH=/Micar-com/value/ pnpm --filter @micar/value build
cp -r apps/value/dist/. site/value/
# the tuner is static: ship only what the page loads (index + src + assets), not the render tools, recon notes or docs
cp -r apps/tuner/index.html apps/tuner/src apps/tuner/assets site/tuner/
cp tools/site-index.html site/index.html
cp tools/garage-placeholder.html site/garage/index.html
touch site/.nojekyll
