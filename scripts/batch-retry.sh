#!/bin/bash
set -uo pipefail

PAGES=(
  "backend/appointments-api.mdx"
  "payment/index.mdx"
  "payment/pix-flow.mdx"
  "payment/webhook-verification.mdx"
  "mcp-server/index.mdx"
  "mcp-server/stdio-transport.mdx"
  "mcp-server/shared-schema.mdx"
  "whatsapp/index.mdx"
  "whatsapp/watchdog-cron.mdx"
  "deployment/index.mdx"
  "deployment/github-actions-ci.mdx"
  "deployment/railway-evolution.mdx"
  "observability/index.mdx"
)

echo "=== Cooldown: waiting 15 min for rate limits to drain ==="
sleep 900

SUCCEEDED=()
FAILED=()
TOTAL=${#PAGES[@]}
START=$(date +%s)

for ((i=0; i<${#PAGES[@]}; i++)); do
  page="${PAGES[$i]}"
  idx=$((i + 1))
  echo ""
  echo "[$idx/$TOTAL] $page"
  if pnpm docs:rich odys "$page" > /tmp/retry-$$.log 2>&1; then
    tail -1 /tmp/retry-$$.log
    SUCCEEDED+=("$page")
    git add "content/docs/projects/odys/$page" 2>/dev/null || true
    git commit -m "content(odys): regenerate $page via audit-gated pipeline (retry)" --quiet 2>/dev/null || true
  else
    tail -2 /tmp/retry-$$.log | sed 's/^/    /'
    echo "  ✗ failed"
    FAILED+=("$page")
  fi
  sleep 20
done

rm -f /tmp/retry-$$.log
END=$(date +%s)
RUNTIME=$((END - START))

echo ""
echo "════════════════════════════════════════"
echo "RETRY COMPLETE"
echo "════════════════════════════════════════"
echo "Total:     $TOTAL"
echo "Succeeded: ${#SUCCEEDED[@]}"
echo "Failed:    ${#FAILED[@]}"
echo "Runtime:   $((RUNTIME / 60))m $((RUNTIME % 60))s"
echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Still failing (retry manually later):"
  printf '  ✗ %s\n' "${FAILED[@]}"
  echo ""
fi
echo "Pushing..."
git push origin main
