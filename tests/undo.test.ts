import { setTimeout } from 'node:timers/promises'
import {
  HistoryStack,
  type HistoryStackRevertFunction,
} from '../src/history-stack'
import { createTypewriter } from './utils'

it('resolves to false if there is nothing to undo', async () => {
  const history = new HistoryStack({ limit: 5 })
  await expect(history.undo()).resolves.toBe(false)
})

it('undoes a series of changes', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))
  expect(writer.word).toBe('one')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('on')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('o')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')

  await expect(history.undo(), 'Must not undo when at the end').resolves.toBe(
    false,
  )
  expect(writer.word).toBe('')
})

it('aborts a pending change upon undo', async () => {
  let value = 0
  const history = new HistoryStack({ limit: 5 })
  const revertListener = vi.fn<HistoryStackRevertFunction>(() => {
    value = 2
  })
  const undoAbortListener = vi.fn(() => (value = -1))

  history.push(async ({ signal }) => {
    signal.addEventListener('abort', undoAbortListener)
    await setTimeout(50)

    if (!signal.aborted) {
      value = 1
    }

    return revertListener
  })

  await expect
    .soft(
      history.undo(),
      'Must not mark undo as complete since revert was not called',
    )
    .resolves.toBe(false)
  expect.soft(undoAbortListener).toHaveBeenCalledOnce()
  expect(
    revertListener,
    'Must not revert aborted change',
  ).not.toHaveBeenCalled()
  expect.soft(value, 'Must not apply the aborted change').toBe(-1)
})

it('chains multiple synchronous undos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const setter = vi.fn<(n: number) => void>()
  const abortListener = vi.fn()

  await history.push(() => {
    setter(1)
    return ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      setter(0)
    }
  })
  await history.push(() => {
    setter(2)
    return ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      setter(1)
    }
  })
  await history.push(() => {
    setter(3)
    return ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      setter(2)
    }
  })

  expect(setter).toHaveBeenNthCalledWith(1, 1)
  expect(setter).toHaveBeenNthCalledWith(2, 2)
  expect(setter).toHaveBeenNthCalledWith(3, 3)
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()

  setter.mockClear()

  await expect
    .soft(Promise.all([history.undo(), history.undo(), history.undo()]))
    .resolves.toEqual([true, true, true])
  expect(setter.mock.calls).toEqual([[2], [1], [0]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()
})

it('chains multiple async undos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const setter = vi.fn<(n: number) => void>()
  const abortListener = vi.fn()

  await history.push(() => {
    setter(1)
    return async ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      await setTimeout(5)
      setter(0)
    }
  })
  await history.push(() => {
    setter(2)
    return async ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      await setTimeout(10)
      setter(1)
    }
  })
  await history.push(() => {
    setter(3)
    return async ({ signal }) => {
      signal.addEventListener('abort', abortListener)
      await setTimeout(5)
      setter(2)
    }
  })

  expect(setter.mock.calls).toEqual([[1], [2], [3]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()

  setter.mockClear()

  await expect
    .soft(Promise.all([history.undo(), history.undo(), history.undo()]))
    .resolves.toEqual([true, true, true])
  expect(setter.mock.calls).toEqual([[2], [1], [0]])
  expect(setter).toHaveBeenCalledTimes(3)
  expect(abortListener).not.toHaveBeenCalled()
})

it('ignores out-of-bounds undos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))

  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')

  // No changes when there's nothing to redo.
  await expect(history.undo()).resolves.toBe(false)
  await expect(history.undo()).resolves.toBe(false)
  await expect(history.undo()).resolves.toBe(false)
  expect(writer.word).toBe('')
})

it('undoes after multiple out-of-bounds redos', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))
  await history.push(writer.type('n'))
  await history.push(writer.type('e'))

  await expect(history.redo()).resolves.toBe(false)
  await expect(history.redo()).resolves.toBe(false)
  await expect(history.redo()).resolves.toBe(false)

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('on')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('o')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')

  await expect(history.undo()).resolves.toBe(false)
  await expect(history.undo()).resolves.toBe(false)
})
