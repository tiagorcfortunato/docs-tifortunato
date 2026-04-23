import { readFileSync } from "fs"
import { join } from "path"

export type PageConfig = {
  code_files: string[]
  deep_dive_sections: string[]
  description: string
}

export type ProjectConfig = {
  repo_path: string
  docs_root: string
  deep_dive_path: string
  pages: Record<string, PageConfig>
}

export type Mapping = Record<string, ProjectConfig>

export function loadMapping(): Mapping {
  const raw = readFileSync("scripts/mapping.json", "utf-8")
  return JSON.parse(raw)
}

export function getProject(mapping: Mapping, projectKey: string): ProjectConfig {
  const p = mapping[projectKey]
  if (!p) throw new Error(`Unknown project: ${projectKey}`)
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
