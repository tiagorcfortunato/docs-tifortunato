# Docs style guide

## Voice
- Senior engineer writing for other senior engineers
- Concrete, factual, no marketing fluff
- Every claim is verifiable from code or deep-dive; if uncertain, say "assume" or "flag"
- Honest about known gaps — don't hide trade-offs, call them out in "Known gaps" or "honest flag" sections

## Structure conventions
- YAML frontmatter: `title` and `description` required
- H1 matches the `title`
- Opening paragraph states what the page covers in plain language
- H2 sections for major topics
- H3 sections for sub-topics
- Final "Why this shape" section explains design intent (not always required but strong pattern)
- When applicable: "Known gaps" or "honest flag" section listing trade-offs

## Content rules
- Reference specific file paths (e.g. `src/lib/ratelimit.ts:14`) where useful
- Use backticks for identifiers (function names, env vars, config values)
- Use fenced code blocks with language tags for multi-line code
- Prefer tables for enum-like data (plans, events, settings)
- Never invent facts; if the deep-dive and code diverge, flag it

## What NOT to do
- Don't use "simply" or "just" — condescending
- Don't promise what isn't built ("will support X soon")
- Don't claim performance numbers that aren't measured
- Don't write marketing copy ("best", "amazing", "powerful")
- Don't use the word "atomic" unless it's inside a real DB transaction
