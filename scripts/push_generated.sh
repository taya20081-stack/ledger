#!/usr/bin/env bash
set -euo pipefail

file=$1
message=$2
git config user.name github-actions
git config user.email actions@users.noreply.github.com
git add -- "$file"
if git diff --cached --quiet; then exit 0; fi
git commit -m "$message"

for attempt in 1 2 3 4; do
    if git push; then exit 0; fi
    if (( attempt == 4 )); then break; fi
    if ! git pull --rebase; then
        git rebase --abort 2>/dev/null || true
        echo "::error::${file} 無法安全套用至遠端最新版，保留遠端資料"
        exit 1
    fi
    sleep "$attempt"
done
echo "::error::${file} 推送失敗，遠端未確認收到這次更新"
exit 1
