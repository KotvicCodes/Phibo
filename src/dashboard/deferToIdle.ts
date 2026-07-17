// Runs work after the view has painted. The Insights, Explore, and Optimal
// views all use this for their deferred model fits and confidence passes;
// the 500ms timeout keeps a busy tab from postponing the numbers forever.
export function deferToIdle(run: () => void) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 500 })
  } else {
    setTimeout(run, 0)
  }
}
