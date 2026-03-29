import { HistoryStack } from '../src'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2023-01-01T00:00:00.000Z'))
})

afterAll(() => {
  vi.useRealTimers()
})

it('returns 0 if no changes have occurred', async () => {
  const history = new HistoryStack({ limit: 5 })
  expect(history.timestamp).toBe(0)
})

it('returns 0 after the history has been cleared', async () => {
  const history = new HistoryStack({ limit: 5 })
  await history.push(() => () => {})
  expect(history.timestamp).toBe(1672531200000)

  history.clear()
  expect(history.timestamp).toBe(0)
})

it('returns the timestamp of the latest completed change', async () => {
  const history = new HistoryStack({ limit: 5 })
  await history.push(() => () => {})
  expect(history.timestamp).toBe(1672531200000)

  vi.advanceTimersByTime(500)
  expect(history.timestamp).toBe(1672531200000)

  await history.push(() => () => {})
  expect(history.timestamp).toBe(1672531200500)
})
