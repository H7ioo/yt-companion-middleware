import { InstanceBase, InstanceStatus, Regex, combineRgb, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'
import {
	categoryChoices,
	healthColor,
	joinUrl,
	mapVariables,
	nextApiEnabled,
	presetButtons,
	presetChoices,
	streamChoices,
	summarizeHealth,
	toPng64,
	wsUrl,
} from './src/transform.js'
import { UpgradeScripts } from './src/upgrades.js'

const FEEDBACK_IDS = [
	'slug_image',
	'title_image',
	'on_air',
	'busy',
	'api_disabled',
	'health_state',
	'health_color',
	'active_preset',
]

/**
 * Companion module for the YouTube Live Metadata Control middleware.
 *
 * Its reason to exist: Companion's Generic HTTP module can bind the Latin-safe `displayLabel`
 * text, but it has no way to put the middleware's Arabic title/slug PNGs onto a key. This module
 * adds two advanced feedbacks that return those PNGs via `png64`, plus variables, boolean
 * feedbacks and the action bus — so an Arabic title shows correctly as an image, not tofu boxes.
 *
 * Transport: it holds a persistent WebSocket to /api/feedback/ws (like the OBS module holds an
 * obs-websocket connection). The server pushes a `state` frame on connect and on every change, so
 * updates are instant and cost zero YouTube quota. Actions are HTTP POSTs to the action bus; the
 * server pushes a fresh state after each mutation, so we never poll.
 */
class YtMiddlewareInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.latest = {} // last DashboardState pushed over the WS
		this.presets = []
		this.categories = []
		this.streams = []
		this.reconnectDelay = 1000
		this.destroyed = false
		this.defineVariables()
		this.defineFeedbacks()
		this.defineActions()
		this.definePresets()
		this.setVariableValues({ dashboard_url: this.config.url })
		await this.refreshLists()
		this.connectWs()
	}

	async destroy() {
		this.destroyed = true
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
		this.closeWs()
	}

	async configUpdated(config) {
		this.config = config
		this.setVariableValues({ dashboard_url: this.config.url })
		await this.refreshLists()
		this.connectWs()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'About',
				value:
					'Connects to the YouTube Live Metadata Control middleware over a live WebSocket (instant push, no polling). Point this at the same host that serves the dashboard. The slug/title image feedbacks render Arabic correctly on a key.',
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

	authHeader() {
		return this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}
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
			// No poll here: the server pushes a fresh state frame over the WS after every mutation.
		} catch (err) {
			this.log('error', `${path} failed: ${err?.message ?? err}`)
		}
	}

	/**
	 * Fetches the preset/category/stream lists over HTTP (each independently, tolerating failure)
	 * and re-defines the actions so the dropdowns repopulate. Called on init, configUpdated and the
	 * refresh_lists action — never on a timer.
	 */
	async refreshLists() {
		this.presets = await this.getJson('/api/dashboard/presets', [])
		this.categories = await this.getJson('/api/dashboard/categories', [])
		this.streams = await this.getJson('/api/dashboard/streams', [])
		this.defineActions()
		this.definePresets()
	}

	async getJson(path, fallback) {
		try {
			const res = await fetch(joinUrl(this.config.url, path), { headers: this.headers() })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			return await res.json()
		} catch (err) {
			this.log('warn', `GET ${path} failed: ${err?.message ?? err}`)
			return fallback
		}
	}

	/**
	 * Drives the middleware's master API switch (kill switch) via PUT /api/dashboard/service. Unlike
	 * the action bus this route is a PUT that returns the new service state (not the `{success}`
	 * envelope), and the server emits a change so the fresh state arrives over the WS.
	 * @param {boolean} enabled
	 */
	async setApiEnabled(enabled) {
		try {
			const res = await fetch(joinUrl(this.config.url, '/api/dashboard/service'), {
				method: 'PUT',
				headers: this.headers(),
				body: JSON.stringify({ apiEnabled: enabled }),
			})
			if (!res.ok) {
				const json = await res.json().catch(() => ({}))
				this.log('warn', `API switch rejected: ${json.error?.message ?? `HTTP ${res.status}`}`)
				return
			}
			this.log('info', `API master switch → ${enabled ? 'enabled' : 'disabled'}`)
			// No poll: the PUT emits a change, so a fresh state frame lands over the WS.
		} catch (err) {
			this.log('error', `API switch failed: ${err?.message ?? err}`)
		}
	}

	/**
	 * On-demand reachability + YouTube-auth check against the unauthenticated /health endpoint (the
	 * "YouTube status" liveness route). Logs a one-line summary and nudges the connection status so
	 * an operator can confirm the middleware — and YouTube auth behind it — from a button.
	 */
	async checkConnection() {
		try {
			const res = await fetch(joinUrl(this.config.url, '/api/feedback/health'), { headers: this.headers() })
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const health = await res.json()
			const { ok, text } = summarizeHealth(health)
			this.log('info', `Connection check: ${text}`)
			this.updateStatus(ok ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure, text)
		} catch (err) {
			const message = String(err?.message ?? err)
			this.log('error', `Connection check failed: ${message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, message)
		}
	}

	// --- WebSocket ----------------------------------------------------------

	connectWs() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = undefined
		}
		this.closeWs()
		this.updateStatus(InstanceStatus.Connecting)
		let ws
		try {
			ws = new WebSocket(wsUrl(this.config.url), { headers: this.authHeader() })
		} catch (err) {
			this.updateStatus(InstanceStatus.ConnectionFailure, String(err?.message ?? err))
			this.scheduleReconnect()
			return
		}
		this.ws = ws

		ws.on('open', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.reconnectDelay = 1000
			// Any inbound frame forces the server to resend current state — belt-and-suspenders resync.
			try {
				ws.send('resync')
			} catch {
				// ignore — a fresh connection always gets an unsolicited state frame anyway
			}
		})

		ws.on('message', (data) => {
			let msg
			try {
				msg = JSON.parse(data.toString())
			} catch {
				return
			}
			if (msg?.event !== 'state') return
			this.latest = msg.state ?? {}
			this.setVariableValues(mapVariables(this.latest, this.presets))
			this.checkFeedbacks(...FEEDBACK_IDS)
		})

		ws.on('close', () => this.onWsDown('WebSocket closed'))
		ws.on('error', (err) => this.onWsDown(String(err?.message ?? err)))
	}

	onWsDown(message) {
		if (this.destroyed) return
		this.updateStatus(InstanceStatus.ConnectionFailure, message)
		this.scheduleReconnect()
	}

	scheduleReconnect() {
		if (this.destroyed || this.reconnectTimer) return
		const delay = this.reconnectDelay
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined
			this.connectWs()
		}, delay)
		this.reconnectDelay = Math.min(10000, this.reconnectDelay * 2)
	}

	closeWs() {
		if (this.ws) {
			// Drop listeners first so a close during teardown doesn't schedule a reconnect.
			this.ws.removeAllListeners()
			try {
				this.ws.close()
			} catch {
				// already closed
			}
			this.ws = undefined
		}
	}

	// --- Definitions --------------------------------------------------------

	defineVariables() {
		this.setVariableDefinitions([
			{ variableId: 'display_label', name: 'Button label (slug / id / Custom)' },
			{ variableId: 'live_title', name: 'Live broadcast title (may be Arabic)' },
			{ variableId: 'active_preset_id', name: 'Active preset id' },
			{ variableId: 'active_preset_title', name: 'Active preset title' },
			{ variableId: 'is_live', name: 'On Air' },
			{ variableId: 'no_target', name: 'No broadcast target' },
			{ variableId: 'privacy', name: 'Privacy status' },
			{ variableId: 'health', name: 'Health (ok/degraded/offline/auth_error)' },
			{ variableId: 'health_message', name: 'Health message' },
			{ variableId: 'busy', name: 'Action in progress' },
			{ variableId: 'api_enabled', name: 'API master switch enabled' },
			{ variableId: 'quota_used', name: 'YouTube quota used' },
			{ variableId: 'quota_limit', name: 'YouTube quota limit' },
			{ variableId: 'quota_remaining', name: 'YouTube quota remaining' },
			{ variableId: 'undo_label', name: 'Undo target label' },
			{ variableId: 'dashboard_url', name: 'Dashboard base URL' },
		])
	}

	defineFeedbacks() {
		this.setFeedbackDefinitions({
			// Advanced feedbacks returning png64 — the Arabic-safe images that justify this module.
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
			on_air: {
				type: 'boolean',
				name: 'On Air',
				description: 'True while the broadcast is live.',
				defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
				options: [],
				callback: () => Boolean(this.latest?.status?.isLive),
			},
			busy: {
				type: 'boolean',
				name: 'Busy (action in progress)',
				description: 'True while the middleware is applying a change.',
				defaultStyle: { bgcolor: combineRgb(0, 80, 200), color: combineRgb(255, 255, 255) },
				options: [],
				callback: () => Boolean(this.latest?.busy),
			},
			api_disabled: {
				type: 'boolean',
				name: 'API disabled (kill switch)',
				description: 'True when the middleware master switch is off.',
				defaultStyle: { bgcolor: combineRgb(120, 120, 120), color: combineRgb(255, 255, 255) },
				options: [],
				callback: () => this.latest?.apiEnabled === false,
			},
			health_state: {
				type: 'boolean',
				name: 'Health state is…',
				description: 'True when the middleware health matches the selected value.',
				defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(255, 255, 255) },
				options: [
					{
						type: 'dropdown',
						id: 'which',
						label: 'Health',
						default: 'degraded',
						choices: [
							{ id: 'ok', label: 'ok' },
							{ id: 'degraded', label: 'degraded' },
							{ id: 'offline', label: 'offline' },
							{ id: 'auth_error', label: 'auth_error' },
						],
					},
				],
				callback: (fb) => this.latest?.health === fb.options.which,
			},
			health_color: {
				type: 'advanced',
				name: 'Health color (auto)',
				description:
					'Recolors the key to match the current middleware health: green ok, amber degraded, slate offline, red auth_error.',
				options: [],
				callback: () => {
					const health = this.latest?.health
					if (!health) return {}
					return { bgcolor: healthColor(health), color: combineRgb(255, 255, 255) }
				},
			},
			active_preset: {
				type: 'boolean',
				name: 'Active preset is…',
				description: 'True when the selected preset is the active one — highlights its key.',
				defaultStyle: { bgcolor: combineRgb(0, 140, 0), color: combineRgb(255, 255, 255) },
				options: [
					{
						type: 'dropdown',
						id: 'presetId',
						label: 'Preset',
						default: '',
						choices: presetChoices(this.presets),
					},
				],
				callback: (fb) => Boolean(fb.options.presetId) && this.latest?.activePresetId === fb.options.presetId,
			},
		})
	}

	defineActions() {
		this.setActionDefinitions({
			apply_preset: {
				name: 'Apply preset',
				options: [
					{
						type: 'dropdown',
						id: 'presetId',
						label: 'Preset',
						default: this.presets[0]?.id ?? '',
						choices: presetChoices(this.presets),
					},
					{
						type: 'textinput',
						id: 'vars',
						label: 'Template vars (JSON, optional)',
						default: '',
						useVariables: true,
					},
				],
				callback: async (a) => {
					const body = { presetId: a.options.presetId }
					const raw = (await this.parseVariablesInString(a.options.vars ?? '')).trim()
					if (raw) {
						try {
							body.vars = JSON.parse(raw)
						} catch (err) {
							this.log('warn', `apply_preset: ignoring invalid vars JSON: ${err?.message ?? err}`)
						}
					}
					return this.postAction('/api/action/preset', body)
				},
			},
			update: {
				name: 'Update live metadata',
				options: [
					{ type: 'textinput', id: 'title', label: 'Title (required)', default: '', useVariables: true },
					{ type: 'textinput', id: 'description', label: 'Description', default: '', useVariables: true },
					{
						type: 'dropdown',
						id: 'privacyStatus',
						label: 'Privacy',
						default: '',
						choices: [
							{ id: '', label: '— unchanged —' },
							{ id: 'public', label: 'public' },
							{ id: 'unlisted', label: 'unlisted' },
							{ id: 'private', label: 'private' },
						],
					},
					{ type: 'dropdown', id: 'category', label: 'Category', default: '', choices: categoryChoices(this.categories) },
					{ type: 'dropdown', id: 'streamBoundId', label: 'Bound stream', default: '', choices: streamChoices(this.streams) },
				],
				callback: async (a) => {
					const title = (await this.parseVariablesInString(a.options.title ?? '')).trim()
					if (!title) {
						this.log('warn', 'update: title is required — skipping')
						return
					}
					const body = { title }
					const description = (await this.parseVariablesInString(a.options.description ?? '')).trim()
					if (description) body.description = description
					if (a.options.privacyStatus) body.privacyStatus = a.options.privacyStatus
					if (a.options.category) body.category = a.options.category
					if (a.options.streamBoundId) body.streamBoundId = a.options.streamBoundId
					return this.postAction('/api/action/update', body)
				},
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
				name: 'Refresh from YouTube',
				options: [],
				callback: () => this.postAction('/api/action/refresh', {}),
			},
			refresh_lists: {
				name: 'Refresh lists (presets, categories, streams)',
				options: [],
				callback: () => this.refreshLists(),
			},
			check_connection: {
				name: 'Check middleware connection (YouTube status)',
				options: [],
				callback: () => this.checkConnection(),
			},
			api_switch_set: {
				name: 'API master switch (kill switch): set',
				options: [
					{
						type: 'dropdown',
						id: 'enabled',
						label: 'API',
						default: 'true',
						choices: [
							{ id: 'true', label: 'enabled' },
							{ id: 'false', label: 'disabled' },
						],
					},
				],
				callback: (a) => this.setApiEnabled(a.options.enabled === 'true'),
			},
			api_switch_toggle: {
				name: 'API master switch (kill switch): toggle',
				options: [],
				callback: () => this.setApiEnabled(nextApiEnabled(this.latest)),
			},
		})
	}

	/**
	 * Publishes the Presets tab: drag-drop button templates. One "Apply preset" button per
	 * middleware preset (self-labelled, wired to apply + active-highlight — regenerated whenever the
	 * lists refresh), plus a fixed "State & controls" set built from this module's own actions and
	 * feedbacks. Re-run on init and after refreshLists so new presets appear without a reconnect.
	 */
	definePresets() {
		const white = combineRgb(255, 255, 255)
		const black = combineRgb(0, 0, 0)
		const util = (name, text, bgcolor, actionId, feedback) => ({
			type: 'button',
			category: 'State & controls',
			name,
			style: { text, size: 'auto', color: white, bgcolor },
			steps: [{ down: actionId ? [{ actionId, options: {} }] : [], up: [] }],
			feedbacks: feedback ? [feedback] : [],
		})
		this.setPresetDefinitions({
			...presetButtons(this.presets),
			live_title_image: {
				type: 'button',
				category: 'State & controls',
				name: 'Arabic-safe live title (image)',
				style: { text: '', size: 'auto', color: white, bgcolor: combineRgb(20, 22, 27) },
				steps: [{ down: [], up: [] }],
				feedbacks: [{ feedbackId: 'title_image', options: {} }],
			},
			slug_label_image: {
				type: 'button',
				category: 'State & controls',
				name: 'Arabic-safe button label (image)',
				style: { text: '', size: 'auto', color: white, bgcolor: combineRgb(20, 22, 27) },
				steps: [{ down: [], up: [] }],
				feedbacks: [{ feedbackId: 'slug_image', options: {} }],
			},
			on_air_indicator: {
				type: 'button',
				category: 'State & controls',
				name: 'On-air indicator',
				style: { text: '$(ytmeta:live_title)', size: 'auto', color: white, bgcolor: combineRgb(40, 40, 40) },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{ feedbackId: 'on_air', options: {}, style: { bgcolor: combineRgb(200, 0, 0), color: white } },
				],
			},
			privacy_toggle_btn: util(
				'Privacy toggle',
				'Privacy\\n$(ytmeta:privacy)',
				combineRgb(60, 60, 70),
				'privacy_toggle',
			),
			undo_btn: {
				...util('Undo last change', 'Undo\\n$(ytmeta:undo_label)', combineRgb(120, 80, 0), 'undo'),
			},
			refresh_cache_btn: util('Refresh from YouTube', 'Refresh', combineRgb(40, 60, 80), 'refresh'),
			refresh_lists_btn: util('Refresh lists', 'Refresh\\nlists', combineRgb(40, 60, 80), 'refresh_lists'),
			check_connection_btn: {
				...util('Check connection', 'Check\\nconn', combineRgb(30, 90, 90), 'check_connection', {
					feedbackId: 'health_state',
					options: { which: 'auth_error' },
					style: { bgcolor: combineRgb(200, 0, 0), color: white },
				}),
			},
			api_switch_btn: {
				...util('API kill switch (toggle)', 'API\\non/off', combineRgb(90, 40, 40), 'api_switch_toggle', {
					feedbackId: 'api_disabled',
					options: {},
					style: { bgcolor: combineRgb(120, 120, 120), color: white },
				}),
			},
			busy_indicator: {
				type: 'button',
				category: 'State & controls',
				name: 'Busy indicator',
				style: { text: '$(ytmeta:display_label)', size: 'auto', color: white, bgcolor: black },
				steps: [{ down: [], up: [] }],
				feedbacks: [
					{ feedbackId: 'busy', options: {}, style: { bgcolor: combineRgb(0, 80, 200), color: white } },
				],
			},
		})
	}
}

runEntrypoint(YtMiddlewareInstance, UpgradeScripts)
