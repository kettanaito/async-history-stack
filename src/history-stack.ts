import { invariant } from 'outvariant'

export interface HistoryStackInit {
  /**
   * Maximum number of history entries.
   */
  limit: number

  /**
   * Duration of the batch window (ms).
   * Any entry pushes within that window will be batched
   * into a single history entry.
   * @default 0
   */
  batchWindow?: number
}

export class HistoryStack {
  #stack: Array<HistoryStackEntry>
  #size: number
  #position: number
  #pendingExecution?: {
    command: 'apply' | 'revert'
    entry: HistoryStackEntry
    promise: Promise<boolean>
  }
  #latestTimestamp: number
  #batchWindow: number
  #pendingBatch: Array<HistoryStackApplyFunction>
  #batchTimer?: number
  #batchPromise: PromiseWithResolvers<void>

  constructor(init: HistoryStackInit) {
    this.#size = init.limit
    this.#batchWindow = init.batchWindow ?? 0

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
    if (abortPending) {
      this.#pendingExecution?.entry.abort()
      this.#pendingExecution = undefined
    }

    this.#stack.length = 0
    this.#latestTimestamp = 0
  }

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
    console.log('HistoryStack.undo()', this.#stack, this.#position)

    if (this.#stack.length === 0) {
      console.log('> stack is empty, nothing to undo!')
      return false
    }

    // Wait for the redo to decrease the position, otherwise ignore.
    if (this.#position === this.#stack.length) {
      console.log('> position out of bounds, nothing to undo!')
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
    console.log('HistoryStack.redo()', this.#stack)

    if (this.#stack.length === 0) {
      console.log('> stack is empty, nothing to redo!')
      return false
    }

    // Prevent the position from going lower than -1.
    this.#position = Math.max(-1, this.#position - 1)

    // Wait for undo to increase the position, otherwise ignore.
    if (this.#position === -1) {
      console.log('> position out of bounds, nothing to redo!')
      return false
    }

    console.log('> redoing at', this.#position)
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

    console.log('HistoryStack.push()', entry, this.#stack)

    // Reset to the start of the stack and execute the new entry immediately.
    this.#position = 0

    await this.#execute('apply', this.#position)
  }

  async #execute(
    command: 'apply' | 'revert',
    position: number,
  ): Promise<boolean> {
    console.log('HistoryStack.#execute()', command, position)

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
        console.log(
          '> chaining to pending entry',
          this.#pendingExecution.entry.id,
        )

        // Handle a skipped entry when another entry tries to chain after it.
        if (this.#pendingExecution.entry.skipped) {
          this.#stack.splice(
            this.#stack.indexOf(this.#pendingExecution.entry),
            1,
          )
        }

        const previousPromise = this.#pendingExecution.promise
        const chainedPromise = previousPromise.then(async (completed) => {
          console.log(
            '> previous entry completed, success?',
            completed,
            'now executing',
            entry.id,
          )

          return completed
            ? command === 'apply'
              ? entry.apply()
              : entry.revert()
            : false
        })

        this.#pendingExecution = { command, entry, promise: chainedPromise }
        return chainedPromise
      }

      if (this.#pendingExecution.entry.readyState !== HistoryStackEntry.DONE) {
        console.log(
          '> aborting different command',
          this.#pendingExecution.command,
        )

        this.#pendingExecution.entry.abort()
      }
    }

    console.log('> executing entry immediately', entry.id)
    const promise = command === 'apply' ? entry.apply() : entry.revert()
    this.#pendingExecution = { command, entry, promise }

    // Handle a skipped entry when it's the only one in the stack.
    promise.then(() => {
      if (entry.skipped) {
        // Delete history entries that were skipped
        // (i.e. returned `null` instead of the revert function).
        this.#stack.splice(position, 1)
      }
    })

    return promise
  }
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
          pendingResult.resolve(!this.#controller?.signal.aborted)
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
        pendingResult.resolve(!this.#controller?.signal.aborted)
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
      this.#controller = null
      this.#setReadyState(HistoryStackEntry.DONE)
    })
  }

  public abort(): void {
    console.log(
      this.id,
      'HistoryStackEntry.abort()',
      this.readyState,
      this.#controller,
    )
    console.log(new Error().stack)

    this.aborted = true
    this.#controller?.abort()
  }

  async #revert(): Promise<boolean> {
    const revertFn = this.#revertFn

    if (!revertFn) {
      return false
    }

    const pendingResult = Promise.withResolvers<boolean>()

    await Promise.try(async () => {
      this.#controller = new AbortController()

      return revertFn({ signal: this.#controller.signal })
    }).finally(() => {
      console.log(
        this.id,
        '> revert done! aborted?',
        this.#controller?.signal.aborted,
      )
      pendingResult.resolve(!this.#controller?.signal.aborted)
    })

    return pendingResult.promise
  }

  #setReadyState(nextReadyState: HistoryStackReadyState): void {
    console.log(
      this.id,
      'HistoryStackEntry.#setReadyState():',
      this.readyState,
      '->',
      nextReadyState,
    )

    if (this.readyState === nextReadyState) {
      return
    }

    this.readyState = nextReadyState
    this.onReadyStateChange?.call(this)
  }
}
