// tools/apply-updates.mjs
// Applies JSON-described edits to your codebase.
// Usage (locally/GitHub Action): node tools/apply-updates.mjs updates/your-update.json
import fs from 'node:fs'
import path from 'node:path'

function asRegex(pattern, isLiteral) {
  if (isLiteral) return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const m = /^\/([\s\S]+)\/([a-z]*)$/.exec(pattern)
  if (m) return new RegExp(m[1], m[2])
  return new RegExp(pattern, 'g')
}

function backupFile(p) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${p}.bak.${ts}`
  fs.copyFileSync(p, backup)
  return backup
}

function applyOps(filePath, ops) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing file: ${filePath}`)
  let content = fs.readFileSync(filePath, 'utf-8')
  const backup = backupFile(filePath)
  let changed = false

  for (const op of ops) {
    if (op.op === 'append') { content += (content.endsWith('\n')?'':'\n') + op.text + '\n'; changed = true; continue }
    if (op.op === 'prepend') { content = op.text + '\n' + content; changed = true; continue }
    if (op.op === 'replace' || op.op === 'replaceAll') {
      const rx = asRegex(op.find, !!op.literal)
      const before = content
      content = content.replace(rx, op.replace)
      if (content !== before) changed = true
      else console.warn(`WARN: no match for ${op.op} in ${filePath}:`, op.find)
      continue
    }
    if (op.op === 'insertAfter' || op.op === 'insertBefore') {
      const rx = asRegex(op.anchor, !!op.literal)
      const m = rx.exec(content)
      if (!m) { console.warn(`WARN: anchor not found in ${filePath}:`, op.anchor); continue }
      const idx = m.index + (op.op === 'insertAfter' ? m[0].length : 0)
      content = content.slice(0, idx) + op.text + content.slice(idx)
      changed = true
      continue
    }
    throw new Error(`Unknown op: ${op.op}`)
  }

  if (changed) fs.writeFileSync(filePath, content)
  console.log(`Updated: ${filePath} (backup created: ${path.basename(backup)})`)
}

(function main(){
  const specPath = process.argv[2]
  if (!specPath) { console.error('Usage: node tools/apply-updates.mjs <updates.json>'); process.exit(1) }
  const json = JSON.parse(fs.readFileSync(specPath, 'utf-8'))
  const root = process.cwd()
  const entries = Object.entries(json.files || {})
  if (entries.length === 0) { console.error('No files specified in updates JSON.'); process.exit(1) }
  for (const [rel, ops] of entries) applyOps(path.join(root, rel), ops)
  console.log('✔ All updates applied.')
})();
