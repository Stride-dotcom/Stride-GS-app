import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import os from 'os'
import path from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

function resolveBuildVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (sha) return sha
  } catch {
    // not a git tree or git unavailable — fall through to timestamp
  }
  return String(Date.now())
}

// Emits dist/version.json on every build. The running bundle reads its own
// version from the __APP_VERSION__ define below; the polling hook fetches
// /version.json to detect when the server has a newer one.
function versionJsonPlugin(version: string, buildTime: string): Plugin {
  return {
    name: 'stride-version-json',
    apply: 'build',
    closeBundle() {
      const out = resolve(__dirname, 'dist', 'version.json')
      writeFileSync(out, JSON.stringify({ version, buildTime }) + '\n', 'utf8')
    },
  }
}

const APP_VERSION = resolveBuildVersion()
const BUILD_TIME = new Date().toISOString()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionJsonPlugin(APP_VERSION, BUILD_TIME)],
  base: '/',
  cacheDir: path.join(os.tmpdir(), 'vite-stride-gs-app'),
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
})
