# ahsl

Arbitrary History Stack Library.

## Motivation

It seems that most undo/redo tools are coupled with state management or rich editor libraries. It's natural to assume something like a change history should live next to your state. That assumption works great when all your state _lives in one place_ and all the side effects related to state changes are _coupled with those changes_. In practice, that's not always the case. Third-party libraries can introduce their own state (think a rich editor) and it's not always best to try to unify it. Sometimes state works best being partial, such as the list of uploaded images only containing references to those images while the files themselves live in the file system, and changes to the state alone are insufficient to describe what actually happens when uploading a file.

Here, an argument can be made that a state change function must include any related side effects within it, which is also not always viable. Not every state change is triggered by the client (e.g. the main process already uploaded an image and only sends the reference to the client) and not all side effects are directly related to the state change (e.g. you might want to trigger a navigation, or any other UI transition, when undoing certain changes).

That's only scratching the architectural surface. There are a ton of practical aspects to traversing the change history, such as asynchronicity, cancellation, merging, batching, that are incomplete or entirely missing in the tools I could find. So I built my own.

## Getting started

```sh
npm i ahsl
```

This library works by introducing a singleton that tracks the change history and allows its traversal.

```ts
// src/history.ts
import { HistoryStack } from 'ahsl'

export const historyStack = new HistoryStack({
  limit: 100
})
```

You register changes by pushing them to the `historyStack`. Every change is described as the _apply function_ that returns the _revert function_. Upon push, the apply function is invoked immediately for convenience. When the change is undone, the revert function is called and the two _switch places_ to reflect the traversal order (undoing a revert is the same as applying the change).

```ts
await historyStack.push(() => {
  applyChanges()

  return () => {
    revertChanges()
  }
})
```

Here's an example of using the history stack to delete an image from the image detail route:

```tsx
import { historyStack } from './history'

export async function deleteImage(imageId: string) {
  await historyStack.push(async () => {
    await router.navigate({ to: '/images' })
    
    // Signal the main process to delete the image from disk.
    await rpc.deleteImage(imageId)
    
    // Delete the image record from the state.
    deleteImageRef(imageId)

    return async () => {
      // Undo the image deletion (i.e. re-upload the image).
      const ref = await rpc.uploadImage(imageId)
      addImageRef(ref)
      
      // Go back to the relevant image detail page.
      await router.navigate({ to: '/images/$imageId', params: { imageId } })
    }
  })
}
```

## API

### `new HistoryStack(options)`

- `options`:
  - `limit`, `number`, the maximum number of entries in this stack;
  - `autoMergeWithin`, `number` (default: `0`), automatically merge history entries pushed within the given window (ms). Handy when changes trigger often (e.g. typing into a rich text editor).

#### `.push()`

Register a new history entry. Accepts the apply function that returns the revert function. Automatically invokes the apply function for convenience.

```ts
await historyStack.push(async ({ signal }) => {
  return async ({ signal }) => {}
})
```

Both the apply and revert functions can be synchronous and asynchronous. Both functions also accept a `signal` that will be aborted when a change transition is cancelled (e.g. when reverting the change while apply is in progress). Utilize this by providing the `signal` to the APIs that natively support it, like `fetch` or web streams, and listen to its `signal.aborted` to abort your custom logic otherwise.

#### `.merge()`

Merge multiple history entries into one. Handy for expressing complex changes that must be applied/reverted as a single entry.

```ts
await historyStack.push(
  historyStack.merge(
    async () => {
      await action()
      return async () => await revertAction()
    },
    () => {
      sideEffect()
      return () => revertSideEffect()
    },
  )
)
```

#### `.undo()`

Undo the latest change. Returns `true` if the change has been undone, `false` otherwise.

#### `.redo()`

Redo the latest previous change. Returns `true` if the change has been redone, `false` otherwise.

#### `.clear()`

Clear the history stack. Accepts an optional boolean argument to abort any in-flight changes.

```ts
historyStack.clear()

// Clear the stack and abort any pending changes.
historyStack.clear(true)
```

#### `.size`

Total count of all history entries in this stack.

#### `.timestamp`

Timestamp of the latest completed change. Handy for deriving state like `isDirty`.

## Recipes

### Revert-friendly state transitions

Consider returning a revert function from your state change functions:

```ts
// src/stores/images.ts
export function addImageRef(imageRef) {
  imagesStore.setState((refs) => {
    refs.push(imageRef)
  })
  
  return () => {
    imagesStore.setState((refs) => {
      refs.splice(refs.indexOf(imageRef), 1)
    })
  }
}
```

This way, apply/revert are collocated under a single transition and don't have to be described separately.

```ts
await historyStack.push(() => addImageRef(ref))

// This works well with merged entries, too.
await historyStack.push(
  historyStack.merge(
    async () => await rpc.uploadImage(imageId),
    () => addImageRef(ref),
  )
)
```
