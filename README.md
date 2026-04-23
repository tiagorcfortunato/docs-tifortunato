# Tiago Fortunato — docs

Personal documentation site at [blog.tifortunato.com](https://blog.tifortunato.com).

Built with [Fumadocs](https://fumadocs.vercel.app/) on Next.js 16 + MDX + Tailwind v4.

## Scripts

- `pnpm dev` — dev server on port 3000
- `pnpm build` — production build
- `pnpm docs:generate <project> <page>` — generate a docs page from code + deep-dive
- `pnpm docs:audit <project> <page>` — report doc/code drift for one page
- `pnpm docs:batch <project>` — generate all placeholder pages in a project
- `pnpm docs:sync <project>` — audit all pages affected by recent code changes

## Environment

Requires `.env.local` with at least one of:

- `GROQ_API_KEY` — Groq (Llama 3.3 70B, fast, 100k tokens/day free)
- `GEMINI_API_KEY` — Google Gemini 2.5 Flash (1M tokens/day free)
- `OPENAI_API_KEY` — OpenAI (optional fallback)

Fallback order: Gemini → Groq → OpenAI.
