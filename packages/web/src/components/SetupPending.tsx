/**
 * What a user sees on a deployment that has no YouTube connection yet (issue 045).
 *
 * The setup screen behind this is an admin's, and every control on it would answer 403. The
 * dashboard behind it has nothing to show either — there is no channel to run. So this says the
 * one true thing there is to say, and names who can change it, rather than dropping someone into
 * a dashboard whose every panel fails.
 *
 * Deliberately the same card as the setup screen it stands in for: same place on the screen, same
 * shape, so an admin and a user talking about it are looking at the same thing.
 */
export function SetupPending() {
  return (
    <div className="setup">
      <div className="setup__card">
        <div className="setup__head">
          <span className="eyebrow">Not connected</span>
          <h1 className="setup__title">No channel yet</h1>
          <p className="setup__lede">
            An admin has to connect a YouTube channel before this dashboard can run a show. Once
            they have, reload this page.
          </p>
        </div>
        <p className="setup__foot">
          <a className="setup__link" href="/guide" target="_blank" rel="noreferrer">
            Read the operator guide
          </a>{" "}
          while you wait.
        </p>
      </div>
    </div>
  );
}
