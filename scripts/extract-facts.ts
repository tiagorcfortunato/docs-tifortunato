import { Project } from "ts-morph"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { loadMapping, getProject } from "./lib/mapping"

async function main() {
  const [, , projectKey] = process.argv
  if (!projectKey) {
    console.error("Usage: pnpm facts:extract <project>")
    process.exit(1)
  }

  const mapping = loadMapping()
  const project = getProject(mapping, projectKey)
  const repoPath = project.repo_path

  console.log(`[facts] Extracting from: ${repoPath}`)

  const proj = new Project({
    tsConfigFilePath: join(repoPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  })

  const facts: Record<string, any> = {
    extracted_at: new Date().toISOString(),
    source_repo: repoPath,
  }

  // ========== SCHEMA ==========
  const schemaFile = proj.getSourceFile(join(repoPath, "src/lib/db/schema.ts"))
  if (schemaFile) {
    const tables: any[] = []
    for (const varDecl of schemaFile.getVariableDeclarations()) {
      const init = varDecl.getInitializer()
      if (!init) continue
      const initText = init.getText()
      if (!initText.startsWith("pgTable(")) continue

      const varName = varDecl.getName()
      const sqlName = initText.match(/pgTable\(\s*"([^"]+)"/)?.[1] ?? varName

      // Extract column block
      const colsMatch = initText.match(/pgTable\([^,]+,\s*\{([\s\S]+?)\}\s*(?:,\s*\(.+?\)\s*=>\s*\(.+?\))?\s*\)/)
      const columnBlock = colsMatch?.[1] ?? ""

      // Parse each column line
      const columns: any[] = []
      const colLines = columnBlock.split(/,\s*\n/).filter(l => /^\s*\w+:/.test(l))
      for (const line of colLines) {
        const nameMatch = line.match(/^\s*(\w+):/)
        if (!nameMatch) continue
        const name = nameMatch[1]
        const typeMatch = line.match(/:\s*(\w+)\s*\(/)
        const type = typeMatch?.[1] ?? "unknown"
        const nullable = !line.includes(".notNull()")
        const unique = line.includes(".unique()")
        const primaryKey = line.includes(".primaryKey()")
        const hasDefault = /\.default\(|\.defaultNow\(|\.defaultRandom\(/.test(line)
        const hasReference = line.includes(".references(")
        const hasOnDeleteCascade = line.includes('onDelete: "cascade"')

        columns.push({
          name,
          type,
          nullable,
          unique,
          primaryKey,
          hasDefault,
          hasReference,
          hasOnDeleteCascade,
        })
      }

      tables.push({
        varName,
        sqlName,
        columnCount: columns.length,
        columns,
      })
    }

    facts.schema = {
      tableCount: tables.length,
      tables,
    }
  }

  // ========== API ROUTES ==========
  const routeFiles = proj.getSourceFiles().filter(sf => {
    const p = sf.getFilePath()
    return p.startsWith(join(repoPath, "src/app/api")) && sf.getBaseName() === "route.ts"
  })

  facts.apiRoutes = {
    count: routeFiles.length,
    routes: routeFiles.map(rf => {
      const relPath = rf.getFilePath()
        .replace(repoPath, "")
        .replace("/src/app", "")
        .replace("/route.ts", "")
      const methods: string[] = []
      for (const m of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
        if (rf.getExportedDeclarations().has(m)) methods.push(m)
      }
      return { path: relPath, methods }
    }),
  }

  // ========== VERCEL CRON ==========
  const vercelJsonPath = join(repoPath, "vercel.json")
  if (existsSync(vercelJsonPath)) {
    const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, "utf-8"))
    facts.cron = vercelConfig.crons ?? []
  }

  // ========== PLANS ==========
  const plansFile = proj.getSourceFile(join(repoPath, "src/lib/stripe/plans.ts"))
  if (plansFile) {
    const text = plansFile.getText()
    const plans: Record<string, any> = {}
    for (const name of ["free", "basic", "pro", "premium"]) {
      const re = new RegExp(`${name}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`, "m")
      const m = text.match(re)
      if (!m) continue
      const block = m[1]
      const price = Number(block.match(/price:\s*(\d+)/)?.[1] ?? 0)
      const priceIdEnvVar = block.match(/process\.env\.(\w+PRICE_ID)/)?.[1] ?? null
      const limits: Record<string, any> = {}
      const limitsBlock = block.match(/limits:\s*\{([^}]+)\}/)?.[1] ?? ""
      for (const pair of limitsBlock.split(",").map(s => s.trim()).filter(Boolean)) {
        const [k, v] = pair.split(":").map(s => s.trim())
        if (k && v) limits[k] = v === "Infinity" ? "Infinity" : Number(v) || v.replace(/['"]/g, "")
      }
      plans[name] = { price, priceIdEnvVar, limits }
    }
    facts.plans = plans
  }

  // ========== MCP TOOLS ==========
  // mcp-server/ is a separate TS sub-project — read with fs instead of proj.getSourceFile
  const mcpToolsPath = join(repoPath, "mcp-server/src/tools.ts")
  if (existsSync(mcpToolsPath)) {
    const text = readFileSync(mcpToolsPath, "utf-8")
    const toolNames = Array.from(text.matchAll(/name:\s*"(\w+)"/g)).map(m => m[1])
    facts.mcp = {
      toolCount: toolNames.length,
      tools: toolNames,
    }
  }

  // ========== RATE LIMITS ==========
  const ratelimitFile = proj.getSourceFile(join(repoPath, "src/lib/ratelimit.ts"))
  if (ratelimitFile) {
    const text = ratelimitFile.getText()
    const limiters: Record<string, any> = {}
    // Match: export function getXxxLimiter() {...Ratelimit.slidingWindow(N, "window")..., prefix: "yyy"...}
    const fnMatches = Array.from(text.matchAll(/export\s+function\s+get(\w+)Limiter[\s\S]*?slidingWindow\(\s*(\d+)\s*,\s*"([^"]+)"\s*\)[\s\S]*?prefix:\s*"([^"]+)"/g))
    for (const m of fnMatches) {
      const [, name, limit, window, prefix] = m
      limiters[name.toLowerCase()] = {
        limit: Number(limit),
        window,
        prefix,
      }
    }
    facts.rateLimits = limiters
  }

  // ========== STRIPE WEBHOOK EVENTS ==========
  const webhookFile = proj.getSourceFile(join(repoPath, "src/app/api/stripe/webhook/route.ts"))
  if (webhookFile) {
    const text = webhookFile.getText()
    const events = Array.from(text.matchAll(/event\.type\s*===\s*"([^"]+)"/g)).map(m => m[1])
    facts.stripeWebhookEvents = events
  }

  // ========== PACKAGE.JSON ==========
  const pkgPath = join(repoPath, "package.json")
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
    facts.pkg = {
      name: pkg.name,
      version: pkg.version,
      next: pkg.dependencies?.next,
      react: pkg.dependencies?.react,
      drizzle: pkg.dependencies?.["drizzle-orm"],
      supabase: pkg.dependencies?.["@supabase/supabase-js"],
      stripe: pkg.dependencies?.stripe,
      groqSdk: pkg.dependencies?.["groq-sdk"],
      // Counts
      depCount: Object.keys(pkg.dependencies ?? {}).length,
      devDepCount: Object.keys(pkg.devDependencies ?? {}).length,
    }
  }

  // ========== WHATSAPP MESSAGE TEMPLATES ==========
  const whatsappFile = proj.getSourceFile(join(repoPath, "src/lib/whatsapp.ts"))
  if (whatsappFile) {
    const text = whatsappFile.getText()
    const msgFns = Array.from(text.matchAll(/export\s+(?:function|const)\s+(msg\w+)/g)).map(m => m[1])
    facts.whatsapp = {
      messageTemplateCount: msgFns.length,
      templates: msgFns,
    }
  }

  // Write output
  const outDir = "facts"
  if (!existsSync(outDir)) mkdirSync(outDir)
  const outPath = join(outDir, `${projectKey}-facts.json`)
  writeFileSync(outPath, JSON.stringify(facts, null, 2))

  // Summary
  console.log(`\n[facts] Written to ${outPath}`)
  console.log(`[facts] ===== SUMMARY =====`)
  console.log(`[facts] Schema tables:        ${facts.schema?.tableCount ?? "N/A"}`)
  console.log(`[facts] API routes:           ${facts.apiRoutes?.count ?? "N/A"}`)
  console.log(`[facts] Cron schedules:       ${facts.cron?.length ?? "N/A"}`)
  console.log(`[facts] Plans:                ${Object.keys(facts.plans ?? {}).length}`)
  console.log(`[facts] MCP tools:            ${facts.mcp?.toolCount ?? "N/A"}`)
  console.log(`[facts] Rate limiters:        ${Object.keys(facts.rateLimits ?? {}).length}`)
  console.log(`[facts] Stripe events:        ${facts.stripeWebhookEvents?.length ?? "N/A"}`)
  console.log(`[facts] WhatsApp templates:   ${facts.whatsapp?.messageTemplateCount ?? "N/A"}`)
  console.log(`[facts] =====================`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
