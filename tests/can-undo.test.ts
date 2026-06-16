import { setTimeout } from 'node:timers/promises'
import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('returns false for an empty stack', () => {
  const history = new HistoryStack({ limit: 5 })
  expect(history.canUndo()).toBe(false)
})

it('returns true after a change has been applied', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  expect(history.canUndo()).toBe(true)
})

it('returns false once every change has been undone', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))

  await history.undo()
  expect(history.canUndo()).toBe(true)

  await history.undo()
  expect(history.canUndo()).toBe(false)
})

it('returns true again after a change has been redone', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.undo()
  expect(history.canUndo()).toBe(false)

  await history.redo()
  expect(history.canUndo()).toBe(true)
})

it('returns false while the initial apply is still pending', async () => {
  const history = new HistoryStack({ limit: 5 })

  // Slow apply: the change is not in effect until it settles.
  const pendingPush = history.push(async () => {
    await setTimeout(20)
    return () => {}
  })

  expect(history.canUndo()).toBe(false)

  await pendingPush
  expect(history.canUndo()).toBe(true)
})

it('keeps returning true while a change is being reverted', async () => {
  const history = new HistoryStack({ limit: 5 })

  await history.push(() => {
    return async () => {
      await setTimeout(20)
    }
  })

  // The revert is in flight; the change is still applied until it settles.
  const pendingUndo = history.undo()
  expect(history.canUndo()).toBe(true)

  await pendingUndo
  expect(history.canUndo()).toBe(false)
})

it('returns true after an undo is aborted by a redo', async () => {
  const history = new HistoryStack({ limit: 5 })

  await history.push(() => () => {})
  await history.push(() => {
    // Slow revert so the undo can be aborted mid-flight.
    return async () => {
      await setTimeout(20)
    }
  })

  // Start the slow undo of the top entry, then abort it with a redo.
  const pendingUndo = history.undo()
  await setTimeout(5)
  const pendingRedo = history.redo()

  await Promise.all([pendingUndo, pendingRedo])
  // Let any aborted execution fully settle.
  await setTimeout(25)

  // The top entry's revert was aborted, so its change is still applied.
  expect(history.canUndo()).toBe(true)
})

it('ignores skipped entries', async () => {
  const history = new HistoryStack({ limit: 5 })

  // An entry that returns `null` is skipped and pending removal.
  await history.push(() => null)
  expect(history.canUndo()).toBe(false)
})

it('returns false after the stack is cleared', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  expect(history.canUndo()).toBe(true)

  history.clear()
  expect(history.canUndo()).toBe(false)
})
