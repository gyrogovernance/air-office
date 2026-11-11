/** Local inference starts off each service session; enabling does not preload models. */
export function createLocalInferenceControl() {
  let enabled = false;
  let controller = new AbortController();
  controller.abort();
  return {
    enabled: () => enabled,
    signal(_model?: string): AbortSignal {
      if (!enabled) throw new Error('Local AI is off. Turn it on in the sidebar when you need it.');
      return controller.signal;
    },
    setEnabled(value: boolean) {
      if (value === enabled) return;
      enabled = value;
      if (value) controller = new AbortController();
      else controller.abort(new Error('Local AI was turned off.'));
    },
  };
}
