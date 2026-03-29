import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('skips a single entry', async () => {
  const history = new HistoryStack({ limit: 5 })

  await history.push(() => null)

  expect.soft(history.size).toBe(0)
  expect.soft(history.timestamp).toBe(0)
  await expect.soft(history.undo()).resolves.toBe(false)
  await expect.soft(history.redo()).resolves.toBe(false)
})

it('skips an entry in the list of other entries', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(writer.type('1'))
  await history.push(() => null)
  await history.push(writer.type('3'))

  expect.soft(history.size).toBe(2)
  expect(writer.word).toBe('13')

  // Undoing the changes ignores the skipped entry.
  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('1')
  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')
  await expect.soft(history.undo()).resolves.toBe(false)
  expect(writer.word).toBe('')

  // Redoing the changes ignores the skipped entry.
  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('1')
  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('13')
  await expect.soft(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('13')
})

it('respects skippable entries when composing entries', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(
    history.merge(writer.type('1'), () => null, writer.type('3')),
  )

  expect.soft(history.size).toBe(1)
  expect.soft(writer.word).toBe('13')

  // Undoing the changes ignores the skipped entry.
  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')
  await expect.soft(history.undo()).resolves.toBe(false)
  expect(writer.word).toBe('')

  // Redoing the changes ignores the skipped entry.
  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('13')
  await expect.soft(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('13')
})
