/**
 * Helper to report unknown/unsupported input files to an external endpoint
 * (e.g. a small service that will open a GitHub issue). This is intentionally
 * simple and expects the backend to handle authentication and persistence.
 *
 * For privacy: call sites must ask the user for consent before invoking this.
 */
export interface UnknownFileMeta {
  source?: 'input-files-converter' | string
  message?: string
}

export interface UnknownFileReportResponse {
  issueUrl?: string
  pullRequestUrl?: string
  storedAs?: string
}

async function toBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.byteLength; i += 1) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

/**
 * Sends a file payload to the configured endpoint. The endpoint should be set in
 * VITE_UNKNOWN_FILE_ENDPOINT and must accept JSON with base64 content.
 */
export async function reportUnknownFile(file: File, meta: UnknownFileMeta = {}): Promise<UnknownFileReportResponse> {
  const endpoint = import.meta.env.VITE_UNKNOWN_FILE_ENDPOINT
  if (!endpoint) {
    // Local/test mode: endpoint not configured, skip network call.
    return { storedAs: 'local-test-no-endpoint' }
  }

  const payload = {
    filename: file.name,
    size: file.size,
    type: file.type || 'application/octet-stream',
    contentBase64: await toBase64(file),
    meta,
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Unknown file report failed (${res.status}): ${text || res.statusText}`)
  }

  try {
    return (await res.json()) as UnknownFileReportResponse
  } catch {
    return {}
  }
}
