#!/usr/bin/env bash
# Type-checks the given engine files (or all of src) the way each app will: once with the value app's TypeScript 7
# and flags, once with the sim's TypeScript 5.9 and flags. Shared source has to pass both.
#   packages/engine/scripts/check.sh                      every file under src
#   packages/engine/scripts/check.sh src/vin.ts src/vin.test.ts
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -eq 0 ]; then set -- $(find src -name '*.ts' | sort); fi
common=(--noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --allowImportingTsExtensions
        --isolatedModules --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --target es2020 --lib es2020 --types vite/client)
echo "TypeScript 7 (value app flags)"
pnpm exec tsc --ignoreConfig "${common[@]}" --verbatimModuleSyntax --erasableSyntaxOnly --moduleDetection force "$@"
echo "TypeScript 5.9 (sim flags)"
pnpm --filter @micar/sim exec tsc "${common[@]}" $(printf '../../packages/engine/%s ' "$@")
echo "ok"
