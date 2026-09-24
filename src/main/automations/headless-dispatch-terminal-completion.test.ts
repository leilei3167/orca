import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHeadlessAutomationCompletion } from './headless-dispatch-terminal-completion'
import {
  createRuntimeAutomationRunTerminalObserver,
  type AutomationRunTerminalHost
} from './runtime-terminal-run-observer'

const HANDLE = 'terminal-1'
const RUNTIME_TUI_IDLE_TIMEOUT_MS = 5 * 60 * 1000

type FakePane = {
  lastAgentStatus: 'idle' | 'working' | 'permission' | null
}

type FakeWaiter = {
  resolve: (value: { satisfied: boolean; blockedReason?: string }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function createFakeRuntime(initial: Partial<FakePane>) {
  const pane: FakePane = {
    lastAgentStatus: null,
    ...initial
  }
  const waiters = new Set<FakeWaiter>()

  const satisfiedNow = (): boolean => pane.lastAgentStatus === 'idle'

  const runtime: AutomationRunTerminalHost & {
    setPane: (next: Partial<FakePane>) => void
  } = {
    getTerminalHandleForPaneKey: () => HANDLE,
    readTerminal: async () => ({ tail: ['agent finished after a long command'] }),
    waitForTerminal: (_handle, options) => {
      if (options?.signal?.aborted) {
        return Promise.reject(new Error('request_aborted'))
      }
      if (satisfiedNow()) {
        return Promise.resolve({ satisfied: true })
      }
      return new Promise((resolve, reject) => {
        const waiter: FakeWaiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter)
            reject(new Error('timeout'))
          }, options?.timeoutMs ?? RUNTIME_TUI_IDLE_TIMEOUT_MS)
        }
        waiters.add(waiter)
      })
    },
    setPane: (next) => {
      Object.assign(pane, next)
      if (!satisfiedNow()) {
        return
      }
      for (const waiter of waiters) {
        waiters.delete(waiter)
        clearTimeout(waiter.timer)
        waiter.resolve({ satisfied: true })
      }
    }
  }
  return runtime
}

describe('createHeadlessAutomationCompletion (#22725)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('documents the bare tui-idle wait that failed long runs at 5 minutes', async () => {
    const runtime = createFakeRuntime({ lastAgentStatus: 'working' })
    const bare = runtime.waitForTerminal(HANDLE, { condition: 'tui-idle' })
    const expectation = expect(bare).rejects.toThrow('timeout')
    await vi.advanceTimersByTimeAsync(RUNTIME_TUI_IDLE_TIMEOUT_MS)
    await expectation
  })

  it('still completes after the agent works past the 5-minute tui-idle default', async () => {
    const runtime = createFakeRuntime({ lastAgentStatus: 'working' })
    const observer = createRuntimeAutomationRunTerminalObserver(runtime)
    const completion = createHeadlessAutomationCompletion({
      observeCompletion: (handle, options) => observer.observeCompletion(handle, options),
      terminalHandle: HANDLE
    })

    // Agent keeps working past the runtime default that used to reject headless.
    await vi.advanceTimersByTimeAsync(RUNTIME_TUI_IDLE_TIMEOUT_MS + 18_000)
    runtime.setPane({ lastAgentStatus: 'idle' })
    await vi.advanceTimersByTimeAsync(10)

    await expect(completion).resolves.toMatchObject({
      status: 'completed',
      error: null
    })
  })
})
