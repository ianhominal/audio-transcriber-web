/** localStorage key for the "has the user seen/dismissed the onboarding welcome" flag. Lives
 * here (the pure-logic module) instead of the client component so there's a single source of
 * truth even though the actual localStorage I/O happens in `onboarding-welcome.tsx` — same
 * constants-here/IO-there split already used by `RESURFACE_MIN_AGE_DAYS`/`DISMISSED_KEY` in
 * `src/lib/resurface.ts` / `resurface-card.tsx`. */
export const ONBOARDING_SEEN_KEY = "onboarding-seen";

/** true when the new-user onboarding welcome should be shown: the account has zero notes ever
 * AND the user hasn't dismissed/completed onboarding before (in this browser). */
export function shouldShowOnboarding(params: { hasAnyNotes: boolean; seen: boolean }): boolean {
  return !params.hasAnyNotes && !params.seen;
}
