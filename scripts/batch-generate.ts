import { loadMapping, getProject, resolveDocPath } from "./lib/mapping"
import { readFile } from "./lib/mdx"
import { execSync } from "child_process"

const PLACEHOLDER_MARKER = "## Coming soon"

function isPlaceholder(content: string): boolean {
  return content.includes(PLACEHOLDER_MARKER)
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const [, , projectKey] = process.argv
  if (!projectKey) {
    console.error("Usage: pnpm docs:batch <project>")
    console.error("Example: pnpm docs:batch odys")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const pageKeys = Object.keys(project.pages)

  console.log(`[batch] Starting batch for project: ${projectKey}`)
  console.log(`[batch] Total pages in mapping: ${pageKeys.length}`)
  console.log()

  const stats = { generated: 0, skipped: 0, errors: 0 }
  const errorPages: string[] = []

  for (let i = 0; i < pageKeys.length; i++) {
    const pageKey = pageKeys[i]
    const docPath = resolveDocPath(project, pageKey)
    const prefix = `[${i + 1}/${pageKeys.length}] ${pageKey}`

    const content = readFile(docPath)
    if (!isPlaceholder(content)) {
      console.log(`${prefix} SKIP (already filled, ${content.length} chars)`)
      stats.skipped++
      continue
    }

    console.log(`${prefix} GENERATING...`)

    try {
      execSync(`pnpm docs:generate ${projectKey} ${pageKey}`, {
        stdio: "inherit",
      })
      stats.generated++
      // Pause 3 seconds between generations to stay under Groq free tier (30 req/min)
      if (i < pageKeys.length - 1) {
        await sleep(3000)
      }
    } catch (err) {
      console.error(`${prefix} ERROR — ${(err as Error).message?.slice(0, 100)}`)
      stats.errors++
      errorPages.push(pageKey)
      // Longer pause after error — might be rate limit
      await sleep(5000)
    }
  }

  console.log()
  console.log(`[batch] Complete for ${projectKey}:`)
  console.log(`  generated: ${stats.generated}`)
  console.log(`  skipped:   ${stats.skipped}`)
  console.log(`  errors:    ${stats.errors}`)
  if (errorPages.length > 0) {
    console.log()
    console.log(`[batch] Pages that errored — retry individually:`)
    errorPages.forEach(p => console.log(`  pnpm docs:generate ${projectKey} ${p}`))
  }
  console.log()
  console.log(`[batch] Review at http://localhost:3000/docs/projects/${projectKey}/`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
