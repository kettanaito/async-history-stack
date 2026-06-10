import { invariant } from 'outvariant'

export interface HistoryStackInit {
  /**
   * Maximum number of history entries.
   */
  limit: number

  /**
   * Automatically merge history entries pushed within the given window (ms).
   * @default 0
   */
  autoMergeWithin?: number

  /**
   * Listen to changes in the history stack.
   * This includes `.push()`, `.undo()`, and `.redo()` as long
   * as the history entry wasn't skipped (returned `null`).
   */
  onChange?: () => void
}

export class HistoryStack {
  #stack: Array<HistoryStackEntry>
  #size: number
  #position: number
  #pendingExecution?: PendingExecution
  #latestTimestamp: number
  #batchWindow: number
  #pendingBatch: Array<HistoryStackApplyFunction>
  #batchTimer?: number
  #batchPromise: PromiseWithResolvers<void>
  #onChange?: () => void

  constructor(init: HistoryStackInit) {
    this.#size = init.limit
    this.#batchWindow = init.autoMergeWithin ?? 0
    this.#onChange = init.onChange

    this.#stack = []
    this.#position = 0
    this.#latestTimestamp = 0

    this.#pendingBatch = []
    this.#batchPromise = Promise.withResolvers()
  }

  /**
   * Timestamp of the latest completed change.
   */
  public get timestamp(): number {
    return this.#latestTimestamp
  }

  /**
   * Total count of all history entries in this stack.
   */
  public get size(): number {
    return this.#stack.length
  }

  /**
   * Clear this history stack.
   * Optionally, abort any pending operations.
   */
  public clear(abortPending = false): void {
    if (abortPending && this.#pendingExecution) {
      this.#abortExecutionChain(this.#pendingExecution.chain)
      this.#pendingExecution = undefined
    }

    this.#stack.length = 0
    this.#latestTimestamp = 0
  }

  /**
   * Register a new history entry.
   */
  public async push(applyFn: HistoryStackApplyFunction): Promise<void> {
    if (this.#batchWindow > 0) {
      this.#pendingBatch.push(applyFn)

      if (!this.#batchTimer) {
        this.#batchTimer = setTimeout(
          () => this.#batchPromise.resolve(),
          this.#batchWindow,
        )
      }

      return this.#batchPromise.promise.then(async () => {
        const batchedApplyChange = await this.#mergeBatch()

        if (batchedApplyChange) {
          await this.#pushAndExecute(batchedApplyChange)
        }
      })
    }

    await this.#pushAndExecute(applyFn)
  }

  /**
   * Undo the latest change.
   * @returns True if the change has been undone, false otherwise.
   */
  public async undo(): Promise<boolean> {
    if (this.#stack.length === 0) {
      return false
    }

    // Wait for the redo to decrease the position, otherwise ignore.
    if (this.#position === this.#stack.length) {
      return false
    }

    const entryPosition =
      this.#position === -1 ? ++this.#position : this.#position
    this.#position++

    return this.#execute('revert', entryPosition)
  }

  /**
   * Redo the previous change.
   * @returns `true` if the change has been redone, `false` otherwise.
   */
  public async redo(): Promise<boolean> {
    if (this.#stack.length === 0) {
      return false
    }

    // Prevent the position from going lower than -1.
    this.#position = Math.max(-1, this.#position - 1)

    // Wait for undo to increase the position, otherwise ignore.
    if (this.#position === -1) {
      return false
    }

    return this.#execute('apply', this.#position)
  }

  /**
   * Merge multiple history entries into one so they can be undone/redone
   * as a single history entry.
   * @note Merged functions are executed *sequentially*.
   */
  public merge(
    ...applyFns: Array<HistoryStackApplyFunction>
  ): HistoryStackApplyFunction {
    return async ({ signal }) => {
      const reverts: Array<HistoryStackRevertFunction> = []

      for (const applyFn of applyFns) {
        if (signal.aborted) {
          break
        }

        const revertFn = await applyFn({ signal })

        if (revertFn != null) {
          reverts.push(revertFn)
        }
      }

      return async ({ signal }) => {
        /**
         * @note Revert the changes in the same, NOT reversed order.
         * This ensures that order-sensitive operations are reverted correctly
         * (e.g. first applied -> first reversed).
         */
        for (let i = 0; i < reverts.length; i++) {
          if (signal.aborted) {
            break
          }

          await reverts[i]({ signal })
        }
      }
    }
  }

  async #mergeBatch(): Promise<HistoryStackApplyFunction | undefined> {
    const batch = this.#pendingBatch

    this.#pendingBatch = []
    clearTimeout(this.#batchTimer)
    this.#batchTimer = undefined
    this.#batchPromise = Promise.withResolvers()

    if (batch.length === 0) {
      return
    }

    return this.merge(...batch)
  }

  async #pushAndExecute(applyFn: HistoryStackApplyFunction): Promise<void> {
    const entry = new HistoryStackEntry(applyFn)

    entry.onReadyStateChange = () => {
      if (entry.timestamp > this.#latestTimestamp) {
        this.#latestTimestamp = entry.timestamp
      }
    }

    if (this.#position > 0) {
      // Discard any entries between the start of the stack and the current position.
      this.#stack.splice(0, this.#position, entry)
    } else {
      this.#stack.unshift(entry)
    }

    // Keep the stack within the desired size.
    if (this.#stack.length > this.#size) {
      this.#stack.splice(this.#size)
    }

    // Reset to the start of the stack and execute the new entry immediately.
    this.#position = 0

    await this.#execute('apply', this.#position)
  }

  async #execute(
    command: 'apply' | 'revert',
    position: number,
  ): Promise<boolean> {
    invariant(
      position >= 0 && position <= this.#stack.length - 1,
      'Failed to execute history stack entry at position "%d": position is out of range',
      position,
    )

    const entry = this.#stack[position]

    invariant(
      entry != null,
      'Failed to execute history stack entry at position "%d": no entry at position',
      position,
    )

    if (this.#pendingExecution) {
      if (this.#pendingExecution.command === command) {
        // Handle a skipped entry when another entry tries to chain after it.
        if (this.#pendingExecution.entry.skipped) {
          this.#removeEntry(this.#pendingExecution.entry)
        }

        const chain = this.#pendingExecution.chain
        const previousPromise = this.#pendingExecution.promise
        const chainedPromise = previousPromise
          .then(
            (completed) => completed,
            /**
             * @note A failed apply must not block subsequent, unrelated
             * entries. A failed revert halts the chain since the state
             * it left behind is unknown.
             */
            () => command === 'apply',
          )
          .then(async (completed) => {
            // Never execute entries whose chain was aborted while
            // they were waiting for their turn.
            if (!completed || chain.aborted) {
              return false
            }

            chain.activeEntry = entry

            const result =
              command === 'apply' ? await entry.apply() : await entry.revert()

            if (!entry.skipped) {
              this.#onChange?.()
            }

            return result
          })

        chainedPromise.catch(() => {
          if (command === 'apply') {
            this.#removeEntry(entry)
          }
        })

        this.#trackExecution({ command, entry, promise: chainedPromise, chain })
        return chainedPromise
      }

      this.#abortExecutionChain(this.#pendingExecution.chain)
    }

    const chain: ExecutionChain = { aborted: false, activeEntry: entry }
    const promise = command === 'apply' ? entry.apply() : entry.revert()
    this.#trackExecution({ command, entry, promise, chain })

    promise.then(
      () => {
        if (entry.skipped) {
          /**
           * Delete history entries that were skipped
           * (i.e. returned `null` instead of the revert function).
           * @note Remove the entry by identity: by the time a slow
           * skipped entry settles, `position` may point at an entry
           * pushed after it.
           */
          this.#removeEntry(entry)
          return
        }

        this.#onChange?.()
      },
      () => {
        // A failed apply never happened: remove its entry from the history.
        if (command === 'apply') {
          this.#removeEntry(entry)
        }
      },
    )

    return promise
  }

  /**
   * Track the given execution as pending, and stop tracking it once
   * it settles. Subsequent executions only chain onto in-flight ones;
   * a settled (especially rejected) execution must not affect them.
   */
  #trackExecution(execution: PendingExecution): void {
    this.#pendingExecution = execution

    const settleListener = () => {
      if (this.#pendingExecution === execution) {
        this.#pendingExecution = undefined
      }
    }

    execution.promise.then(settleListener, settleListener)
  }

  /**
   * Abort the entire pending chain of executions: the execution
   * currently in flight, and any executions queued after it.
   */
  #abortExecutionChain(chain: ExecutionChain): void {
    chain.aborted = true

    if (chain.activeEntry.readyState !== HistoryStackEntry.DONE) {
      chain.activeEntry.abort()
    }
  }

  #removeEntry(entry: HistoryStackEntry): void {
    const entryIndex = this.#stack.indexOf(entry)

    if (entryIndex !== -1) {
      this.#stack.splice(entryIndex, 1)
    }
  }
}

interface PendingExecution {
  command: 'apply' | 'revert'
  entry: HistoryStackEntry
  promise: Promise<boolean>
  chain: ExecutionChain
}

/**
 * State shared by all executions chained one after another.
 * Aborting it cancels the queued executions that haven't started.
 */
interface ExecutionChain {
  aborted: boolean
  activeEntry: HistoryStackEntry
}

export type HistoryStackApplyFunction = (args: {
  signal: AbortSignal
}) =>
  | Promise<HistoryStackRevertFunction | null>
  | HistoryStackRevertFunction
  | null

export type HistoryStackRevertFunction = (args: {
  signal: AbortSignal
}) => Promise<void> | void

export type HistoryStackReadyState =
  | typeof HistoryStackEntry.IDLE
  | typeof HistoryStackEntry.PENDING
  | typeof HistoryStackEntry.DONE

class HistoryStackEntry {
  static IDLE = 0 as const
  static PENDING = 1 as const
  static DONE = 2 as const

  #controller: AbortController | null
  #applyFn: HistoryStackApplyFunction
  #revertFn: HistoryStackRevertFunction | null

  public id: string
  public aborted: boolean
  public readyState: HistoryStackReadyState
  public onReadyStateChange?: (this: HistoryStackEntry) => void
  public timestamp: number
  public skipped: boolean

  constructor(applyFn: HistoryStackApplyFunction) {
    this.id = crypto.randomUUID()
    this.#controller = null
    this.#applyFn = applyFn
    this.#revertFn = null

    this.readyState = HistoryStackEntry.IDLE
    this.aborted = false
    this.skipped = false
    this.timestamp = 0
  }

  public async apply(): Promise<boolean> {
    if (this.#controller && this.readyState !== HistoryStackEntry.DONE) {
      this.abort()
    }

    this.aborted = false
    this.#setReadyState(HistoryStackEntry.PENDING)

    /**
     * A pending result promise whose boolean decides whether subsequent entries
     * should be chained after this one (i.e. if this entry has been aborted).
     */
    const pendingResult = Promise.withResolvers<boolean>()
    this.#controller = new AbortController()
    const controller = this.#controller

    const abortListener = () => {
      this.#revert()
      pendingResult.resolve(false)
      this.#setReadyState(HistoryStackEntry.DONE)
    }

    controller.signal.addEventListener('abort', abortListener, {
      once: true,
    })

    await Promise.try(async () => {
      return this.#applyFn({ signal: controller.signal })
    })
      .then((revertFn) => {
        this.#revertFn = revertFn
      })
      .finally(async () => {
        if (this.#revertFn == null) {
          controller.signal.removeEventListener('abort', abortListener)
          pendingResult.resolve(!controller.signal.aborted)
          this.#setReadyState(HistoryStackEntry.DONE)

          this.skipped = true
          return
        }

        this.timestamp = Date.now()

        /**
         * @note Remove the listener so subsequent `apply()` doesn't revert
         * the previous apply, but remove the listener because it's irrelevant.
         */
        controller.signal.removeEventListener('abort', abortListener)
        pendingResult.resolve(!controller.signal.aborted)
        this.#setReadyState(HistoryStackEntry.DONE)
      })

    return pendingResult.promise
  }

  public async revert(): Promise<boolean> {
    if (this.#controller && this.readyState !== HistoryStackEntry.DONE) {
      this.abort()
    }

    this.aborted = false
    this.#setReadyState(HistoryStackEntry.PENDING)

    return this.#revert().finally(async () => {
      this.timestamp = Date.now()
      this.#setReadyState(HistoryStackEntry.DONE)
    })
  }

  public abort(): void {
    this.aborted = true
    this.#controller?.abort()
  }

  async #revert(): Promise<boolean> {
    const revertFn = this.#revertFn

    if (!revertFn) {
      return false
    }

    const pendingResult = Promise.withResolvers<boolean>()

    /**
     * @note Keep a local reference to the controller. A concurrent
     * `apply()`/`revert()` replaces `this.#controller`, and resolving
     * from the instance field would report an aborted revert as completed.
     */
    const controller = new AbortController()
    this.#controller = controller

    await Promise.try(async () => {
      return revertFn({ signal: controller.signal })
    }).finally(() => {
      pendingResult.resolve(!controller.signal.aborted)

      if (this.#controller === controller) {
        this.#controller = null
      }
    })

    return pendingResult.promise
  }

  #setReadyState(nextReadyState: HistoryStackReadyState): void {
    if (this.readyState === nextReadyState) {
      return
    }

    this.readyState = nextReadyState
    this.onReadyStateChange?.call(this)
  }
}
