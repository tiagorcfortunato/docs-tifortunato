import { loadMapping, getProject, getPage, resolveCodePath, resolveDocPath } from "./lib/mapping"
import { readFile, writeFile, extractDeepDiveSection, readSystemPrompt } from "./lib/mdx"
import { callLLM } from "./lib/llm"

async function main() {
  const [, , projectKey, pagePath] = process.argv
  if (!projectKey || !pagePath) {
    console.error("Usage: pnpm generate <project> <page-path>")
    console.error('Example: pnpm generate odys frontend/app-router.mdx')
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const page = getPage(project, pagePath)

  const docPath = resolveDocPath(project, pagePath)
  const existingDoc = readFile(docPath)

  const deepDiveFull = readFile(project.deep_dive_path)
  const relevantDeepDive = extractDeepDiveSection(deepDiveFull, page.deep_dive_sections)

  const codeSections = page.code_files.map(f => {
    const content = readFile(resolveCodePath(project, f))
    return `## ${f}\n\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\``
  }).join("\n\n")

  const styleGuide = readSystemPrompt()

  const systemPrompt = `You write technical documentation in MDX format. You follow the style guide exactly.

${styleGuide}`

  const userPrompt = `GENERATE MDX content for this docs page.

Page: ${pagePath}
Description: ${page.description}

STAY STRICTLY ON TOPIC
This page covers ONLY what the Description says. Do not cover adjacent material that belongs in other pages. Examples:
- If the page is about "App Router", do NOT write sections about database layer, auth internals, or deployment details
- If the page is about the database schema, do NOT explain API routes
- At most, reference adjacent concerns in ONE sentence with a brief pointer to where they're covered

STRICT FILE REFERENCES
Reference ONLY file paths that appear in the CURRENT CODE section below. Do NOT invent or infer files — if you want to mention a file, it must be present in CURRENT CODE. If a file you want to cite isn't provided, write your sentence without the file reference.

TITLE RULES
The frontmatter title must be SHORT (3-7 words) and extracted from the page's logical name, NOT from the Description. For example:
- Page: "backend/auth-register.mdx" → title: "Auth & Register Endpoints"
- Page: "backend/appointments-api.mdx" → title: "Appointments API"
- Page: "database/schema.mdx" → title: "Database Schema"
Never use the full Description as the title.

KNOWN GAPS ARE OPTIONAL AND SCOPED
Only include a Known Gaps section if you can point to a SPECIFIC PROBLEM IN A FILE FROM THE CURRENT CODE section that is a real trade-off FOR THIS PAGE'S TOPIC.
Do NOT include gaps about auth, middleware, timezones, or RLS on pages whose topic is not auth / app-router / booking / database-security. Those gaps belong on their own pages.
If no page-scoped, code-evidenced gap exists, OMIT the section entirely — no header, no bullets.

EXISTING DOC (replace if only "Coming soon" placeholder; integrate if it has real content):
${existingDoc}

RELEVANT DEEP-DIVE SECTIONS:
${relevantDeepDive || "[no deep-dive sections matched — use code only]"}

CURRENT CODE (source of truth for facts):
${codeSections || "[no code files mapped]"}

FRONTMATTER RULES
- Output MUST start with a YAML frontmatter block: opening \`---\` on line 1, closing \`---\` on its own line
- \`title\` and \`description\` values MUST be wrapped in double quotes if they contain colons, hashes, quotes, or special YAML characters
- Example valid frontmatter:
  \`\`\`
  ---
  title: "Next.js 16 App Router"
  description: "How App Router is used: server components, route groups, no middleware"
  ---
  \`\`\`

MDX RULES
- Escape \`<\` followed by a digit or identifier in prose (e.g. \`\\<15 min\` not \`<15 min\`) — MDX treats \`<\` + letter/digit as JSX start
- Safe inside backtick code spans and fenced code blocks — no escaping needed there

CONTENT RULES
- H1 matches the title
- Opening paragraph states what the page covers in plain language
- Reference specific file paths (e.g. \`src/lib/ratelimit.ts\`) when useful
- "Known gaps" / "honest flag" section is OPTIONAL — include ONLY if there is a specific, concrete trade-off IN THE CODE scoped to THIS page's topic. Do NOT include generic concerns ("could be better", "requires discipline"), subjective opinions, or gaps that belong on other pages. If no page-scoped gap exists, skip the section entirely.
- "Why this shape" section at the end is encouraged when design intent is non-obvious

OUTPUT
- Response starts with the frontmatter opening \`---\` line. Ends with the last content line.
- NO commentary, preamble, or suffix outside the MDX content.`

  console.log(`[generate] ${projectKey}/${pagePath}…`)
  const raw = await callLLM(systemPrompt, userPrompt, { maxTokens: 6000 })

  let mdx = raw.trim()
  if (mdx.startsWith("```mdx")) mdx = mdx.replace(/^```mdx\n/, "").replace(/\n```$/, "")
  else if (mdx.startsWith("```")) mdx = mdx.replace(/^```\n/, "").replace(/\n```$/, "")

  if (!mdx.startsWith("---")) {
    console.error("[generate] Output does not start with frontmatter. Refusing to write.")
    console.error(mdx.slice(0, 500))
    process.exit(2)
  }

  // Validate frontmatter block — must have opening AND closing triple-dashes
  const lines = mdx.split("\n")
  const dashLines = lines
    .map((line, i) => (line.trim() === "---" ? i : -1))
    .filter(i => i !== -1)

  if (dashLines.length < 2 || dashLines[0] !== 0) {
    console.error("[generate] Malformed frontmatter — expected opening --- on line 1 and closing --- after title/description.")
    console.error("First 20 lines of output:")
    console.error(lines.slice(0, 20).join("\n"))
    process.exit(3)
  }

  // Validate frontmatter keys contain no unquoted colons in values
  const frontmatterBlock = lines.slice(0, dashLines[1] + 1).join("\n")
  if (/^(title|description):\s*[^"'\s\n].*:/m.test(frontmatterBlock)) {
    console.error("[generate] Frontmatter has unquoted colon inside title/description — forcing quotes.")
    mdx = mdx.replace(/^(title|description):\s*([^"'\s\n].*)$/gm, (_, key, value) => {
      const escaped = value.replace(/"/g, '\\"')
      return `${key}: "${escaped}"`
    })
  }

  writeFile(docPath, mdx)
  console.log(`[generate] Wrote ${docPath} (${mdx.length} chars)`)
  console.log(`[generate] Review at http://localhost:3000/docs/projects/${projectKey}/${pagePath.replace(/\.mdx$/, "")}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
