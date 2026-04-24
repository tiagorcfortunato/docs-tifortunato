import { existsSync, mkdirSync, writeFileSync } from "fs"
import { join, resolve, isAbsolute } from "path"

async function main() {
  const [, , name, repoPathRaw] = process.argv
  if (!name || !repoPathRaw) {
    console.error("Usage: pnpm docs:add-project <name> <repo-path>")
    console.error("Example: pnpm docs:add-project career-chatbot /Users/me/projects/career-chatbot")
    process.exit(1)
  }

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error(`[add-project] Invalid name '${name}'. Use lowercase letters, digits, and hyphens only.`)
    process.exit(1)
  }

  const repoPath = isAbsolute(repoPathRaw) ? repoPathRaw : resolve(repoPathRaw)
  if (!existsSync(repoPath)) {
    console.error(`[add-project] Repo path not found: ${repoPath}`)
    process.exit(1)
  }

  const projectDir = join("projects", name)
  const configPath = join(projectDir, "config.json")
  const docsDir = join("content/docs/projects", name)
  const indexMdxPath = join(docsDir, "index.mdx")
  const metaJsonPath = join(docsDir, "meta.json")

  if (existsSync(configPath)) {
    console.error(`[add-project] Project '${name}' already exists at ${configPath}. Aborting.`)
    process.exit(2)
  }

  mkdirSync(projectDir, { recursive: true })
  mkdirSync(docsDir, { recursive: true })

  const config = {
    repo_path: repoPath,
    docs_root: docsDir,
    deep_dive_path: "",
    pages: {
      "index.mdx": {
        code_files: ["README.md"],
        deep_dive_sections: [],
        description: `Overview — what ${name} is, current state, list of docs`,
        no_regen: true,
      },
    },
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

  if (!existsSync(indexMdxPath)) {
    writeFileSync(indexMdxPath, `---
title: ${name}
description: Overview of ${name}.
---

# ${name}

*Hand-authored overview — replace this stub when you're ready.*

## What it is

## Current state

## Docs in this section
`)
  }

  if (!existsSync(metaJsonPath)) {
    writeFileSync(metaJsonPath, JSON.stringify({ title: name, pages: ["index"] }, null, 2) + "\n")
  }

  console.log(`[add-project] ✓ Created project '${name}'`)
  console.log(``)
  console.log(`  Config:     ${configPath}`)
  console.log(`  Docs root:  ${docsDir}`)
  console.log(``)
  console.log(`Next steps:`)
  console.log(`  1. Edit ${configPath} — add page entries under "pages" with code_files + description.`)
  console.log(`     (Optionally add "facts_slice": [...] per page to narrow LLM context.)`)
  console.log(`  2. Run: pnpm facts:extract ${name}`)
  console.log(`     (Note: the current extractor targets Next.js + Drizzle. For other stacks,`)
  console.log(`      a per-stack extractor preset is needed — not yet implemented.)`)
  console.log(`  3. Edit ${indexMdxPath} — write the landing page by hand.`)
  console.log(`  4. For each structural page you want auto-generated:`)
  console.log(`        pnpm docs:rich ${name} <page-path>`)
  console.log(`  5. Link the project card on the docs landing page and sidebar meta if not yet listed.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
