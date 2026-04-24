import { loadMapping, getProject, getPage, resolveCodePath, resolveDocPath } from "./lib/mapping"
import { readFile, writeFile, readSystemPrompt } from "./lib/mdx"
import { callLLMForGeneration } from "./lib/llm"

type AuditFinding = {
  type?: string
  claim?: string
  reality?: string
  fix?: string
}

async function main() {
  const [, , projectKey, pagePath, findingsJsonPath] = process.argv
  if (!projectKey || !pagePath || !findingsJsonPath) {
    console.error("Usage: pnpm docs:refine <project> <page> <findings-json-file>")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const page = getPage(project, pagePath)

  const docPath = resolveDocPath(project, pagePath)
  const currentDoc = readFile(docPath)

  const findingsRaw = readFile(findingsJsonPath)
  const findings: AuditFinding[] = JSON.parse(findingsRaw)

  const codeSections = page.code_files.map(f => {
    const content = readFile(resolveCodePath(project, f))
    const maxChars = 30000
    const truncated = content.length > maxChars
    const displayContent = truncated
      ? content.slice(0, maxChars) + `\n\n[... TRUNCATED after ${maxChars} chars]`
      : content
    return `## ${f}\n\n\`\`\`\n${displayContent}\n\`\`\``
  }).join("\n\n")

  const styleGuide = readSystemPrompt()

  const systemPrompt = `You are refining technical documentation based on specific audit findings. Make SURGICAL fixes only — do not rewrite unrelated sections.

${styleGuide}`

  const findingsText = findings
    .filter(f => f.type === "drift" || f.type === "missing")
    .map((f, i) => {
      const parts = [`### Finding ${i + 1} (${f.type})`]
      if (f.claim) parts.push(`- **Claim in doc:** ${f.claim}`)
      if (f.reality) parts.push(`- **Reality per code:** ${f.reality}`)
      if (f.fix) parts.push(`- **Suggested fix:** ${f.fix}`)
      return parts.join("\n")
    })
    .join("\n\n")

  const userPrompt = `REFINE this documentation page to fix specific audit findings.

Page: ${pagePath}

CURRENT DOC (the baseline — keep what's correct, fix only what's flagged):

${currentDoc}

AUDIT FINDINGS TO FIX:

${findingsText}

CURRENT CODE (source of truth):

${codeSections}

INSTRUCTIONS:
1. Apply each suggested fix EXACTLY as described. If the finding says "change X to Y", change X to Y in the doc — do not paraphrase.
2. Do NOT rewrite sections that don't have findings. Preserve the doc's existing structure, tone, and all accurate content.
3. Do NOT invent new sections or content beyond the scope of the fixes.
4. If a finding's suggested fix conflicts with something you see in the code, trust the code over the fix.
5. Output the full revised MDX (frontmatter + body) so it can replace the current file.

Start your response with the frontmatter opening \`---\` line. End with the last content line. No commentary.`

  console.log(`[refine] ${projectKey}/${pagePath} — applying ${findings.length} findings`)
  const raw = await callLLMForGeneration(systemPrompt, userPrompt, { maxTokens: 8000 })

  let mdx = raw.trim()
  if (mdx.startsWith("```")) {
    mdx = mdx.replace(/^```\w*\n/, "").replace(/\n```$/, "")
  }

  if (!mdx.startsWith("---")) {
    console.error("[refine] Output does not start with frontmatter. Aborting write.")
    console.error(mdx.slice(0, 500))
    process.exit(2)
  }

  writeFile(docPath, mdx)
  console.log(`[refine] Wrote refined ${docPath} (${mdx.length} chars)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
