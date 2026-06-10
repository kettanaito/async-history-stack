import { HistoryStack } from '../src/history-stack'
import { createTypewriter } from './utils'

it('rejects the push whose apply function throws', async () => {
  const history = new HistoryStack({ limit: 5 })

  await expect(
    history.push(() => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')
})

it('recovers after a push whose apply function throws', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await expect(
    history.push(() => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')

  await expect(history.push(writer.type('o'))).resolves.toBeUndefined()
  expect(writer.word).toBe('o')

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')
})

it('removes the entry whose apply function throws from the history', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('o'))

  await expect(
    history.push(() => {
      throw new Error('boom')
    }),
  ).rejects.toThrow('boom')

  expect(history.size).toBe(1)

  await expect(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')

  await expect(
    history.undo(),
    'Must have nothing to undo past the only valid entry',
  ).resolves.toBe(false)
})
