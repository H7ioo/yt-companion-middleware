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

/** @type {import('@companion-module/base').CompanionStaticUpgradeScript<import('../main.js').ModuleConfig>[]} */
export const UpgradeScripts = [dropBearerToken]
