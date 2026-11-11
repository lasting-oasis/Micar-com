#!/usr/bin/env bash
# Type-checks the given holo files (or all of src) the way each app would: once with the value app's TypeScript 7
# and flags, once with the sim's TypeScript 5.9 and flags. The package is shared source, so it passes both, the
# way packages/engine does. The only differences from the engine's check: the DOM library (this code draws) and
# JSON modules (the foil table is one file that Blender reads too).
#   packages/holo/scripts/check.sh                      every file under src, and the demo page
#   packages/holo/scripts/check.sh src/spring.ts src/spring.test.ts
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$#" -eq 0 ]; then set -- $(find src demo -name '*.ts' | sort); fi
common=(--noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler --allowImportingTsExtensions
        --isolatedModules --noUnusedLocals --noUnusedParameters --noFallthroughCasesInSwitch --target es2020 --lib es2020,dom
        --resolveJsonModule --types vite/client)
echo "TypeScript 7 (value app flags)"
pnpm exec tsc --ignoreConfig "${common[@]}" --verbatimModuleSyntax --erasableSyntaxOnly --moduleDetection force "$@"
echo "TypeScript 5.9 (sim flags)"
pnpm --filter @micar/sim exec tsc "${common[@]}" $(printf '../../packages/holo/%s ' "$@")
echo "ok"
