import Groq from "groq-sdk"
import { GoogleGenAI } from "@google/genai"
import OpenAI from "openai"
import Cerebras from "@cerebras/cerebras_cloud_sdk"
import { config } from "dotenv"

config({ path: ".env.local" })

type Provider = {
  name: string
  enabled: boolean
  call: (system: string, user: string, opts: CallOpts) => Promise<string>
}

type CallOpts = {
  jsonMode?: boolean
  maxTokens?: number
}

// ---------- Groq ----------
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null

const groqProvider: Provider = {
  name: "groq",
  enabled: !!groq,
  async call(system, user, opts) {
    if (!groq) throw new Error("Groq not configured")
    const resp = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    })
    return resp.choices[0]?.message?.content ?? ""
  },
}

// ---------- Gemini ----------
const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
const gemini = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null

const geminiProvider: Provider = {
  name: "gemini",
  enabled: !!gemini,
  async call(system, user, opts) {
    if (!gemini) throw new Error("Gemini not configured")
    const resp = await gemini.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: user }] }],
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: opts.maxTokens ?? 4000,
        ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    })
    return resp.text ?? ""
  },
}

// ---------- Cerebras ----------
const cerebras = process.env.CEREBRAS_API_KEY
  ? new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY })
  : null

const cerebrasProvider: Provider = {
  name: "cerebras",
  enabled: !!cerebras,
  async call(system, user, opts) {
    if (!cerebras) throw new Error("Cerebras not configured")
    const resp = await cerebras.chat.completions.create({
      model: "qwen-3-235b-a22b-instruct-2507",
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    })
    return (resp.choices as any)?.[0]?.message?.content ?? ""
  },
}

// ---------- OpenAI (optional) ----------
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null

const openaiProvider: Provider = {
  name: "openai",
  enabled: !!openai,
  async call(system, user, opts) {
    if (!openai) throw new Error("OpenAI not configured")
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: opts.maxTokens ?? 4000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    })
    return resp.choices[0]?.message?.content ?? ""
  },
}

// ---------- Chain with fallback ----------
// For audit: speed matters, Gemini is best (fast, structured JSON)
const CHAIN: Provider[] = [geminiProvider, groqProvider, cerebrasProvider, openaiProvider]

// For generation: factual accuracy matters, Qwen 3 235B (Cerebras) primary
const GENERATION_CHAIN: Provider[] = [cerebrasProvider, geminiProvider, groqProvider, openaiProvider]

function isQuotaError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? ""
  return (
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("limit exceeded") ||
    msg.includes("tpd") ||
    msg.includes("tpm") ||
    msg.includes("429")
  )
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  opts: CallOpts = {}
): Promise<string> {
  const enabled = CHAIN.filter(p => p.enabled)
  if (enabled.length === 0) {
    throw new Error("No LLM provider configured. Set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in .env.local.")
  }

  let lastError: unknown
  for (const provider of enabled) {
    try {
      console.log(`[llm] Trying ${provider.name}...`)
      const result = await provider.call(systemPrompt, userPrompt, opts)
      if (!result || result.length < 10) {
        throw new Error(`${provider.name} returned empty/short response`)
      }
      console.log(`[llm] ✓ ${provider.name} succeeded`)
      return result
    } catch (err) {
      lastError = err
      const quota = isQuotaError(err)
      console.error(`[llm] ✗ ${provider.name} failed${quota ? " (quota)" : ""}: ${(err as Error).message?.slice(0, 120)}`)
      if (!quota) {
        // Non-quota error — still try next provider, but log clearly
        console.error(`[llm] Non-quota error — continuing to next provider anyway`)
      }
    }
  }

  throw new Error(`All ${enabled.length} providers exhausted. Last error: ${(lastError as Error)?.message}`)
}

export async function callLLMForGeneration(
  systemPrompt: string,
  userPrompt: string,
  opts: CallOpts = {}
): Promise<string> {
  const enabled = GENERATION_CHAIN.filter(p => p.enabled)
  if (enabled.length === 0) {
    throw new Error("No LLM provider configured for generation.")
  }
  let lastError: unknown
  for (const provider of enabled) {
    try {
      console.log(`[llm:gen] Trying ${provider.name}...`)
      const result = await provider.call(systemPrompt, userPrompt, opts)
      if (!result || result.length < 10) {
        throw new Error(`${provider.name} returned empty/short response`)
      }
      console.log(`[llm:gen] ✓ ${provider.name} succeeded`)
      return result
    } catch (err) {
      lastError = err
      const quota = isQuotaError(err)
      console.error(`[llm:gen] ✗ ${provider.name} failed${quota ? " (quota)" : ""}: ${(err as Error).message?.slice(0, 120)}`)
    }
  }
  throw new Error(`All generation providers exhausted. Last: ${(lastError as Error)?.message}`)
}
