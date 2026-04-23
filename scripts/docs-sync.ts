import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { loadMapping, getProject } from "./lib/mapping"

const STATE_FILE = "scripts/.docs-sync-state.json"

type SyncState = Record<string, string>

function loadState(): SyncState {
  if (!existsSync(STATE_FILE)) return {}
  return JSON.parse(readFileSync(STATE_FILE, "utf-8"))
}

function saveState(state: SyncState) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n")
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function main() {
  const [, , projectKey] = process.argv
  if (!projectKey) {
    console.error("Usage: pnpm docs:sync <project>")
    console.error("Example: pnpm docs:sync odys")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const state = loadState()
  const lastSha = state[projectKey]

  // Get changed files in the project repo since last sync
  const gitLogCmd = lastSha
    ? `git log ${lastSha}..HEAD --name-only --pretty=format:`
    : `git log -n 30 --name-only --pretty=format:`

  let changedFiles: string[]
  try {
    const output = execSync(gitLogCmd, { cwd: project.repo_path, encoding: "utf-8" })
    const unique = new Set(output.split("\n").map(s => s.trim()).filter(Boolean))
    changedFiles = [...unique]
  } catch (err) {
    console.error(`[sync] git log failed in ${project.repo_path}: ${(err as Error).message}`)
    console.error("[sync] If lastSha is invalid, delete it from scripts/.docs-sync-state.json and retry.")
    process.exit(1)
  }

  console.log(`[sync] Project: ${projectKey}`)
  console.log(`[sync] Last synced: ${lastSha?.slice(0, 8) || "never"}`)
  console.log(`[sync] Changed files since: ${changedFiles.length}`)

  if (changedFiles.length === 0) {
    console.log(`[sync] Nothing changed. Exiting.`)
    return
  }

  // Map changed files → affected doc pages
  const affectedPages = new Set<string>()
  for (const [pagePath, pageConfig] of Object.entries(project.pages)) {
    for (const codeFile of pageConfig.code_files) {
      if (changedFiles.some(c => c === codeFile || c.startsWith(codeFile + "/"))) {
        affectedPages.add(pagePath)
        break
      }
    }
  }

  console.log(`[sync] Affected pages: ${affectedPages.size}`)
  for (const p of affectedPages) console.log(`  - ${p}`)

  if (affectedPages.size === 0) {
    console.log(`[sync] No mapped pages affected by these changes.`)
    // Still update state so we don't re-scan these commits
    const currentSha = execSync("git rev-parse HEAD", { cwd: project.repo_path, encoding: "utf-8" }).trim()
    state[projectKey] = currentSha
    saveState(state)
    return
  }

  // Run audit on each affected page
  const driftPages: string[] = []
  for (const pagePath of affectedPages) {
    console.log(`\n[sync] ── Auditing ${pagePath} ──`)
    try {
      const output = execSync(`pnpm docs:audit ${projectKey} ${pagePath}`, { encoding: "utf-8" })
      console.log(output)
      // Simple DRIFT detection
      if (output.includes('"status": "DRIFT"')) {
        driftPages.push(pagePath)
      }
    } catch (err) {
      console.error(`[sync] Audit failed for ${pagePath}: ${(err as Error).message?.slice(0, 100)}`)
    }
    await sleep(2000)
  }

  // Update state to current HEAD
  const currentSha = execSync("git rev-parse HEAD", { cwd: project.repo_path, encoding: "utf-8" }).trim()
  state[projectKey] = currentSha
  saveState(state)

  console.log(`\n[sync] ── Summary ──`)
  console.log(`[sync] Updated state to SHA ${currentSha.slice(0, 8)}`)
  console.log(`[sync] Pages with DRIFT: ${driftPages.length}`)
  for (const p of driftPages) {
    console.log(`  pnpm docs:generate ${projectKey} ${p}`)
  }
  if (driftPages.length === 0) {
    console.log(`[sync] All audits CLEAN. No regeneration needed.`)
  } else {
    console.log(`\n[sync] Review the audit JSON above, then run the commands listed to regenerate.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
