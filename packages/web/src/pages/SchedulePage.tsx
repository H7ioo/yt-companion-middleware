import { PrepareBroadcast } from "../components/PrepareBroadcast.js";
import { useDashboard } from "./context.js";

/**
 * Making tonight's broadcast, rather than finding out which existing one wins (issue 062).
 *
 * Separated from Live because the two are done at different times by different people: this is
 * the afternoon's job, done once, at a keyboard; Live is the thing watched during the show.
 */
export function SchedulePage() {
  const { presets, streams, categories, apiEnabled, state, settings, refreshSession } =
    useDashboard();

  return (
    <PrepareBroadcast
      presets={presets}
      streams={streams}
      categories={categories}
      apiEnabled={apiEnabled}
      eligibility={state?.liveEligibility ?? null}
      defaultCategory={settings.defaultCategory}
      onPrepared={refreshSession}
    />
  );
}
