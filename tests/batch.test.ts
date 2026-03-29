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
