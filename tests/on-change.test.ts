import { HistoryStack } from '../src'
import { createTypewriter } from './utils'

it('fires the callback on changes to the stack', async () => {
  const onChange = vi.fn()
  const history = new HistoryStack({
    limit: 5,
    onChange,
  })
  const writer = createTypewriter()

  await history.push(writer.type('1'))
  expect(onChange).toHaveBeenCalledOnce()

  await history.undo()
  expect(onChange).toHaveBeenCalledTimes(2)

  await history.redo()
  expect(onChange).toHaveBeenCalledTimes(3)
})

it('does not fire the callback on clearing the stack', async () => {
  const onChange = vi.fn()
  const history = new HistoryStack({
    limit: 5,
    onChange,
  })
  history.clear()

  expect(onChange).not.toHaveBeenCalled()
})

it('does not fire the callback if the entry is skipped', async () => {
  const onChange = vi.fn()
  const history = new HistoryStack({
    limit: 5,
    onChange,
  })

  await history.push(() => null)
  expect(onChange).not.toHaveBeenCalled()
})
