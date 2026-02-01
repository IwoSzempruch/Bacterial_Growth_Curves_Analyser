// Script: generate parser code for an unknown input file using OpenAI ChatGPT API.
// Usage: node tools/unknown-file-coder.js path/to/sample.ext [outFile]
// Requires: env OPENAI_API_KEY (and optionally OPENAI_BASE_URL, OPENAI_MODEL).
// Notes: This does NOT auto-commit or open PR; it only generates parser code (TS).
// Review output before adding to src/modules/input_files_converter/parsers and registry.

import fs from 'fs/promises'
import path from 'path'

async function main() {
  const samplePath = process.argv[2]
  const outFile = process.argv[3]
  if (!samplePath) {
    console.error('Usage: node tools/unknown-file-coder.js path/to/sample.ext [outFile]')
    process.exit(1)
  }

  // For local testing you can hardcode a default here.
  // In production/CI use env OPENAI_API_KEY.
  const apiKey = process.env.OPENAI_API_KEY || '' // <-- wstaw klucz lub zostaw pusty i użyj zmiennej środowiskowej
  if (!apiKey) {
    console.error('Missing OPENAI_API_KEY')
    process.exit(1)
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const abs = path.resolve(samplePath)
  const data = await fs.readFile(abs)
  const stat = await fs.stat(abs)
  const ext = path.extname(abs).toLowerCase()
  const name = path.basename(abs)

  // Truncate to avoid giant prompts; send first/last slice as text or base64 fallback.
  const maxPreview = 4000
  let preview = ''
  let contentNote = ''
  try {
    const asText = data.toString('utf8')
    preview = asText.slice(0, maxPreview)
    if (asText.length > maxPreview) {
      preview += `\n...<truncated ${asText.length - maxPreview} chars>`
    }
    contentNote = 'text'
  } catch {
    preview = data.toString('base64').slice(0, maxPreview)
    contentNote = 'base64 (truncated)'
  }

  const systemPrompt = `
You are an expert TypeScript engineer working on the Bacterial Growth Curves webapp.
Goal: produce a new parser implementing the Parser interface in src/modules/input_files_converter/parsers/BaseParser.ts.
Return ONLY the full TypeScript source file content (no markdown, no explanations).
Constraints:
- Follow existing parser style (see ClariostarXlsx, TimeSeriesWideCSV, WellTimeLongCSV).
- Implement detect(text, filename): boolean to identify the format reliably (use extension hints + content heuristics).
- Implement parse(content, filename): produce { ok: true, dataset } or { ok: false, error, warnings? } using project types.
- parserId/prefix: use a short id derived from format name; label should be human-friendly.
- Convert data into UnifiedDataset rows (timeSeconds, well, value, measurementType etc.).
- Do not import heavy libs; stick to built-ins already used in parsers.
- Include parsing of header/columns as needed; handle common pitfalls (comma/semicolon, decimal separators).
- Add warnings instead of throwing when possible (e.g., skipped rows).
- Do not register the parser here; user will add it to registry in src/modules/input_files_converter/index.ts.
`

  const userPrompt = `
Filename: ${name}
Extension: ${ext || '(none)'}
Size: ${stat.size} bytes
Preview (${contentNote}):\n${preview}

Please infer the format and produce the parser file content.
`

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt.trim() },
      { role: 'user', content: userPrompt.trim() },
    ],
    temperature: 0.2,
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI API failed (${res.status}): ${errText || res.statusText}`)
  }
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('No content returned from model')
  }

  if (outFile) {
    await fs.writeFile(path.resolve(outFile), content, 'utf8')
    console.log(`Parser saved to ${outFile}`)
  } else {
    console.log(content)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
