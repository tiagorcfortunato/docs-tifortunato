import { loadMapping, getProject, getPage, resolveCodePath, resolveDocPath } from "./lib/mapping"
import { readFile, writeFile, extractDeepDiveSection, readSystemPrompt } from "./lib/mdx"
import { callGroq } from "./lib/groq"

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
    return `## ${f}\n\n\`\`\`\n${content.slice(0, 10000)}\n\`\`\``
  }).join("\n\n")

  const styleGuide = readSystemPrompt()

  const systemPrompt = `You write technical documentation in MDX format. You follow the style guide exactly.

${styleGuide}`

  const userPrompt = `GENERATE MDX content for this docs page.

Page: ${pagePath}
Description: ${page.description}

EXISTING DOC (replace if only "Coming soon" placeholder; integrate if has real content):
${existingDoc}

RELEVANT DEEP-DIVE SECTIONS:
${relevantDeepDive || "[no deep-dive sections matched — use code only]"}

CURRENT CODE (source of truth for facts):
${codeSections || "[no code files mapped]"}

OUTPUT
- Full MDX content for the page, including the frontmatter block
- Include a clear H1 matching the title
- Use the style guide's tone and structure
- Reference file paths / line numbers where useful
- Include an "honest flag" or "Known gaps" section if there are genuine trade-offs in the code
- Do NOT invent facts; if the code is missing something, say so
- Frontmatter rules (strict YAML): wrap any \`title\` or \`description\` value that contains \`:\`, \`#\`, \`"\`, \`'\`, \`\\\`\`, \`[\`, \`]\`, \`{\`, \`}\`, \`|\`, \`>\`, or starts with a non-letter in double quotes (escape inner \`"\` as \`\\"\`). When in doubt, quote.
- MDX rules: never write raw \`<\` followed by a digit or identifier outside a fenced code block; escape with \`\\<\` or wrap in backticks. Put multi-line code samples in fenced code blocks with a language tag.
- Start the response with the triple-dash frontmatter; end with the last line of content. No commentary before or after.`

  console.log(`[generate] ${projectKey}/${pagePath}…`)
  const raw = await callGroq(systemPrompt, userPrompt, { maxTokens: 6000 })

  let mdx = raw.trim()
  if (mdx.startsWith("```mdx")) mdx = mdx.replace(/^```mdx\n/, "").replace(/\n```$/, "")
  else if (mdx.startsWith("```")) mdx = mdx.replace(/^```\n/, "").replace(/\n```$/, "")

  if (!mdx.startsWith("---")) {
    console.error("[generate] Output does not start with frontmatter. Refusing to write.")
    console.error(mdx.slice(0, 500))
    process.exit(2)
  }

  writeFile(docPath, mdx)
  console.log(`[generate] Wrote ${docPath} (${mdx.length} chars)`)
  console.log(`[generate] Review at http://localhost:3000/docs/projects/${projectKey}/${pagePath.replace(/\.mdx$/, "")}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
