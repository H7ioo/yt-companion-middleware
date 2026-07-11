#!/usr/bin/env node
// @ts-check
// Bumps the Companion module version in BOTH package.json and companion/manifest.json in lockstep.
// Companion identifies a module (and whether a re-import is "new") by the MANIFEST version, so the
// two must never drift. Run this on every change that you want Companion to pick up as a new build.
//
// Usage (from repo root): npm run companion:bump [patch|minor|major|x.y.z]   (default: patch)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgPath = resolve(here, '../package.json')
const manifestPath = resolve(here, '../companion/manifest.json')

/**
 * Computes the next semver from the current one. `kind` is a bump level (patch/minor/major) or an
 * explicit `x.y.z` string, which is returned verbatim.
 * @param {string} current
 * @param {string} kind
 * @returns {string}
 */
function nextVersion(current, kind) {
	if (/^\d+\.\d+\.\d+$/.test(kind)) return kind // explicit x.y.z
	const [maj, min, pat] = current.split('.').map((n) => Number.parseInt(n, 10))
	if ([maj, min, pat].some((n) => Number.isNaN(n))) throw new Error(`current version "${current}" is not x.y.z`)
	switch (kind) {
		case 'major':
			return `${maj + 1}.0.0`
		case 'minor':
			return `${maj}.${min + 1}.0`
		case 'patch':
			return `${maj}.${min}.${pat + 1}`
		default:
			throw new Error(`unknown bump "${kind}" — use patch | minor | major | x.y.z`)
	}
}

const kind = process.argv[2] ?? 'patch'
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const from = pkg.version
const to = nextVersion(from, kind)

pkg.version = to
manifest.version = to
// Preserve each file's existing indentation: package.json = 2 spaces, manifest.json = tabs.
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`)

console.log(`companion module version ${from} → ${to}`)
console.log('next: npm run companion:package   then re-import the .tgz in Companion')
