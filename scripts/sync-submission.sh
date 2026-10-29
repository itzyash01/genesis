#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
target="$root/submission"
mkdir -p "$target"
# Only these managed directories are mirrored. Never copy runtime secrets or build output.
for dir in frontend functions tests docs .github scripts; do
  mkdir -p "$target/$dir"
  rsync -a --delete --exclude='node_modules/' --exclude='/dist/' --exclude='/lib/' \
    --exclude='.env' --exclude='.env.*' --include='.env.example' \
    --exclude='.secret*' --exclude='.DS_Store' --exclude='*.log' --exclude='~$*' \
    "$root/$dir/" "$target/$dir/"
done
# Explicit examples are safe to publish and excluded by the general environment pattern above.
cp "$root/frontend/.env.example" "$target/frontend/.env.example"
cp "$root/functions/.env.example" "$target/functions/.env.example"
for file in .env.example .firebaserc .gitignore .nvmrc README.md firebase.json firestore.indexes.json firestore.rules package.json package-lock.json vitest.config.ts; do
  cp "$root/$file" "$target/$file"
done
printf 'Submission snapshot updated at %s\n' "$target"
