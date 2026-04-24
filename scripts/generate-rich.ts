import { loadMapping, getProject, getPage, resolveDocPath } from "./lib/mapping"
import { writeFile } from "./lib/mdx"
import { generatePage, auditPage, refinePage, Finding } from "./lib/pipeline"

const MAX_REFINE_ITERATIONS = 3

async function main() {
  const [, , projectKey, pagePath, ...flags] = process.argv
  if (!projectKey || !pagePath) {
    console.error("Usage: pnpm docs:rich <project> <page-path> [--force] [--no-audit]")
    console.error("Example: pnpm docs:rich odys database/schema.mdx")
    process.exit(1)
  }
  const force = flags.includes("--force")
  const skipAudit = flags.includes("--no-audit")

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const page = getPage(project, pagePath)
  const docPath = resolveDocPath(project, pagePath)

  if (page.no_regen && !force) {
    console.error(`[rich] Refusing to regenerate ${projectKey}/${pagePath} — page has no_regen: true. Pass --force to override.`)
    process.exit(2)
  }

  console.log(`[rich] Generating ${projectKey}/${pagePath}...`)
  let mdx = await generatePage(project, page, pagePath, projectKey)

  if (!mdx.startsWith("---")) {
    console.error("[rich] Output missing frontmatter. Aborting write.")
    console.error(mdx.slice(0, 500))
    process.exit(3)
  }

  if (skipAudit) {
    writeFile(docPath, mdx)
    console.log(`[rich] Wrote ${docPath} (${mdx.length} chars) — audit skipped`)
    return
  }

  let status: string = "UNKNOWN"
  let findings: Finding[] = []
  for (let i = 1; i <= MAX_REFINE_ITERATIONS; i++) {
    console.log(`[rich] Audit pass ${i}/${MAX_REFINE_ITERATIONS}...`)
    let audit
    try {
      audit = await auditPage(project, page, pagePath, mdx)
    } catch (err) {
      console.warn(`[rich] Audit pass ${i} failed (${(err as Error).message?.slice(0, 120)}) — keeping prior draft.`)
      break
    }
    status = audit.status
    findings = audit.findings
    const actionable = findings.filter(f => f.type === "drift" || f.type === "missing")

    if (status === "ERROR") {
      console.warn(`[rich] Audit returned ERROR — keeping current draft. Findings: ${JSON.stringify(findings).slice(0, 300)}`)
      break
    }
    if (status === "CLEAN") {
      console.log(`[rich] ✓ CLEAN after ${i} audit pass${i === 1 ? "" : "es"}`)
      break
    }
    if (actionable.length === 0) {
      console.log(`[rich] ✓ No actionable findings after ${i} audit pass${i === 1 ? "" : "es"} (${findings.length} suspect-only)`)
      break
    }
    console.log(`[rich] ${actionable.length} finding(s). Refining...`)
    let refined: string
    try {
      refined = await refinePage(project, page, pagePath, mdx, findings)
    } catch (err) {
      console.warn(`[rich] Refine pass ${i} failed (${(err as Error).message?.slice(0, 120)}) — keeping prior draft.`)
      break
    }
    if (!refined.startsWith("---")) {
      console.warn(`[rich] Refine pass ${i} produced invalid output — keeping prior draft.`)
      break
    }
    mdx = refined
  }

  writeFile(docPath, mdx)
  const finalStatus = status === "CLEAN" ? "CLEAN" : `${status} with ${findings.length} finding(s)`
  console.log(`[rich] Wrote ${docPath} (${mdx.length} chars) — ${finalStatus}`)
  console.log(`[rich] Review at http://localhost:3000/docs/projects/${projectKey}/${pagePath.replace(/\.mdx$/, "")}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
