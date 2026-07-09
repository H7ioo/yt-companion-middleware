#!/usr/bin/env node
// Preflight guard: package.json and companion/manifest.json MUST declare the same version. Runs
// automatically before `npm run package` (as prepackage) so a drifted build can never ship — a
// mismatch is what makes Companion re-import inconsistently.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(resolve(here, '../companion/manifest.json'), 'utf8'))

if (pkg.version !== manifest.version) {
	console.error(
		`✗ version mismatch: package.json ${pkg.version} != manifest.json ${manifest.version}\n` +
			`  run "npm run companion:bump" so both move together.`,
	)
	process.exit(1)
}
console.log(`✓ companion module version ${pkg.version} (package.json and manifest.json in sync)`)
