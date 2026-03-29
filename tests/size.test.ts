import { HistoryStack } from '../src'

it('returns 0 for the empty stack', () => {
  expect(new HistoryStack({ limit: 5 }).size).toBe(0)
})

it('returns the total count the stack entries', () => {
  const history = new HistoryStack({ limit: 5 })

  history.push(() => () => {})
  expect(history.size).toBe(1)

  history.push(() => () => {})
  history.push(() => () => {})
  expect(history.size).toBe(3)
})

it('returns 0 after the history has been cleared', () => {
  const history = new HistoryStack({ limit: 5 })

  history.push(() => () => {})
  history.push(() => () => {})
  history.clear()

  expect(history.size).toBe(0)
})
