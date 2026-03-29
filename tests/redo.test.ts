import { setTimeout } from 'node:timers/promises'
import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('resolves to false if there is nothing to undo', async () => {
  const history = new HistoryStack({ limit: 5 })
  await expect(history.redo()).resolves.toBe(false)
})

it('resolves to false if there is a single entry', async () => {
  const history = new HistoryStack({ limit: 5 })
  await history.push(() => () => {})
  await expect(history.redo()).resolves.toBe(false)
})

it('redoes a series of changes', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))
  expect(writer.word).toBe('one')

  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')

  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('o')

  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('on')

  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('one')

  await expect
    .soft(history.redo(), 'Must not redo when at the end')
    .resolves.toBe(false)
  expect(writer.word).toBe('one')
})

it('aborts a pending redo redo when undo is fired', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()
  const redoAbortListener = vi.fn()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(async ({ signal }) => {
    signal.addEventListener('abort', redoAbortListener)
    return writer.type('e')({ signal })
  })

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('on')
  expect(redoAbortListener).not.toHaveBeenCalled()

  // Let's try to redo the last "e". Intentionally unawaited.
  const pendingRedo = history.redo()

  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('o')

  await expect.soft(pendingRedo).resolves.toBe(false)
  expect.soft(redoAbortListener).toHaveBeenCalledOnce()
  expect.soft(writer.word).toBe('o')
})

it('chains multiple synchronous redos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const setter = vi.fn<(n: number) => void>()
  const abortListener = vi.fn()

  await history.push(({ signal }) => {
    signal.addEventListener('abort', abortListener)
    setter(1)
    return () => setter(0)
  })
  await history.push(({ signal }) => {
    signal.addEventListener('abort', abortListener)
    setter(2)
    return () => setter(1)
  })
  await history.push(({ signal }) => {
    signal.addEventListener('abort', abortListener)
    setter(3)
    return () => setter(2)
  })

  setter.mockClear()

  await history.undo()
  await history.undo()
  await history.undo()

  expect(setter.mock.calls).toEqual([[2], [1], [0]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()

  setter.mockClear()

  await expect
    .soft(Promise.all([history.redo(), history.redo(), history.redo()]))
    .resolves.toEqual([true, true, true])
  expect(setter.mock.calls).toEqual([[1], [2], [3]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()
})

it('chains multiple asynchronous redo', async () => {
  const history = new HistoryStack({ limit: 5 })
  const setter = vi.fn<(n: number) => void>()
  const abortListener = vi.fn()

  await history.push(async ({ signal }) => {
    signal.addEventListener('abort', abortListener)
    await setTimeout(5)
    setter(1)
    return () => setter(0)
  })
  await history.push(async ({ signal }) => {
    signal.addEventListener('abort', abortListener)
    await setTimeout(10)
    setter(2)
    return () => setter(1)
  })
  await history.push(async ({ signal }) => {
    signal.addEventListener('abort', abortListener)
    await setTimeout(5)
    setter(3)
    return () => setter(2)
  })

  setter.mockClear()

  await history.undo()
  await history.undo()
  await history.undo()

  expect(setter.mock.calls).toEqual([[2], [1], [0]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()

  setter.mockClear()

  await expect(
    Promise.all([history.redo(), history.redo(), history.redo()]),
  ).resolves.toEqual([true, true, true])
  expect(setter.mock.calls).toEqual([[1], [2], [3]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()
})

it('ignores out-of-bounds redos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))

  // No changes when there's nothing to redo.
  await expect(history.redo()).resolves.toBe(false)
  await expect(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('one')

  await history.undo()
  await history.undo()
  expect(writer.word).toBe('o')

  await expect(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('on')

  await expect(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('one')

  await expect(history.redo()).resolves.toBe(false)
  await expect(history.redo()).resolves.toBe(false)
  await expect(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('one')
})

it('redoes after multiple out-of-bounds undos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))
  expect(writer.word).toBe('one')

  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(false)
  await expect(history.undo()).resolves.toBe(false)

  await expect(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('o')

  await expect(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('on')

  await expect(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('one')
})
