import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('executes the pushed entry immediately', async () => {
  const history = new HistoryStack({ limit: 5 })
  let value = 0

  await history.push(() => {
    value = 1
    return () => {}
  })

  expect(value).toBe(1)
})

it('batches multiple pushes into a single push', async () => {
  const history = new HistoryStack({ limit: 5, autoMergeWithin: 250 })
  const writer = createTypewriter()

  await Promise.all([
    history.push(writer.type('o')),
    history.push(writer.type('n')),
    history.push(writer.type('e')),
  ])

  expect(history.size).toBe(1)
  expect(writer.word).toBe('one')
})

it('resolves every batched push after the batch has been applied', async () => {
  const history = new HistoryStack({ limit: 5, autoMergeWithin: 10 })
  let value = 0

  const firstPush = history.push(() => {
    value = 1

    return () => {}
  })
  const secondPush = history.push(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })

    value = 2

    return () => {}
  })
  const thirdPush = history.push(() => {
    value = 3

    return () => {}
  })

  await secondPush
  expect(value).toBe(3)

  await firstPush
  await thirdPush
})

it('cancels a pending batch when the stack is cleared with abort', async () => {
  const history = new HistoryStack({ limit: 5, autoMergeWithin: 10 })
  let value = 0

  const pendingPush = history.push(() => {
    value = 1

    return () => {}
  })

  history.clear(true)

  await pendingPush

  expect(value).toBe(0)
  expect(history.size).toBe(0)
})
