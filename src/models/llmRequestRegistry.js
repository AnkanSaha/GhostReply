// Tracks every LLM request currently in flight (across auto-reply, relay/schedule parsing,
// takeover duration extraction — every getReply() call), so a "stop" command can cancel all
// of them immediately instead of waiting for whichever ones happen to be running to finish.
class LlmRequestRegistry {
  constructor() {
    this.controllers = new Set();
  }

  track(controller) {
    this.controllers.add(controller);
  }

  untrack(controller) {
    this.controllers.delete(controller);
  }

  abortAll(reason) {
    for (const controller of this.controllers) controller.abort(reason);
  }
}

const registry = new LlmRequestRegistry();

export function createTrackedAbortController() {
  const controller = new AbortController();
  registry.track(controller);
  return controller;
}

export function releaseAbortController(controller) {
  registry.untrack(controller);
}

export function abortAllLlmRequests(reason) {
  registry.abortAll(reason);
}
