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
    return `## ${f}\n\n\`\`\`\n${content.slice(0, 16000)}\n\`\`\``
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

For each specific factual claim in the doc, classify into one of three types:

- **drift**: claim in doc contradicts code (e.g., "10 tables" but code shows 9)
- **missing**: code contains a fact not mentioned in doc, worth adding
- **suspect**: a claim APPEARS TO CONTRADICT available code but is unclear. ONLY flag as suspect when the code you see directly conflicts with the claim. DO NOT flag as suspect merely because a fact is not present in the provided code files — most pages reference facts from other files of the project, and that is expected. Absence of evidence ≠ evidence of absence.

For each finding, report:
- claim: the exact sentence or phrase from the doc
- reality: what the current code actually shows (cite file)
- fix: suggested replacement text (can be null for suspect findings you can't resolve)

IMPORTANT: Only include findings where there is an actual problem.
- If you verify a claim is ACCURATE (fix: null), DO NOT include it in findings — simply omit.
- Findings with fix: null are invalid. Every finding must describe a concrete drift/missing/suspect issue with an actionable fix.
- If a page has no issues, return { "status": "CLEAN", "findings": [] }.

Return JSON:
{
  "status": "CLEAN" | "DRIFT",
  "findings": [{ "type": "drift" | "missing" | "suspect", "claim": "...", "reality": "...", "fix": "..." }]
}`

  console.log(`[audit] ${projectKey}/${pagePath}…`)
  const raw = await callLLM(systemPrompt, userPrompt, { jsonMode: true, maxTokens: 8000 })

  try {
    const parsed = JSON.parse(raw)
    console.log(JSON.stringify(parsed, null, 2))
  } catch (err) {
    // Emit valid JSON on stdout so downstream tooling (verify-all) can parse it as an ERROR result
    const errorPayload = {
      status: "ERROR",
      findings: [
        {
          type: "parse_failure",
          error: `JSON parse failed: ${(err as Error).message?.slice(0, 200)}`,
          raw_snippet: raw.slice(0, 500),
        },
      ],
    }
    console.log(JSON.stringify(errorPayload, null, 2))
    console.error("[audit] Failed to parse JSON from model:")
    console.error(raw)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
