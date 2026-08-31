// @ts-check
/**
 * v2.0.0 removed the Bearer-token config field: the middleware dropped auth entirely (LAN-only
 * personal tool, PRD-02 §8), so the token never did anything. This strips the stale `token` key
 * from a connection's stored config so it no longer lingers. Buttons wired to the also-removed
 * `check_connection` action (redundant with the WebSocket push, PRD-07 §7) surface as unknown and
 * can be deleted by the operator — there is no replacement to migrate them to.
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<import('../main.js').ModuleConfig>}
 */
function dropBearerToken(_context, props) {
	const config = /** @type {(import('../main.js').ModuleConfig & { token?: string }) | null} */ (props.config)
	if (config && config.token !== undefined) {
		const updated = { ...config }
		delete updated.token
		return { updatedConfig: updated, updatedActions: [], updatedFeedbacks: [] }
	}
	return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
}

/**
 * v2.3.0 re-adds a token field, because the hosted middleware now issues **device tokens** and
 * checks them on both the HTTP requests and the WebSocket handshake (PRD-15 §2/§4). Without this
 * step an install upgraded from v2.x has no `token` key at all, so the field renders empty and the
 * connection is silently unauthorised the moment the server stops running in grace mode.
 *
 * It seeds an **empty** token, never a value. A v1.x Bearer token — already stripped by
 * `dropBearerToken` above, which runs first — was a secret for a different scheme issued by a
 * different system; resurrecting one as a device credential would just fail authentication in a
 * more confusing way. The operator pastes the real one in once.
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<import('../main.js').ModuleConfig>}
 */
function seedDeviceToken(_context, props) {
	const config = /** @type {(import('../main.js').ModuleConfig & { token?: string }) | null} */ (props.config)
	if (config && config.token === undefined) {
		return { updatedConfig: { ...config, token: '' }, updatedActions: [], updatedFeedbacks: [] }
	}
	return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
}

/**
 * Append-only. Companion stores, per connection, how many of these it has already run, so an entry
 * is identified by its *index* — editing or reordering one re-points a migration an operator has
 * already applied (AGENTS.md hard rule; upgrades.test.js has the teeth).
 * @type {import('@companion-module/base').CompanionStaticUpgradeScript<import('../main.js').ModuleConfig>[]}
 */
export const UpgradeScripts = [dropBearerToken, seedDeviceToken]
