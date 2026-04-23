import Groq from "groq-sdk"
import { config } from "dotenv"

config({ path: ".env.local" })

if (!process.env.GROQ_API_KEY) {
  throw new Error("GROQ_API_KEY missing in .env.local")
}

export const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function callGroq(
  systemPrompt: string,
  userPrompt: string,
  opts: { jsonMode?: boolean; maxTokens?: number } = {}
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0,
    max_tokens: opts.maxTokens ?? 4000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  })
  return response.choices[0]?.message?.content ?? ""
}
