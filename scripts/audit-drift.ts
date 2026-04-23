import { loadMapping, getProject, getPage, resolveCodePath, resolveDocPath } from "./lib/mapping"
import { readFile, readSystemPrompt } from "./lib/mdx"
import { callLLM } from "./lib/llm"

async function main() {
  const [, , projectKey, pagePath] = process.argv
  if (!projectKey || !pagePath) {
    console.error("Usage: pnpm audit <project> <page-path>")
    console.error('Example: pnpm audit odys architecture.mdx')
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const page = getPage(project, pagePath)

  const docPath = resolveDocPath(project, pagePath)
  const docContent = readFile(docPath)

  const codeSections = page.code_files.map(f => {
    const content = readFile(resolveCodePath(project, f))
    return `## ${f}\n\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``
  }).join("\n\n")

  const styleGuide = readSystemPrompt()

  const systemPrompt = `You audit technical documentation for factual drift against source code. You respond only with valid JSON.

${styleGuide}`

  const userPrompt = `AUDIT TASK

Page: ${pagePath}
Description: ${page.description}

CURRENT DOC CONTENT:
${docContent}

CURRENT CODE (excerpts):
${codeSections || "[no code files mapped — treat doc as stale-safe]"}

For each specific factual claim in the doc that has drifted from the current code, report:
- claim: the exact sentence or phrase from the doc
- reality: what the current code actually shows (cite file)
- fix: suggested replacement text

Also surface:
- missing: claims the code supports that aren't in the doc yet
- suspect: claims you can't verify from the code excerpts

Return JSON:
{
  "status": "CLEAN" | "DRIFT",
  "findings": [{ "type": "drift" | "missing" | "suspect", "claim": "...", "reality": "...", "fix": "..." }]
}`

  console.log(`[audit] ${projectKey}/${pagePath}…`)
  const raw = await callLLM(systemPrompt, userPrompt, { jsonMode: true, maxTokens: 3000 })

  try {
    const parsed = JSON.parse(raw)
    console.log(JSON.stringify(parsed, null, 2))
  } catch (err) {
    console.error("[audit] Failed to parse JSON from model:")
    console.error(raw)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
