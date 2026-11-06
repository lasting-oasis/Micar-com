#!/usr/bin/env bash
# One GitHub Pages site for the repo. The door (the Value app) is the site root: /Micar-com/
# /Micar-com/value/  forwards to the root, hash intact, so every printed QR code and the old-repo redirect still land on the car
# /Micar-com/tuner/  a redirect to the world (the Tuner is absorbed into the Garage; apps/tuner is no longer shipped)
# /Micar-com/garage/ placeholder until phase 1
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf site && mkdir -p site/value site/tuner site/garage
BASE_PATH=/Micar-com/ pnpm --filter @micar/value build
cp -r apps/value/dist/. site/
cp tools/value-alias.html site/value/index.html
# the tuner now lives in the world's Garage; the old link forwards there (no hash carried over)
cp tools/tuner-redirect.html site/tuner/index.html
cp tools/garage-placeholder.html site/garage/index.html
touch site/.nojekyll
