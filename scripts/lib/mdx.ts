import { readFileSync, writeFileSync, existsSync } from "fs"

export function readFile(path: string): string {
  if (!existsSync(path)) {
    return `[FILE NOT FOUND: ${path}]`
  }
  try {
    return readFileSync(path, "utf-8")
  } catch (err) {
    return `[ERROR READING ${path}: ${(err as Error).message}]`
  }
}

export function writeFile(path: string, content: string): void {
  writeFileSync(path, content, "utf-8")
}

export function extractDeepDiveSection(fullText: string, sectionTitles: string[]): string {
  if (sectionTitles.length === 0) return fullText.slice(0, 6000)

  const sections: string[] = []
  const lines = fullText.split("\n")
  let currentSection: string[] = []
  let currentTitle = ""
  let capturing = false

  for (const line of lines) {
    const headingMatch = line.match(/^(#+)\s+(.+)$/)
    if (headingMatch) {
      if (capturing) {
        sections.push(currentSection.join("\n"))
        currentSection = []
      }
      currentTitle = headingMatch[2].trim()
      capturing = sectionTitles.some(t => currentTitle.includes(t) || t.includes(currentTitle))
      if (capturing) currentSection.push(line)
    } else if (capturing) {
      currentSection.push(line)
    }
  }
  if (capturing && currentSection.length > 0) {
    sections.push(currentSection.join("\n"))
  }
  const combined = sections.join("\n\n---\n\n")
  return combined || fullText.slice(0, 6000)
}

export function readSystemPrompt(): string {
  return readFile("scripts/style-guide.md")
}
