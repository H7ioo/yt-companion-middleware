import { BroadcastList } from "../components/BroadcastList.js";
import { useDashboard } from "./context.js";

/**
 * The channel's collection of broadcasts, and the one place they are acted on (issue 069,
 * PRD-16 §9).
 *
 * The same list the Live page shows, with powers: this page is opened deliberately, before the
 * show, to fix a title, retime a service or clear out something that should not be there. Live
 * shows the same rows read-only, because at 22:58 the operator is watching what will air, not
 * editing it — and the two pages render one component from one fetch so they can never come to
 * disagree about which broadcast wins.
 */
export function BroadcastsPage() {
  const { state, refreshSession } = useDashboard();

  return (
    <BroadcastList
      manage
      apiEnabled={state ? state.apiEnabled : null}
      pin={state?.targetPin ?? null}
      onPinned={refreshSession}
    />
  );
}
