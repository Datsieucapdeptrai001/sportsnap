import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.resolve(__dirname, '..', 'e2e-report')

export default async function globalSetup(): Promise<void> {
  await fs.mkdir(REPORT_DIR, { recursive: true })

  // Remove existing results.json and old screenshots before test run
  try {
    const files = await fs.readdir(REPORT_DIR)
    for (const f of files) {
      if (f.endsWith('.png') || f === 'results.json') {
        await fs.rm(path.join(REPORT_DIR, f), { force: true })
      }
    }
  } catch {
    // Ignore if directory cannot be read
  }

  // Set unified runId for this test session
  process.env.SPORTSNAP_E2E_RUN_ID = new Date().toISOString()
}
