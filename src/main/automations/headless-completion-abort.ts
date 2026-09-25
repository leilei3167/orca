import type {
  HeadlessAutomationDispatcher,
  HeadlessAutomationDispatchLaunch
} from './headless-dispatch'

/** Tracks headless completion observers so AutomationService.stop() can abort them. */
export class HeadlessCompletionAbortRegistry {
  private readonly controllers = new Map<string, AbortController>()

  wrapDispatcher(inner: HeadlessAutomationDispatcher): HeadlessAutomationDispatcher {
    return async (request) => {
      const controller = new AbortController()
      this.controllers.set(request.run.id, controller)
      try {
        const launch = await inner({
          ...request,
          completionSignal: controller.signal
        })
        this.trackCompletion(request.run.id, controller, launch)
        return { ...launch, completionAbortSignal: controller.signal }
      } catch (error) {
        this.controllers.delete(request.run.id)
        throw error
      }
    }
  }

  abortAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort()
    }
    this.controllers.clear()
  }

  private trackCompletion(
    runId: string,
    controller: AbortController,
    launch: HeadlessAutomationDispatchLaunch
  ): void {
    if (!launch.completion) {
      this.controllers.delete(runId)
      return
    }
    void launch.completion.finally(() => {
      if (this.controllers.get(runId) === controller) {
        this.controllers.delete(runId)
      }
    })
  }
}
