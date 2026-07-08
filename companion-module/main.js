import { InstanceBase, InstanceStatus, Regex, runEntrypoint } from '@companion-module/base'
import { joinUrl, mapVariables, toPng64 } from './src/transform.js'
import { UpgradeScripts } from './src/upgrades.js'

/**
 * Companion module for the YouTube Live Metadata Control middleware.
 *
 * Its reason to exist: Companion's Generic HTTP module can bind the Latin-safe `displayLabel`
 * text, but it has no way to put the middleware's Arabic title/slug PNGs onto a key. This module
 * adds two advanced feedbacks that return those PNGs via `png64`, plus variables and the action
 * bus — so an Arabic title shows correctly as an image instead of tofu boxes.
 *
 * It polls GET /api/feedback/active-preset (served from cache, zero YouTube quota) and never
 * calls YouTube directly.
 */
class YtMiddlewareInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.latest = {} // last polled /active-preset payload
		this.defineVariables()
		this.defineFeedbacks()
		this.defineActions()
		this.startPolling()
	}

	async destroy() {
		this.stopPolling()
	}

	async configUpdated(config) {
		this.config = config
		this.startPolling() // re-arm with the new url/interval
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'About',
				value:
					'Connects to the YouTube Live Metadata Control middleware. Point this at the same host that serves the dashboard. The slug/title image feedbacks render Arabic correctly on a key.',
			},
			{
				type: 'textinput',
				id: 'url',
				label: 'Middleware base URL',
				width: 8,
				default: 'http://localhost:8080',
				regex: Regex.SOMETHING,
			},
			{
				type: 'number',
				id: 'interval',
				label: 'Poll interval (seconds)',
				width: 4,
				default: 5,
				min: 1,
				max: 3600,
			},
			{
				type: 'textinput',
				id: 'token',
				label: 'Bearer token (optional — only if the action bus is protected)',
				width: 12,
				default: '',
			},
		]
	}

	// --- HTTP ---------------------------------------------------------------

	headers() {
		const h = { 'Content-Type': 'application/json' }
		if (this.config.token) h['Authorization'] = `Bearer ${this.config.token}`
		return h
	}

	startPolling() {
		this.stopPolling()
		const seconds = Math.min(3600, Math.max(1, Number(this.config.interval) || 5))
		this.poll() // immediate, so the key isn't blank for a whole interval
		this.pollTimer = setInterval(() => this.poll(), seconds * 1000)
	}

	stopPolling() {
		if (this.pollTimer) {
			clearInterval(this.pollTimer)
			this.pollTimer = undefined
		}
	}

	async poll() {
		try {
			const res = await fetch(joinUrl(this.config.url, '/api/feedback/active-preset'), {
				headers: this.headers(),
			})
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			this.latest = await res.json()
			this.updateStatus(InstanceStatus.Ok)
			this.setVariableValues(mapVariables(this.latest))
			// Re-run the image feedbacks so the key redraws when the title/label (hence PNG) moves.
			this.checkFeedbacks('slug_image', 'title_image')
		} catch (err) {
			this.updateStatus(InstanceStatus.ConnectionFailure, String(err?.message ?? err))
		}
	}

	async postAction(path, body) {
		try {
			const res = await fetch(joinUrl(this.config.url, path), {
				method: 'POST',
				headers: this.headers(),
				body: JSON.stringify(body ?? {}),
			})
			const json = await res.json().catch(() => ({}))
			if (json && json.success === false) {
				this.log('warn', `${path} rejected: ${json.error?.code ?? 'unknown'} ${json.error?.message ?? ''}`)
			}
			// Refresh state promptly so feedbacks reflect the change without waiting a full interval.
			this.poll()
		} catch (err) {
			this.log('error', `${path} failed: ${err?.message ?? err}`)
		}
	}

	// --- Definitions --------------------------------------------------------

	defineVariables() {
		this.setVariableDefinitions([
			{ variableId: 'display_label', name: 'Button label (slug / id / Custom)' },
			{ variableId: 'live_title', name: 'Live broadcast title (may be Arabic)' },
			{ variableId: 'active_preset_id', name: 'Active preset id' },
			{ variableId: 'is_live', name: 'On air' },
			{ variableId: 'no_target', name: 'No broadcast target' },
			{ variableId: 'privacy', name: 'Privacy status' },
			{ variableId: 'health', name: 'Health (ok/degraded/auth_error)' },
			{ variableId: 'busy', name: 'Action in progress' },
			{ variableId: 'api_enabled', name: 'API master switch enabled' },
			{ variableId: 'quota_remaining', name: 'YouTube quota remaining' },
		])
	}

	defineFeedbacks() {
		// Advanced feedbacks returning png64 — the whole point of this module. Bind one to a key
		// and it shows the middleware-rendered image; a two-state button can toggle slug ↔ title.
		this.setFeedbackDefinitions({
			slug_image: {
				type: 'advanced',
				name: 'Image: button label (slug)',
				description: 'Draws the slug/label PNG (Arabic-safe) onto the button.',
				options: [],
				callback: () => {
					const png64 = toPng64(this.latest?.slugPng)
					return png64 ? { png64 } : {}
				},
			},
			title_image: {
				type: 'advanced',
				name: 'Image: full live title',
				description: 'Draws the full broadcast-title PNG (Arabic-safe) onto the button.',
				options: [],
				callback: () => {
					const png64 = toPng64(this.latest?.titlePng)
					return png64 ? { png64 } : {}
				},
			},
		})
	}

	defineActions() {
		this.setActionDefinitions({
			apply_preset: {
				name: 'Apply preset',
				options: [{ type: 'textinput', id: 'presetId', label: 'Preset id', default: '' }],
				callback: (a) => this.postAction('/api/action/preset', { presetId: a.options.presetId }),
			},
			privacy_toggle: {
				name: 'Privacy: toggle private ↔ public',
				options: [],
				callback: () => this.postAction('/api/action/privacy', { mode: 'toggle' }),
			},
			privacy_set: {
				name: 'Privacy: set',
				options: [
					{
						type: 'dropdown',
						id: 'status',
						label: 'Status',
						default: 'public',
						choices: [
							{ id: 'public', label: 'public' },
							{ id: 'unlisted', label: 'unlisted' },
							{ id: 'private', label: 'private' },
						],
					},
				],
				callback: (a) => this.postAction('/api/action/privacy', { status: a.options.status }),
			},
			undo: {
				name: 'Undo last change',
				options: [],
				callback: () => this.postAction('/api/action/undo', {}),
			},
			refresh: {
				name: 'Refresh cache',
				options: [],
				callback: () => this.postAction('/api/action/refresh', {}),
			},
		})
	}
}

runEntrypoint(YtMiddlewareInstance, UpgradeScripts)
