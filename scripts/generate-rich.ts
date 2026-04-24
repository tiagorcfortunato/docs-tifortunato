import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { loadMapping, getProject, getPage, resolveCodePath, resolveDocPath } from "./lib/mapping"
import { readFile } from "./lib/mdx"
import { callLLMForGeneration } from "./lib/llm"

function loadFacts(projectKey: string): any {
  const path = join("facts", `${projectKey}-facts.json`)
  if (!existsSync(path)) {
    throw new Error(`Facts file missing: ${path}. Run 'pnpm facts:extract ${projectKey}' first.`)
  }
  return JSON.parse(readFileSync(path, "utf-8"))
}

async function main() {
  const [, , projectKey, pagePath] = process.argv
  if (!projectKey || !pagePath) {
    console.error("Usage: pnpm docs:rich <project> <page-path>")
    console.error("Example: pnpm docs:rich odys database/schema.mdx")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const page = getPage(project, pagePath)
  const facts = loadFacts(projectKey)

  const docPath = resolveDocPath(project, pagePath)

  // Read mapped code files
  const codeSections = page.code_files.map((f: string) => {
    const content = readFile(resolveCodePath(project, f))
    const maxChars = 30000
    const truncated = content.length > maxChars
    const display = truncated
      ? content.slice(0, maxChars) + `\n\n[... truncated after ${maxChars} chars, full file: ${content.length} chars]`
      : content
    return `### ${f}\n\n\`\`\`\n${display}\n\`\`\``
  }).join("\n\n")

  const systemPrompt = `You are a senior engineer writing technical documentation for Tiago's project. Your role is to help Tiago DEEPLY UNDERSTAND his own code by explaining the *why* behind every structural choice, identifying trade-offs, and surfacing concrete improvement opportunities.

Style:
- Rich narrative, not bullet lists of facts
- Explain WHY each design decision was made, even if speculative
- Weave facts into flowing prose (never dump as tables unless the table is itself the point)
- Use inline backticks for identifiers
- When citing numbers, names, paths — use EXACTLY the values from the FACTS section (those are authoritative, extracted from AST)
- Keep tone: experienced senior walking a junior through the codebase

Forbidden:
- Never invent files, function names, table counts, or any structural fact not present in FACTS
- Never write marketing fluff ("powerful", "seamless", "cutting-edge")
- Never say "this project" — always "Odys" or the specific feature
- Never skip the "Potential improvements" section — it's critical for the teaching goal
- Do NOT mention security features (encryption, hashing, signing) unless they literally appear in the CURRENT CODE. Drizzle text() columns are NOT encrypted.
- Do NOT cite specific line numbers ("line 180", "lines 1–300") unless you can count them exactly. When unsure, say "see the file" without a number.
- Do NOT use aspirational marketing words: "real-time", "seamless", "powerful", "robust", "cutting-edge", "scalable", "blazing-fast". They are marketing fluff.
- Do NOT claim behaviors not verifiable from CURRENT CODE. If tempted to speculate, write "(not yet implemented)" or omit.
- Do NOT invent section features. Only describe what is literally present in code or FACTS.`

  const userPrompt = `GENERATE rich MDX documentation for this page.

# Page

${pagePath}

Description: ${page.description}

# FACTS (authoritative source of truth — extracted from AST of Odys code)

These values are the ONLY values you may use for anything structural. Do NOT invent or modify them.

\`\`\`json
${JSON.stringify(facts, null, 2)}
\`\`\`

# CURRENT CODE (for context, not for fact extraction)

${codeSections || "[no code files mapped for this page]"}

# OUTPUT STRUCTURE

Generate the full MDX file. Required sections:

1. **YAML frontmatter** (title quoted if contains colon; description quoted)
2. **# H1** matching the title
3. **Opening paragraph** — narrative context, what this page covers, why it matters to Odys
4. **## Overview** — narrative explanation of the structural picture, using facts from FACTS
5. **Main content sections** — detailed narrative with facts woven in naturally (not bullet dumps)
6. **## Design decisions** — WHY the current code looks the way it does; what trade-offs were made
7. **## Potential improvements** — concrete observations with SPECIFIC code references (file path + function/variable name, NOT line numbers). At least 3 suggestions. Each grounded in code you can cite.
8. (Optional) **## References** — file paths with line numbers for deep-dive

# RULES

- Open with the \`---\` frontmatter. End with the last content line. No commentary.
- MDX-safe: escape \`<\` + digit/letter (\`\\<15 min\`). Backticks in code spans are fine.
- Numeric claims: must match FACTS exactly ("10-table schema" only if facts.schema.tableCount === 10).
- Improvements section: at least 3 concrete suggestions, each with file reference + reasoning.
- Max length: 4000 chars. Density over breadth.`

  console.log(`[rich] Generating ${projectKey}/${pagePath}...`)
  const raw = await callLLMForGeneration(systemPrompt, userPrompt, { maxTokens: 8000 })

  let mdx = raw.trim()
  if (mdx.startsWith("```")) {
    mdx = mdx.replace(/^```\w*\n/, "").replace(/\n```$/, "")
  }

  if (!mdx.startsWith("---")) {
    console.error("[rich] Output missing frontmatter. Aborting write.")
    console.error(mdx.slice(0, 500))
    process.exit(2)
  }

  writeFile(docPath, mdx)
  console.log(`[rich] Wrote ${docPath} (${mdx.length} chars)`)
  console.log(`[rich] Review at http://localhost:3000/docs/projects/${projectKey}/${pagePath.replace(/\.mdx$/, "")}`)
}

function writeFile(path: string, content: string): void {
  writeFileSync(path, content, "utf-8")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
