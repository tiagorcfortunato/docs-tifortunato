import { readFileSync, existsSync, readdirSync } from "fs"
import { join } from "path"

export type PageConfig = {
  code_files: string[]
  deep_dive_sections: string[]
  description: string
  /** If true, docs:rich refuses to regenerate this page. Use for hand-authored content. */
  no_regen?: boolean
  /** Top-level keys of the facts manifest to include. If omitted, the whole manifest is passed. */
  facts_slice?: string[]
}

export type ProjectConfig = {
  repo_path: string
  docs_root: string
  deep_dive_path: string
  pages: Record<string, PageConfig>
  /** Optional tone/voice overrides per project (path relative to repo root). */
  style_guide?: string
}

export type Mapping = Record<string, ProjectConfig>

/**
 * Loads every project config under projects/<name>/config.json.
 * Falls back to legacy scripts/mapping.json if no projects/ dir exists yet.
 */
export function loadMapping(): Mapping {
  if (existsSync("projects")) {
    const mapping: Mapping = {}
    for (const name of readdirSync("projects")) {
      const path = join("projects", name, "config.json")
      if (existsSync(path)) {
        mapping[name] = JSON.parse(readFileSync(path, "utf-8"))
      }
    }
    if (Object.keys(mapping).length > 0) return mapping
  }
  const raw = readFileSync("scripts/mapping.json", "utf-8")
  return JSON.parse(raw)
}

export function getProject(mapping: Mapping, projectKey: string): ProjectConfig {
  const p = mapping[projectKey]
  if (!p) throw new Error(`Unknown project: ${projectKey}. Known: ${Object.keys(mapping).join(", ") || "(none)"}`)
  return p
}

export function getPage(project: ProjectConfig, pagePath: string): PageConfig {
  const p = project.pages[pagePath]
  if (!p) throw new Error(`Unknown page: ${pagePath}`)
  return p
}

export function resolveCodePath(project: ProjectConfig, codeFile: string): string {
  return join(project.repo_path, codeFile)
}

export function resolveDocPath(project: ProjectConfig, pagePath: string): string {
  return join(project.docs_root, pagePath)
}
