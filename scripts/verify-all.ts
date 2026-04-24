import { execSync } from "child_process"
import { writeFileSync } from "fs"
import { loadMapping, getProject } from "./lib/mapping"

type AuditFinding = {
  type?: string
  claim?: string
  reality?: string
  fix?: string
  error?: string
}
type AuditResult = {
  status: "CLEAN" | "DRIFT" | "SUSPECT" | "ERROR"
  findings: AuditFinding[]
}
type PageResult = {
  page: string
  initialStatus: string
  initialFindings: AuditFinding[]
  regenerated: boolean
  finalStatus: string
  finalFindings: AuditFinding[]
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

function parseAuditOutput(output: string): AuditResult {
  const lines = output.split("\n")
  const jsonStart = lines.findIndex(l => l.trim().startsWith("{"))
  if (jsonStart === -1) {
    return { status: "ERROR", findings: [{ error: "No JSON in output" }] }
  }
  try {
    const jsonBlock = lines.slice(jsonStart).join("\n")
    const parsed = JSON.parse(jsonBlock)
    if (!parsed.status) {
      return { status: "ERROR", findings: [{ error: "No status field in JSON" }] }
    }
    return parsed as AuditResult
  } catch (err) {
    return { status: "ERROR", findings: [{ error: `JSON parse failed: ${(err as Error).message?.slice(0, 120)}` }] }
  }
}

async function auditPage(projectKey: string, pagePath: string): Promise<AuditResult> {
  try {
    const output = execSync(`pnpm docs:audit ${projectKey} ${pagePath}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return parseAuditOutput(output)
  } catch (err) {
    const stderr = (err as any).stderr?.toString?.() ?? ""
    return { status: "ERROR", findings: [{ error: `Audit exec failed: ${stderr.slice(0, 200) || (err as Error).message?.slice(0, 200)}` }] }
  }
}

async function regeneratePage(projectKey: string, pagePath: string): Promise<boolean> {
  try {
    execSync(`pnpm docs:generate ${projectKey} ${pagePath}`, { stdio: "inherit" })
    return true
  } catch {
    return false
  }
}

async function main() {
  const [, , projectKey] = process.argv
  if (!projectKey) {
    console.error("Usage: pnpm docs:verify <project>")
    console.error("Example: pnpm docs:verify odys")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const pageKeys = Object.keys(project.pages)

  console.log(`[verify] Project: ${projectKey}`)
  console.log(`[verify] Pages: ${pageKeys.length}`)
  console.log(`[verify] Starting verification pipeline (audit → regen-on-drift → re-audit)\n`)

  const results: PageResult[] = []

  for (let i = 0; i < pageKeys.length; i++) {
    const pagePath = pageKeys[i]
    const prefix = `[${i + 1}/${pageKeys.length}]`

    console.log(`${prefix} ${pagePath}`)

    const initial = await auditPage(projectKey, pagePath)
    console.log(`  → initial: ${initial.status}`)

    const result: PageResult = {
      page: pagePath,
      initialStatus: initial.status,
      initialFindings: initial.findings || [],
      regenerated: false,
      finalStatus: initial.status,
      finalFindings: initial.findings || [],
    }

    if (initial.status === "DRIFT") {
      console.log(`  → refining (surgical fix based on findings)…`)

      // Write findings to temp file for refine script to consume
      const tmpFindingsPath = `/tmp/refine-findings-${Date.now()}.json`
      const { unlinkSync } = await import("fs")
      writeFileSync(tmpFindingsPath, JSON.stringify(initial.findings, null, 2))

      try {
        execSync(`pnpm docs:refine ${projectKey} ${pagePath} ${tmpFindingsPath}`, { stdio: "inherit" })
        result.regenerated = true

        await sleep(2000)
        console.log(`  → re-auditing…`)
        const final = await auditPage(projectKey, pagePath)
        result.finalStatus = final.status
        result.finalFindings = final.findings || []
        console.log(`  → after refine: ${final.status} ${final.status === "CLEAN" ? "✅ auto-fixed via refine" : "⚠️  still needs review"}`)
      } catch (err) {
        console.log(`  → refine failed, falling back to full regenerate…`)
        const ok = await regeneratePage(projectKey, pagePath)
        result.regenerated = true
        if (ok) {
          await sleep(2000)
          const final = await auditPage(projectKey, pagePath)
          result.finalStatus = final.status
          result.finalFindings = final.findings || []
          console.log(`  → after fallback regen: ${final.status}`)
        } else {
          result.finalStatus = "ERROR"
          result.finalFindings = [{ error: "Both refine and regenerate failed" }]
        }
      } finally {
        try { unlinkSync(tmpFindingsPath) } catch {}
      }
    }

    results.push(result)
    await sleep(3000) // rate-limit pacing
  }

  // Build report
  const date = new Date().toISOString().slice(0, 10)
  const reportPath = `audit-report-${projectKey}-${date}.md`

  const clean = results.filter(r => r.finalStatus === "CLEAN")
  const autoFixed = results.filter(r => r.regenerated && r.finalStatus === "CLEAN")
  const drift = results.filter(r => r.finalStatus === "DRIFT")
  const suspect = results.filter(r => r.finalStatus === "SUSPECT")
  const errored = results.filter(r => r.finalStatus === "ERROR")

  const lines: string[] = []
  lines.push(`# Audit Report — ${projectKey} — ${date}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(`- **Total pages:** ${results.length}`)
  lines.push(`- **CLEAN (final):** ${clean.length} (${Math.round((clean.length / results.length) * 100)}%)`)
  lines.push(`- **Auto-fixed via regenerate:** ${autoFixed.length}`)
  lines.push(`- **Still DRIFT after regen:** ${drift.length}`)
  lines.push(`- **SUSPECT (audit unsure):** ${suspect.length}`)
  lines.push(`- **Errors (audit failed):** ${errored.length}`)
  lines.push("")

  if (drift.length > 0) {
    lines.push("## ⚠️  Needs human review — still DRIFT after regen")
    lines.push("")
    for (const r of drift) {
      lines.push(`### \`${r.page}\``)
      lines.push("")
      for (const f of r.finalFindings) {
        if (f.claim) lines.push(`- **Claim:** ${f.claim}`)
        if (f.reality) lines.push(`  **Reality:** ${f.reality}`)
        if (f.fix) lines.push(`  **Fix:** ${f.fix}`)
        lines.push("")
      }
    }
  }

  if (suspect.length > 0) {
    lines.push("## ⚠️  SUSPECT — couldn't verify from mapped code")
    lines.push("")
    for (const r of suspect) {
      lines.push(`- \`${r.page}\` — consider adding more code files to its mapping`)
    }
    lines.push("")
  }

  if (errored.length > 0) {
    lines.push("## ❌ Errored during verification")
    lines.push("")
    for (const r of errored) {
      lines.push(`- \`${r.page}\`: ${r.finalFindings[0]?.error ?? "unknown"}`)
    }
    lines.push("")
  }

  if (autoFixed.length > 0) {
    lines.push("## ✅ Auto-fixed (regenerated, now CLEAN)")
    lines.push("")
    for (const r of autoFixed) {
      lines.push(`- \`${r.page}\``)
    }
    lines.push("")
  }

  lines.push("## ✅ CLEAN on first audit (no changes)")
  lines.push("")
  for (const r of clean.filter(r => !r.regenerated)) {
    lines.push(`- \`${r.page}\``)
  }
  lines.push("")

  writeFileSync(reportPath, lines.join("\n"))

  console.log(`\n[verify] ═══════════════════════════════════════`)
  console.log(`[verify] COMPLETE`)
  console.log(`[verify] CLEAN:           ${clean.length}/${results.length}`)
  console.log(`[verify] Auto-fixed:      ${autoFixed.length}`)
  console.log(`[verify] Need human:      ${drift.length + suspect.length}`)
  console.log(`[verify] Errors:          ${errored.length}`)
  console.log(`[verify] Report:          ${reportPath}`)
  console.log(`[verify] ═══════════════════════════════════════`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
