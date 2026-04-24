#!/bin/bash
set -uo pipefail

# 27 structural pages minus architecture (no_regen), schema, cron-jobs (already regenerated)
PAGES=(
  "database/index.mdx"
  "database/drizzle-orm.mdx"
  "database/rls-gap.mdx"
  "backend/index.mdx"
  "backend/api-routes-overview.mdx"
  "backend/auth-register.mdx"
  "backend/booking-api.mdx"
  "backend/appointments-api.mdx"
  "payment/index.mdx"
  "payment/stripe-subscription.mdx"
  "payment/pix-flow.mdx"
  "payment/webhook-verification.mdx"
  "mcp-server/index.mdx"
  "mcp-server/four-tools.mdx"
  "mcp-server/stdio-transport.mdx"
  "mcp-server/shared-schema.mdx"
  "whatsapp/index.mdx"
  "whatsapp/evolution-api.mdx"
  "whatsapp/message-templates.mdx"
  "whatsapp/watchdog-cron.mdx"
  "deployment/index.mdx"
  "deployment/vercel.mdx"
  "deployment/github-actions-ci.mdx"
  "deployment/railway-evolution.mdx"
  "observability/index.mdx"
  "observability/sentry.mdx"
  "observability/posthog.mdx"
)

BATCH_SIZE=5
BATCH_PAUSE=60   # seconds between batches — gives provider TPM windows time to reset
PAGE_PAUSE=8    # seconds between pages within a batch

SUCCEEDED=()
FAILED=()
TOTAL=${#PAGES[@]}
START=$(date +%s)

echo "=== Odys full refresh: $TOTAL pages in batches of $BATCH_SIZE ==="
echo ""

for ((i=0; i<${#PAGES[@]}; i++)); do
  page="${PAGES[$i]}"
  idx=$((i + 1))

  # Batch boundary
  if [ $i -gt 0 ] && [ $((i % BATCH_SIZE)) -eq 0 ]; then
    echo ""
    echo "--- Batch pause ${BATCH_PAUSE}s ---"
    sleep $BATCH_PAUSE
    echo ""
  fi

  echo "[$idx/$TOTAL] $page"
  if pnpm docs:rich odys "$page" > /tmp/refresh-$$.log 2>&1; then
    tail -1 /tmp/refresh-$$.log
    SUCCEEDED+=("$page")
    git add "content/docs/projects/odys/$page" 2>/dev/null || true
    git commit -m "content(odys): regenerate $page via audit-gated pipeline" --quiet 2>/dev/null || true
  else
    tail -3 /tmp/refresh-$$.log | sed 's/^/    /'
    echo "  ✗ failed"
    FAILED+=("$page")
  fi

  sleep $PAGE_PAUSE
done

rm -f /tmp/refresh-$$.log
END=$(date +%s)
RUNTIME=$((END - START))

echo ""
echo "════════════════════════════════════════"
echo "BATCH REFRESH COMPLETE"
echo "════════════════════════════════════════"
echo "Total:     $TOTAL"
echo "Succeeded: ${#SUCCEEDED[@]}"
echo "Failed:    ${#FAILED[@]}"
echo "Runtime:   $((RUNTIME / 60))m $((RUNTIME % 60))s"
echo ""
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "Failed pages (will need retry):"
  printf '  ✗ %s\n' "${FAILED[@]}"
  echo ""
fi
echo "Pushing..."
git push origin main
