import { type HistoryStackApplyFunction } from '../src/history-stack'

export function createTypewriter() {
  let word = ''

  return {
    get word() {
      return word
    },
    type(value: string): HistoryStackApplyFunction {
      return () => {
        word += value

        return () => {
          word = word.slice(0, -1)
        }
      }
    },
  }
}
