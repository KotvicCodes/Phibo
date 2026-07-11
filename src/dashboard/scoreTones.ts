export type ScoreRangeTone =
  | "score-excellent"
  | "score-good"
  | "score-neutral"
  | "score-poor"

// Tone thresholds compare the same rounded value the card displays, so a
// shown 85 is always blue even when the raw estimate is 84.6.
export function scoreRangeTone(value: number | null): ScoreRangeTone {
  if (value === null) {
    return "score-neutral"
  }

  const displayedScore = Math.round(value)

  if (displayedScore >= 85) {
    return "score-excellent"
  }

  if (displayedScore >= 70) {
    return "score-good"
  }

  return "score-poor"
}
