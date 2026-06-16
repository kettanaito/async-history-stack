import { setTimeout } from 'node:timers/promises'
import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('returns false for an empty stack', () => {
  const history = new HistoryStack({ limit: 5 })
  expect(history.canRedo()).toBe(false)
})

it('returns false while every change is still applied', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  expect(history.canRedo()).toBe(false)
})

it('returns true after a change has been undone', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.undo()
  expect(history.canRedo()).toBe(true)
})

it('returns false once every change has been redone', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))

  await history.undo()
  await history.undo()
  expect(history.canRedo()).toBe(true)

  await history.redo()
  expect(history.canRedo()).toBe(true)

  await history.redo()
  expect(history.canRedo()).toBe(false)
})

it('returns false while the initial apply is still pending', async () => {
  const history = new HistoryStack({ limit: 5 })

  // A pending initial apply is not yet applied, but it cannot be redone.
  const pendingPush = history.push(async () => {
    await setTimeout(20)
    return () => {}
  })

  expect(history.canRedo()).toBe(false)

  await pendingPush
  expect(history.canRedo()).toBe(false)
})

it('returns false while a change is being reverted', async () => {
  const history = new HistoryStack({ limit: 5 })

  await history.push(() => {
    return async () => {
      await setTimeout(20)
    }
  })

  // The revert is in flight: the entry is neither fully reverted nor redoable yet.
  const pendingUndo = history.undo()
  expect(history.canRedo()).toBe(false)

  await pendingUndo
  expect(history.canRedo()).toBe(true)
})

it('returns true after a redo is aborted by an undo', async () => {
  const history = new HistoryStack({ limit: 5 })

  // Slow apply so the redo (which re-runs it) can be aborted mid-flight.
  await history.push(async () => {
    await setTimeout(20)
    return () => {}
  })
  await history.undo()
  expect(history.canRedo()).toBe(true)

  // Start the slow redo, then abort it with an undo.
  const pendingRedo = history.redo()
  await setTimeout(5)
  const pendingUndo = history.undo()

  await Promise.all([pendingRedo, pendingUndo])
  // Let the aborted apply fully settle.
  await setTimeout(25)

  // The redo never completed, so the change stays reverted and redoable.
  expect(history.canRedo()).toBe(true)
})

it('ignores skipped entries', async () => {
  const history = new HistoryStack({ limit: 5 })

  // An entry that returns `null` is skipped and pending removal.
  await history.push(() => null)
  expect(history.canRedo()).toBe(false)
})

it('returns false after pushing a new change clears the redo branch', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.undo()
  expect(history.canRedo()).toBe(true)

  // Pushing discards the entries ahead of the current position.
  await history.push(writer.type('x'))
  expect(history.canRedo()).toBe(false)
})
