import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('merges multiple entries into one', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(
    history.merge(writer.type('1'), writer.type('2'), writer.type('3')),
  )

  expect(writer.word).toBe('123')
  expect(history.size).toBe(1)

  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')
  await expect.soft(history.undo()).resolves.toBe(false)
  expect(writer.word).toBe('')

  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('123')
  await expect.soft(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('123')
})

it('merges regular and composed entries', async () => {
  const history = new HistoryStack({ limit: 5 })
  const writer = createTypewriter()

  await history.push(history.merge(writer.type('1'), writer.type('2')))
  await history.push(writer.type('3'))

  expect(writer.word).toBe('123')
  expect(history.size).toBe(2)

  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('12')
  await expect.soft(history.undo()).resolves.toBe(true)
  expect(writer.word).toBe('')
  await expect.soft(history.undo()).resolves.toBe(false)
  expect(writer.word).toBe('')

  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('12')
  await expect.soft(history.redo()).resolves.toBe(true)
  expect(writer.word).toBe('123')
  await expect.soft(history.redo()).resolves.toBe(false)
  expect(writer.word).toBe('123')
})
