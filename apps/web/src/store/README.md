# State Management (Zustand)

This project uses [Zustand](https://zustand.docs.pmnd.rs/) for global state management.

## Architecture: Global Singleton vs Context

We currently use the **Global Singleton Store** pattern.

```typescript
// apps/web/src/store/useNotesStore.ts
export const useNotesStore = create<NotesState>((set) => ({ ... }))
```

### Why this pattern?
The [Next.js Zustand Guide](https://zustand.docs.pmnd.rs/guides/nextjs) recommends the **Context Provider** pattern to ensure data isolation during Server-Side Rendering (SSR). However, we chose the **Global Singleton** pattern because:
1. **Client-Side Fetching**: Our app fetches data entirely on the client (inside `useEffect`), so there is no risk of sharing state between server requests.
2. **Simplicity**: It avoids the boilerplate of Providers and Context wrappers.
3. **DX**: It allows using the store/hooks anywhere without worrying about the React tree (e.g., inside other hooks or non-component utilities).

> [!NOTE]
> If we move to **Server-Side Rendering (SSR)** where we pre-fill the store with data on the server, we **MUST** refactor this to the Context Provider pattern to prevent cross-request state leakage.

## How to Use

### 1. Consuming State
In any component:
```tsx
import { useNotesStore } from '@/store/useNotesStore';

function MyComponent() {
  const { notes, searchQuery } = useNotesStore();
  // ...
}
```

### 2. Dispatching Actions
Actions are part of the hook:
```tsx
const { setNotes, setSelectedNote } = useNotesStore();

const handleUpdate = (data) => {
  setNotes(data);
};
```

### 3. Subscribing to Changes (Outside React)
You can subscribe to changes or access state outside of React components:
```ts
import { useNotesStore } from '@/store/useNotesStore';

// Get current state
const state = useNotesStore.getState();

// Listen for updates
useNotesStore.subscribe((state, prevState) => {
    if (state.refreshTrigger !== prevState.refreshTrigger) {
        console.log("Refreshed!");
    }
});
```

## Adding New Slice/Feature
To add new state (e.g., `userPreferences`):
1. Update `NotesState` interface in `useNotesStore.ts`.
2. Add initial value and actions to the `create` function.
