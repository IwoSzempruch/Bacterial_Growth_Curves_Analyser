// Utility script: reports an unknown input file to GitHub by
// 1) uploading the sample file to a branch
// 2) adding a stub parser file (not wired into the registry)
// 3) opening an issue and PR referencing the branch
//
// Usage: node tools/unknown-file-workflow.js owner/repo path/to/file [branchName]
// Requires: env GITHUB_TOKEN with repo scope.
import fs from 'fs/promises'
import path from 'path'

const token = process.env.GITHUB_TOKEN
const repoArg = process.argv[2] || process.env.GITHUB_REPO
const fileArg = process.argv[3]
const branchArg = process.argv[4]

if (!token) {
  console.error('GITHUB_TOKEN is required (with repo scope)')
  process.exit(1)
}
if (!repoArg || !fileArg) {
  console.error('Usage: node tools/unknown-file-workflow.js owner/repo path/to/file [branchName]')
  process.exit(1)
}

const [owner, repo] = repoArg.split('/')
if (!owner || !repo) {
  console.error('Invalid repo format, expected owner/repo')
  process.exit(1)
}

const apiBase = 'https://api.github.com'
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'bgc-unknown-file-reporter',
}

async function gh(pathname, init = {}) {
  const res = await fetch(`${apiBase}${pathname}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${pathname} failed (${res.status}): ${text || res.statusText}`)
  }
  return res
}

const sampleFilePath = path.resolve(fileArg)
const sampleBuffer = await fs.readFile(sampleFilePath)
const sampleName = path.basename(sampleFilePath)

const repoInfo = await (await gh(`/repos/${owner}/${repo}`)).json()
const defaultBranch = repoInfo.default_branch
const baseRef = await (await gh(`/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`)).json()
const baseSha = baseRef.object.sha

const branchName = branchArg || `auto/unknown-format-${Date.now()}`
try {
  await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
  })
  console.log(`Created branch ${branchName}`)
} catch (err) {
  if (String(err).includes('Reference already exists')) {
    console.log(`Branch ${branchName} already exists, reusing`)
  } else {
    throw err
  }
}

// 1) Upload raw sample file for reference
const samplePathInRepo = `unknown-input-samples/${sampleName}`
await gh(`/repos/${owner}/${repo}/contents/${samplePathInRepo}`, {
  method: 'PUT',
  body: JSON.stringify({
    message: `chore: add unknown input sample ${sampleName}`,
    content: sampleBuffer.toString('base64'),
    branch: branchName,
  }),
})
console.log(`Uploaded sample to ${samplePathInRepo}`)

// 2) Add stub parser to speed up manual implementation (not registered automatically)
const safeId = sampleName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')
const parserName = `Unknown_${safeId || 'Sample'}`
const parserContent = `// Auto-generated placeholder for ${sampleName}\n` +
`// Fill in detect/parse and add to src/modules/input_files_converter/index.ts registry.\n` +
`import type { Parser } from './BaseParser'\n\n` +
`const ${parserName}: Parser = {\n` +
`  id: '${parserName.toLowerCase()}',\n` +
`  label: 'Unknown (${sampleName})',\n` +
`  detect: (text, filename) => filename.toLowerCase() === '${sampleName.toLowerCase()}', // TODO: implement detection\n` +
`  parse: async () => ({ ok: false, error: 'Parser not implemented yet' }),\n` +
`}\n\nexport default ${parserName}\n`

await gh(`/repos/${owner}/${repo}/contents/src/modules/input_files_converter/parsers/${parserName}.ts`, {
  method: 'PUT',
  body: JSON.stringify({
    message: `chore: add stub parser for ${sampleName}`,
    content: Buffer.from(parserContent, 'utf8').toString('base64'),
    branch: branchName,
  }),
})
console.log(`Added stub parser src/modules/input_files_converter/parsers/${parserName}.ts`)

// 3) Create issue and PR
const issue = await (await gh(`/repos/${owner}/${repo}/issues`, {
  method: 'POST',
  body: JSON.stringify({
    title: `Add support for ${sampleName}`,
    body: [
      `Unknown input format detected for file **${sampleName}**.`,
      '',
      '- Sample file stored at: `' + samplePathInRepo + '`',
      '- Stub parser created: `' + parserName + '.ts` (not wired into registry)',
      '',
      'Next steps:',
      '1. Inspect sample and implement detect/parse.',
      '2. Add the parser to registry in src/modules/input_files_converter/index.ts.',
      '3. Add tests/fixtures if needed.',
    ].join('\n'),
  }),
})).json()
console.log(`Issue created: ${issue.html_url}`)

const pr = await (await gh(`/repos/${owner}/${repo}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: `Add stub parser for ${sampleName}`,
    head: branchName,
    base: defaultBranch,
    body: `Auto-generated stub parser for **${sampleName}**.\n\nIssue: ${issue.html_url}`,
  }),
})).json()
console.log(`PR created: ${pr.html_url}`)
