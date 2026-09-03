import { LIVE_ELIGIBILITY_GLOSSARY, type LiveEligibility } from "@app/shared";

interface Props {
  eligibility: LiveEligibility;
}

/**
 * Riding mode (issue 061 / PRD-16 §6): YouTube will not let this channel create broadcasts, so
 * this app follows one made in Studio instead of making its own.
 *
 * Deliberately not built as a banner. In this rack a coloured 3px edge means a fault — amber for
 * "your aim is wrong", red for "you have lost YouTube" — and riding mode is neither: the
 * connection is perfect and nothing is going to change by retrying. So it keeps the edge, because
 * this is a line that matters, and leaves it the seam's own colour, because it is a standing
 * constraint rather than an incident. No lamp for the same reason: a lamp implies a state that
 * flickers, and this one holds until the channel itself changes.
 *
 * There is no button. Nothing in this app can lift a YouTube eligibility rule, and a control that
 * always fails is worse than none — the remedy sentence points at the one place that works.
 *
 * Silent unless the mode is `riding`. `unknown` is not `riding`: nothing has been refused yet, and
 * warning about a refusal that has not happened is how an eligible channel gets talked out of
 * using the feature.
 */
export function RidingModeNotice({ eligibility }: Props) {
  if (eligibility.mode !== "riding") return null;
  const term = LIVE_ELIGIBILITY_GLOSSARY.riding;
  const { reason, message } = eligibility;

  return (
    <div className="riding" role="status">
      <div className="riding__meta">
        <span className="eyebrow">Channel</span>
        <span className="riding__title">{term.label}</span>
        <span className="riding__note">{term.meaning}</span>
        <span className="riding__note">{term.remedy}</span>
      </div>

      {/* YouTube's own words, set as payload rather than paraphrased — the same treatment the
          conflict banner gives broadcast ids. This is the evidence for a claim the operator
          cannot otherwise check, and it is what issue 060's live test is measured against. */}
      {reason || message ? (
        <div className="riding__said" role="group" aria-label="What YouTube said">
          {reason ? <code className="riding__reason mono">{reason}</code> : null}
          {message ? <span className="riding__verbatim">{message}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
