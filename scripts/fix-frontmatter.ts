import { readdirSync, readFileSync, writeFileSync, statSync } from "fs"
import { join } from "path"

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith(".mdx")) out.push(p)
  }
  return out
}

function needsQuoting(value: string): boolean {
  if (value.startsWith('"') || value.startsWith("'")) return false
  return /:\s|[#&*!|>%@`?\[\]{}]/.test(value)
}

function sanitizeFrontmatter(content: string): { content: string; changed: boolean; reason: string } {
  if (!content.startsWith("---\n")) return { content, changed: false, reason: "" }
  const afterFirst = content.indexOf("\n---\n", 4)

  // Missing closing fence: insert one before the first H1 or blank line
  if (afterFirst === -1) {
    const h1 = content.search(/\n#\s/)
    if (h1 === -1) return { content, changed: false, reason: "no closing fence and no H1" }
    const fm = content.slice(4, h1).trimEnd()
    const body = content.slice(h1)
    return {
      content: `---\n${fm}\n---\n${body}`,
      changed: true,
      reason: "added missing closing fence",
    }
  }

  const fmRaw = content.slice(4, afterFirst)
  const body = content.slice(afterFirst + 5)
  let changed = false
  const reasons: string[] = []
  const lines = fmRaw.split("\n").map(line => {
    const m = line.match(/^(\w+):\s*(.*)$/)
    if (!m) return line
    const [, key, value] = m
    if (!value) return line
    if (needsQuoting(value)) {
      const escaped = value.replace(/"/g, '\\"')
      changed = true
      reasons.push(`quoted ${key}`)
      return `${key}: "${escaped}"`
    }
    return line
  })
  if (!changed) return { content, changed: false, reason: "" }
  return {
    content: `---\n${lines.join("\n")}\n---\n${body}`,
    changed: true,
    reason: reasons.join(", "),
  }
}

function main() {
  const root = "content/docs"
  const files = walk(root)
  let fixed = 0
  for (const f of files) {
    const original = readFileSync(f, "utf-8")
    const { content, changed, reason } = sanitizeFrontmatter(original)
    if (changed) {
      writeFileSync(f, content, "utf-8")
      console.log(`[fix] ${f}: ${reason}`)
      fixed++
    }
  }
  console.log(`\n[fix] ${fixed}/${files.length} files sanitized`)
}

main()
