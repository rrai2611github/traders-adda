/** Checkpoint each accepted email separately so a later failure cannot suppress retries or repeat earlier successes. */
export async function deliverAlertBatch<State, Alert>(
  previous: State,
  decision: { state: State; alerts: Alert[] },
  send: (alert: Alert) => Promise<boolean>,
  acknowledge: (state: State, alert: Alert) => State,
  save: (state: State) => void,
): Promise<void> {
  let accepted = previous;
  for (const alert of decision.alerts) {
    if (!(await send(alert))) throw new Error("Alert email was not accepted. It remains eligible for retry at the next scheduled check.");
    accepted = acknowledge(accepted, alert);
    save(accepted);
  }
  save(decision.state);
}
