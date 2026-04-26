import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { loadMapping, getProject, getPage, resolveDocPath } from "./lib/mapping"
import { writeFile } from "./lib/mdx"
import { generatePage, auditPage, refinePage, Finding } from "./lib/pipeline"

const STATE_FILE = "scripts/.docs-sync-state.json"
// Lower budget mode: 1 audit pass per page, no refine loop. Cuts LLM calls per
// page from ~5 (audit + refine + audit + refine + audit) down to ~1 (audit).
// Pages still get labeled CLEAN/DRIFT in the summary; manual fixes happen in PR.
const MAX_REFINE_ITERATIONS = 1

type SyncState = Record<string, string>

function loadState(): SyncState {
  if (!existsSync(STATE_FILE)) return {}
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
}

function saveState(state: SyncState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n")
}

async function regenerateOne(project: any, pagePath: string, projectKey: string): Promise<string> {
  const page = getPage(project, pagePath)
  if (page.no_regen) return "skipped (no_regen)"

  const docPath = resolveDocPath(project, pagePath)
  let mdx = await generatePage(project, page, pagePath, projectKey)
  if (!mdx.startsWith("---")) return "failed (bad output)"

  let status = "UNKNOWN"
  let findings: Finding[] = []
  for (let i = 1; i <= MAX_REFINE_ITERATIONS; i++) {
    let audit
    try {
      audit = await auditPage(project, page, pagePath, mdx)
    } catch {
      break
    }
    status = audit.status
    findings = audit.findings
    const actionable = findings.filter(f => f.type === "drift" || f.type === "missing")
    if (status === "ERROR" || status === "CLEAN" || actionable.length === 0) break
    try {
      const refined = await refinePage(project, page, pagePath, mdx, findings)
      if (refined.startsWith("---")) mdx = refined
      else break
    } catch {
      break
    }
  }
  writeFile(docPath, mdx)
  return status === "CLEAN" ? "✓ CLEAN" : `⚠ ${status} (${findings.length} finding${findings.length === 1 ? "" : "s"})`
}

async function main() {
  const [, , projectKey, ...flags] = process.argv
  const dryRun = flags.includes("--dry-run")
  const all = flags.includes("--all")

  if (!projectKey) {
    console.error("Usage: pnpm docs:sync <project> [--dry-run] [--all]")
    console.error("  --dry-run   List affected pages without regenerating")
    console.error("  --all       Regenerate all pages (ignore change detection)")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const state = loadState()
  const lastSha = state[projectKey]

  let affectedPages: string[]

  if (all) {
    affectedPages = Object.keys(project.pages)
    console.log(`[sync] --all flag: ${affectedPages.length} page(s) queued`)
  } else {
    // Detect files changed in the source repo since last sync
    const gitLogCmd = lastSha
      ? `git log ${lastSha}..HEAD --name-only --pretty=format:`
      : `git log -n 30 --name-only --pretty=format:`

    let changedFiles: string[]
    try {
      const output = execSync(gitLogCmd, { cwd: project.repo_path, encoding: "utf-8" })
      changedFiles = [...new Set(output.split("\n").map(s => s.trim()).filter(Boolean))]
    } catch (err) {
      // Most common cause: state SHA is no longer reachable (force-push, history
      // rewrite, or fetch-depth too shallow). Don't abort the whole pipeline —
      // fall back to processing the most recent 50 commits as if no state existed.
      console.warn(`[sync] git log with state SHA failed (${(err as Error).message?.slice(0, 100)})`)
      console.warn(`[sync] Falling back to last 50 commits.`)
      try {
        const output = execSync(`git log -n 50 --name-only --pretty=format:`, {
          cwd: project.repo_path,
          encoding: "utf-8",
        })
        changedFiles = [...new Set(output.split("\n").map(s => s.trim()).filter(Boolean))]
      } catch (err2) {
        console.error(`[sync] Fallback git log also failed: ${(err2 as Error).message}`)
        process.exit(1)
      }
    }

    console.log(`[sync] Project:      ${projectKey}`)
    console.log(`[sync] Last synced:  ${lastSha?.slice(0, 8) || "never"}`)
    console.log(`[sync] Changed:      ${changedFiles.length} file(s)`)

    if (changedFiles.length === 0) {
      console.log(`[sync] Nothing to do.`)
      return
    }

    const affected = new Set<string>()
    for (const [pagePath, pageConfig] of Object.entries(project.pages)) {
      for (const codeFile of pageConfig.code_files) {
        if (changedFiles.some(c => c === codeFile || c.startsWith(codeFile + "/"))) {
          affected.add(pagePath)
          break
        }
      }
    }
    affectedPages = [...affected]

    console.log(`[sync] Affected:     ${affectedPages.length} page(s)`)
    for (const p of affectedPages) console.log(`  - ${p}`)
  }

  if (affectedPages.length === 0) {
    console.log(`[sync] No mapped pages touched. Marking sync point.`)
    state[projectKey] = execSync("git rev-parse HEAD", { cwd: project.repo_path, encoding: "utf-8" }).trim()
    saveState(state)
    return
  }

  if (dryRun) {
    console.log(`[sync] --dry-run: exiting without regenerating.`)
    return
  }

  // Always re-extract facts first — the code just changed
  console.log(`\n[sync] Re-extracting facts for ${projectKey}...`)
  execSync(`pnpm facts:extract ${projectKey}`, { stdio: "inherit" })

  console.log(`\n[sync] Regenerating ${affectedPages.length} page(s)...`)
  const results: { page: string; status: string }[] = []
  for (const pagePath of affectedPages) {
    process.stdout.write(`  ${pagePath} ... `)
    try {
      const status = await regenerateOne(project, pagePath, projectKey)
      console.log(status)
      results.push({ page: pagePath, status })
    } catch (err) {
      const msg = `failed (${(err as Error).message?.slice(0, 80)})`
      console.log(msg)
      results.push({ page: pagePath, status: msg })
    }
    await new Promise(r => setTimeout(r, 5000))
  }

  // Update sync state to current HEAD of source repo
  const currentSha = execSync("git rev-parse HEAD", { cwd: project.repo_path, encoding: "utf-8" }).trim()
  state[projectKey] = currentSha
  saveState(state)

  const clean = results.filter(r => r.status.startsWith("✓")).length
  const drift = results.filter(r => r.status.startsWith("⚠")).length
  const failed = results.filter(r => r.status.startsWith("failed")).length
  const skipped = results.filter(r => r.status.startsWith("skipped")).length

  console.log(`\n[sync] ── Summary ──`)
  console.log(`[sync] Source HEAD: ${currentSha.slice(0, 8)}`)
  console.log(`[sync] CLEAN: ${clean}  DRIFT: ${drift}  failed: ${failed}  skipped: ${skipped}`)

  // Write a machine-readable summary the CI can surface in the PR body
  const failedList = results.filter(r => r.status.startsWith("failed")).map(r => r.page)
  const driftList = results.filter(r => r.status.startsWith("⚠")).map(r => r.page)
  writeFile(".sync-summary.md", [
    `## Docs sync — ${projectKey}`,
    ``,
    `Source HEAD: \`${currentSha.slice(0, 8)}\``,
    ``,
    `| Status | Count |`,
    `|---|---:|`,
    `| ✓ CLEAN   | ${clean} |`,
    `| ⚠ DRIFT   | ${drift} |`,
    `| ✗ failed  | ${failed} |`,
    `| ⊘ skipped | ${skipped} |`,
    ...(failedList.length ? [``, `### Failed pages (retry later — usually provider rate limits)`, ...failedList.map(p => `- \`${p}\``)] : []),
    ...(driftList.length ? [``, `### Drift flagged (audit found issues that the refine loop didn't fully close)`, ...driftList.map(p => `- \`${p}\``)] : []),
  ].join("\n") + "\n")

  // Exit 0 even on partial failure — let the successful pages land.
  // Only true hard errors should fail the workflow.
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
