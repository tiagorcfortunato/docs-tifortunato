import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { ProjectConfig, PageConfig, resolveCodePath } from "./mapping"
import { readFile, readSystemPrompt } from "./mdx"
import { callLLM, callLLMForGeneration } from "./llm"

export type Finding = {
  type: "drift" | "missing" | "suspect" | "parse_failure"
  claim?: string
  reality?: string
  fix?: string
  error?: string
}

export type AuditResult = {
  status: "CLEAN" | "DRIFT" | "ERROR"
  findings: Finding[]
}

export function loadFacts(projectKey: string): any {
  const path = join("facts", `${projectKey}-facts.json`)
  if (!existsSync(path)) {
    throw new Error(`Facts file missing: ${path}. Run 'pnpm facts:extract ${projectKey}' first.`)
  }
  return JSON.parse(readFileSync(path, "utf-8"))
}

/** Narrow the facts manifest to the slice the page actually needs. */
export function sliceFacts(facts: any, page: PageConfig): any {
  if (!page.facts_slice || page.facts_slice.length === 0) return facts
  const sliced: Record<string, any> = {
    extracted_at: facts.extracted_at,
    source_repo: facts.source_repo,
  }
  for (const key of page.facts_slice) {
    if (key in facts) sliced[key] = facts[key]
  }
  return sliced
}

export function buildCodeSections(project: ProjectConfig, page: PageConfig, maxChars = 30000): string {
  return page.code_files.map(f => {
    const content = readFile(resolveCodePath(project, f))
    const truncated = content.length > maxChars
    const display = truncated
      ? content.slice(0, maxChars) + `\n\n[... truncated after ${maxChars} chars, full file: ${content.length} chars]`
      : content
    return `### ${f}\n\n\`\`\`\n${display}\n\`\`\``
  }).join("\n\n")
}

export async function generatePage(
  project: ProjectConfig,
  page: PageConfig,
  pagePath: string,
  projectKey: string,
): Promise<string> {
  const facts = sliceFacts(loadFacts(projectKey), page)
  const codeSections = buildCodeSections(project, page)

  const systemPrompt = `You are a senior engineer writing technical documentation for ${projectKey}. Your role is to help the reader DEEPLY UNDERSTAND the code by explaining the *why* behind every structural choice, identifying trade-offs, and surfacing concrete improvement opportunities.

Style:
- Rich narrative, not bullet lists of facts
- Explain WHY each design decision was made, even if speculative
- Weave facts into flowing prose (never dump as tables unless the table is itself the point)
- Use inline backticks for identifiers
- When citing numbers, names, paths — use EXACTLY the values from the FACTS section (those are authoritative, extracted from AST)
- Keep tone: experienced senior walking a junior through the codebase

Forbidden:
- Never invent files, function names, table counts, or any structural fact not present in FACTS
- Never skip the "Potential improvements" section — it's critical for the teaching goal
- Do NOT mention security features (encryption, hashing, signing) unless they literally appear in the CURRENT CODE. Drizzle text() columns are NOT encrypted.
- Do NOT cite specific line numbers ("line 180", "lines 1–300") unless you can count them exactly. When unsure, say "see the file" without a number.
- Do NOT claim behaviors not verifiable from CURRENT CODE. If tempted to speculate, write "(not yet implemented)" or omit.
- Do NOT invent section features. Only describe what is literally present in code or FACTS.
- Title in frontmatter must be SHORT — a single noun phrase. Never pad it with the description.
- Do NOT open paragraphs with "This page details/describes/covers/documents/focuses on" — start with the subject itself. Self-referential meta-prose is forbidden.

Banned vocabulary (zero tolerance — these are marketing filler, not technical writing):
- "robust", "powerful", "seamless", "seamlessly", "cutting-edge", "blazing-fast"
- "real-time" (unless the code literally uses WebSockets/SSE/long-polling)
- "scalable", "elegant", "comprehensive", "sophisticated"
- "leverage" / "leverages" — say "uses"
- "underpins", "boasts", "meticulously"
- "battle-tested", "industry-standard", "best-in-class"
- "ensures", "guarantees" when describing aspirational behavior

Vary your vocabulary — if you need to describe something positively, prefer specific factual claims ("rejects unauthorized requests via getUser()") over generic adjectives. If a sentence needs an adjective like "robust" to feel complete, the sentence is probably weak; rewrite it to state the concrete property instead.`

  const userPrompt = `GENERATE rich MDX documentation for this page.

# Page

${pagePath}

Description: ${page.description}

# FACTS (authoritative, extracted from AST)

${page.facts_slice ? `[scoped to: ${page.facts_slice.join(", ")}]` : "[full manifest]"}

\`\`\`json
${JSON.stringify(facts, null, 2)}
\`\`\`

# CURRENT CODE

${codeSections || "[no code files mapped for this page]"}

# OUTPUT STRUCTURE

Generate the full MDX file. Required sections:

1. **YAML frontmatter** — short title (no colon-padding from description), quoted description.
2. **# H1** matching the title
3. **Opening paragraph** — narrative context, what this page covers, why it matters
4. **## Overview** — narrative explanation of the structural picture, using facts from FACTS
5. **Main content sections** — detailed narrative with facts woven in naturally (not bullet dumps)
6. **## Design decisions** — WHY the current code looks the way it does; what trade-offs were made
7. **## Potential improvements** — concrete observations with SPECIFIC code references (file path + function/variable name, NOT line numbers). At least 3 suggestions. Each grounded in code you can cite.
8. (Optional) **## References** — file paths for deep-dive (no line numbers)

# RULES

- Open with the \`---\` frontmatter. End with the last content line. No commentary.
- MDX-safe: escape \`<\` + digit/letter (\`\\<15 min\`). Any \`{...}\` outside code spans must be escaped or wrapped in backticks.
- Numeric claims must match FACTS exactly.
- Max length: 4000 chars. Density over breadth.`

  const raw = await callLLMForGeneration(systemPrompt, userPrompt, { maxTokens: 8000 })
  return cleanOutput(raw)
}

export async function auditPage(
  project: ProjectConfig,
  page: PageConfig,
  pagePath: string,
  docContent: string,
): Promise<AuditResult> {
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

- **drift**: claim in doc contradicts code
- **missing**: code contains a fact not mentioned in doc, worth adding
- **suspect**: a claim APPEARS TO CONTRADICT available code but is unclear. ONLY flag as suspect when the code you see directly conflicts with the claim. Absence of evidence ≠ evidence of absence.

For each finding, report:
- claim: the exact sentence or phrase from the doc
- reality: what the current code actually shows
- fix: suggested replacement text

IMPORTANT: Only include findings where there is an actual problem.
- If a claim is ACCURATE, omit it.
- Findings with fix: null are invalid.
- If no issues, return { "status": "CLEAN", "findings": [] }.

Return JSON:
{
  "status": "CLEAN" | "DRIFT",
  "findings": [{ "type": "drift" | "missing" | "suspect", "claim": "...", "reality": "...", "fix": "..." }]
}`

  const raw = await callLLM(systemPrompt, userPrompt, { jsonMode: true, maxTokens: 8000 })
  try {
    return JSON.parse(raw) as AuditResult
  } catch (err) {
    return {
      status: "ERROR",
      findings: [{
        type: "parse_failure",
        error: `JSON parse failed: ${(err as Error).message?.slice(0, 200)}`,
      }],
    }
  }
}

export async function refinePage(
  project: ProjectConfig,
  page: PageConfig,
  pagePath: string,
  currentDoc: string,
  findings: Finding[],
): Promise<string> {
  const actionable = findings.filter(f => f.type === "drift" || f.type === "missing")
  if (actionable.length === 0) return currentDoc

  const codeSections = buildCodeSections(project, page)
  const styleGuide = readSystemPrompt()

  const systemPrompt = `You are refining technical documentation based on specific audit findings. Make SURGICAL fixes only — do not rewrite unrelated sections.

${styleGuide}`

  const findingsText = actionable.map((f, i) => {
    const parts = [`### Finding ${i + 1} (${f.type})`]
    if (f.claim) parts.push(`- **Claim in doc:** ${f.claim}`)
    if (f.reality) parts.push(`- **Reality per code:** ${f.reality}`)
    if (f.fix) parts.push(`- **Suggested fix:** ${f.fix}`)
    return parts.join("\n")
  }).join("\n\n")

  const userPrompt = `REFINE this documentation page to fix specific audit findings.

Page: ${pagePath}

CURRENT DOC (baseline — keep what's correct, fix only what's flagged):

${currentDoc}

AUDIT FINDINGS TO FIX:

${findingsText}

CURRENT CODE (source of truth):

${codeSections}

INSTRUCTIONS:
1. Apply each suggested fix EXACTLY as described.
2. Do NOT rewrite sections that don't have findings.
3. Do NOT invent new sections or content beyond the scope of the fixes.
4. If a fix conflicts with the code, trust the code.
5. Output the full revised MDX (frontmatter + body).

Start with \`---\`. End with the last content line. No commentary.`

  const raw = await callLLMForGeneration(systemPrompt, userPrompt, { maxTokens: 8000 })
  return cleanOutput(raw)
}

function cleanOutput(raw: string): string {
  let mdx = raw.trim()
  if (mdx.startsWith("```")) {
    mdx = mdx.replace(/^```\w*\n/, "").replace(/\n```$/, "")
  }
  return sanitizeFrontmatter(mdx)
}

/**
 * Guardrail: ensure frontmatter is valid YAML. The LLM often produces descriptions like
 * `description: Database overview: Drizzle on Supabase` where the unquoted colon+space
 * breaks YAML parsing. We auto-quote any value that contains YAML-special characters,
 * and insert a missing closing `---` fence when the model forgets it.
 */
function sanitizeFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) return content
  const afterFirst = content.indexOf("\n---\n", 4)
  if (afterFirst === -1) {
    const h1 = content.search(/\n#\s/)
    if (h1 === -1) return content
    const fm = content.slice(4, h1).trimEnd()
    const body = content.slice(h1)
    return `---\n${fm}\n---\n${body}`
  }
  const fmRaw = content.slice(4, afterFirst)
  const body = content.slice(afterFirst + 5)
  const lines = fmRaw.split("\n").map(line => {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) return line
    const [, key, value] = m
    if (!value) return line
    if (value.startsWith('"') || value.startsWith("'")) return line
    if (!/:\s|[#&*!|>%@`?\[\]{}]/.test(value)) return line
    const escaped = value.replace(/"/g, '\\"')
    return `${key}: "${escaped}"`
  })
  return `---\n${lines.join("\n")}\n---\n${body}`
}
