import { Buffer } from 'buffer'

// @solana/spl-token uses Buffer in browser code. Vite does not inject Node
// globals, so expose the browser-compatible implementation explicitly.
const browser = globalThis as typeof globalThis & { Buffer: typeof Buffer }
browser.Buffer = Buffer
