---
layout: post
title: "Vue 3 Composition API Best Practice Patterns"
date: 2025-02-15
categories: [frontend]
author: Zhou Xunyou
lang: en
---

Vue 3's Composition API is a fundamental redesign of the Options API, offering more flexible logic organization and reuse. This article explores the design patterns, reactivity system internals, TypeScript integration, and practical migration strategies from the Options API.

## Why the Composition API

The core problem with the Options API is **scattered logic**. Code for a single feature is split across `data`, `computed`, `methods`, `watch`, and other options:

```javascript
// Options API: search feature code is scattered everywhere
export default {
  data() {
    return {
      query: '',
      results: [],
      loading: false,
      // other features' data...
      currentPage: 1,
      pageSize: 10,
    };
  },
  computed: {
    filteredResults() { /* ... */ },
    // other features' computed...
  },
  methods: {
    async search() { /* ... */ },
    // other features' methods...
  },
  watch: {
    query(val) { /* ... */ },
    // other features' watch...
  },
};
```

The Composition API lets you keep all logic for one feature together:

```javascript
// Composition API: all search logic in one place
function useSearch() {
  const query = ref('');
  const results = ref([]);
  const loading = ref(false);

  async function search() {
    loading.value = true;
    results.value = await fetchResults(query.value);
    loading.value = false;
  }

  watch(query, debounce(search, 300));

  return { query, results, loading, search };
}

// Usage
export default {
  setup() {
    const search = useSearch();
    const pagination = usePagination();
    return { ...search, ...pagination };
  },
};
```

## Reactivity System Internals

### Proxy-based Reactivity

Vue 3 uses ES6 Proxy instead of Vue 2's `Object.defineProperty`:

```javascript
// Vue 2 limitations
const obj = {};
Object.defineProperty(obj, 'name', {
  get() { /* ... */ },
  set(val) { /* ... */ },
});
// Cannot detect: new properties, array index changes, array length changes

// Vue 3 Proxy approach
const reactive = (target) => {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key); // Collect dependencies
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      const result = Reflect.set(target, key, value, receiver);
      if (oldValue !== value) {
        trigger(target, key); // Trigger updates
      }
      return result;
    },
    deleteProperty(target, key) {
      const hadKey = key in target;
      const result = Reflect.deleteProperty(target, key);
      if (hadKey) {
        trigger(target, key); // Detect property deletion
      }
      return result;
    },
  });
};
```

### Choosing Between ref and reactive

```javascript
import { ref, reactive, toRefs } from 'vue';

// ref: for primitives and values that need reassignment
const count = ref(0);
const user = ref({ name: 'Alice' });
user.value = { name: 'Bob' }; // Whole replacement is fine

// reactive: for complex objects that won't be reassigned
const state = reactive({
  users: [],
  loading: false,
  filters: { status: 'active' },
});
state.users.push(newUser); // Direct mutation
// state = { users: [] }; // Wrong! Cannot replace entire object

// Best practice: prefer ref in composables
function useUser() {
  const user = ref(null); // Starts null, gets assigned later
  const loading = ref(false);

  async function fetchUser(id) {
    loading.value = true;
    user.value = await api.getUser(id); // Whole replacement OK
    loading.value = false;
  }

  return { user, loading, fetchUser };
}

// Destructuring reactive objects loses reactivity — use toRefs
const state = reactive({ name: 'Alice', age: 30 });
const { name, age } = toRefs(state); // Preserves reactivity
```

## Composable Function Design Patterns

### Basic Pattern

```typescript
// composables/useFetch.ts
import { ref, shallowRef, watchEffect, type Ref } from 'vue';

interface UseFetchOptions<T> {
  immediate?: boolean;
  initialValue?: T;
  refetch?: boolean;
}

interface UseFetchReturn<T> {
  data: Ref<T | undefined>;
  error: Ref<Error | null>;
  loading: Ref<boolean>;
  execute: () => Promise<void>;
}

export function useFetch<T>(
  url: Ref<string> | string,
  options: UseFetchOptions<T> = {}
): UseFetchReturn<T> {
  const data = shallowRef<T | undefined>(options.initialValue);
  const error = ref<Error | null>(null);
  const loading = ref(false);

  const execute = async () => {
    loading.value = true;
    error.value = null;
    try {
      const resolvedUrl = typeof url === 'string' ? url : url.value;
      const response = await fetch(resolvedUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data.value = await response.json();
    } catch (e) {
      error.value = e as Error;
    } finally {
      loading.value = false;
    }
  };

  if (options.immediate !== false) {
    execute();
  }

  if (options.refetch && typeof url !== 'string') {
    watchEffect(() => { execute(); });
  }

  return { data, error, loading, execute };
}
```

### Async State Management Pattern

```typescript
// composables/useAsyncState.ts
import { ref, computed, type Ref } from 'vue';

interface State<T> {
  data: T | null;
  error: Error | null;
  status: 'idle' | 'loading' | 'success' | 'error';
}

export function useAsyncState<T>(
  promiseFn: () => Promise<T>,
  initialValue: T | null = null
) {
  const state = ref<State<T>>({
    data: initialValue,
    error: null,
    status: 'idle',
  });

  const isLoading = computed(() => state.value.status === 'loading');
  const isError = computed(() => state.value.status === 'error');
  const isSuccess = computed(() => state.value.status === 'success');

  async function execute() {
    state.value.status = 'loading';
    state.value.error = null;
    try {
      state.value.data = await promiseFn();
      state.value.status = 'success';
    } catch (e) {
      state.value.error = e as Error;
      state.value.status = 'error';
    }
  }

  function reset() {
    state.value = { data: initialValue, error: null, status: 'idle' };
  }

  return {
    state,
    data: computed(() => state.value.data),
    error: computed(() => state.value.error),
    isLoading,
    isError,
    isSuccess,
    execute,
    reset,
  };
}
```

### Event Bus Pattern

```typescript
// composables/useEventBus.ts
type Handler<T = void> = (payload: T) => void;

export function useEventBus<T = void>() {
  const handlers = new Set<Handler<T>>();

  function on(handler: Handler<T>) {
    handlers.add(handler);
    return () => handlers.delete(handler); // Return unsubscribe function
  }

  function emit(payload: T) {
    handlers.forEach(handler => handler(payload));
  }

  function once(handler: Handler<T>) {
    const wrapped: Handler<T> = (payload) => {
      handler(payload);
      handlers.delete(wrapped);
    };
    handlers.add(wrapped);
  }

  return { on, emit, once };
}

// Usage
const bus = useEventBus<{ type: string; payload: any }>();
const off = bus.on((event) => console.log(event));
bus.emit({ type: 'user:login', payload: { id: 1 } });
off(); // Unsubscribe
```

## TypeScript Integration

### Typed Props and Emits

```typescript
// Recommended: use type declarations instead of runtime declarations
<script setup lang="ts">
interface Props {
  title: string;
  count?: number;
  items: Array<{ id: number; name: string }>;
  status: 'active' | 'inactive';
}

interface Emits {
  (e: 'update', id: number): void;
  (e: 'delete', id: number): void;
}

const props = withDefaults(defineProps<Props>(), {
  count: 0,
  status: 'active',
});

const emit = defineEmits<Emits>();

// Generic components
defineOptions({ inheritAttrs: false });
</script>
```

### Typed provide/inject

```typescript
// types.ts
import type { InjectionKey, Ref } from 'vue';

export interface UserInfo {
  id: number;
  name: string;
  role: 'admin' | 'user';
}

export const UserKey: InjectionKey<Ref<UserInfo>> = Symbol('user');

// Provider.vue
<script setup lang="ts">
import { provide, ref } from 'vue';
import { UserKey } from './types';

const user = ref<UserInfo>({ id: 1, name: 'Alice', role: 'admin' });
provide(UserKey, user);
</script>

// Consumer.vue
<script setup lang="ts">
import { inject } from 'vue';
import { UserKey } from './types';

const user = inject(UserKey); // Type inferred as Ref<UserInfo>
if (!user) throw new Error('UserKey not provided');
</script>
```

## State Management Patterns

### Lightweight State: composable + reactive

```typescript
// stores/useCart.ts
import { reactive, computed } from 'vue';

const state = reactive({
  items: [] as Array<{ id: number; name: string; price: number; qty: number }>,
});

const total = computed(() =>
  state.items.reduce((sum, item) => sum + item.price * item.qty, 0)
);

const itemCount = computed(() =>
  state.items.reduce((sum, item) => sum + item.qty, 0)
);

function addItem(item: { id: number; name: string; price: number }) {
  const existing = state.items.find(i => i.id === item.id);
  if (existing) {
    existing.qty++;
  } else {
    state.items.push({ ...item, qty: 1 });
  }
}

function removeItem(id: number) {
  const index = state.items.findIndex(i => i.id === id);
  if (index > -1) state.items.splice(index, 1);
}

// Export read-only state and action methods
export function useCart() {
  return {
    items: computed(() => state.items),
    total,
    itemCount,
    addItem,
    removeItem,
  };
}
```

### Using Pinia

```typescript
// stores/user.ts
import { defineStore } from 'pinia';

export const useUserStore = defineStore('user', () => {
  const user = ref<UserInfo | null>(null);
  const token = ref<string | null>(localStorage.getItem('token'));

  const isLoggedIn = computed(() => !!token.value);

  async function login(credentials: LoginParams) {
    const res = await api.login(credentials);
    token.value = res.token;
    user.value = res.user;
    localStorage.setItem('token', res.token);
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('token');
  }

  return { user, token, isLoggedIn, login, logout };
});
```

## Migrating from Options API

### Progressive Migration Strategy

```vue
<!-- Approach 1: setup option (minimal changes) -->
<script>
import { ref } from 'vue';
export default {
  data() {
    return { legacyData: 'old' };
  },
  setup() {
    const newData = ref('new');
    return { newData };
  },
};
</script>

<!-- Approach 2: <script setup> (recommended) -->
<script setup lang="ts">
import { ref } from 'vue';

// Direct definition, no return needed
const count = ref(0);
function increment() {
  count.value++;
}

// Lifecycle
onMounted(() => console.log('mounted'));

// Props and Emits
const props = defineProps<{ title: string }>();
const emit = defineEmits<{ (e: 'change', value: number): void }>();
</script>
```

### Lifecycle Mapping

```javascript
// Options API           → Composition API
beforeCreate             → setup() itself
created                  → setup() itself
beforeMount              → onBeforeMount
mounted                  → onMounted
beforeUpdate             → onBeforeUpdate
updated                  → onUpdated
beforeUnmount            → onBeforeUnmount
unmounted                → onUnmounted
errorCaptured            → onErrorCaptured
renderTracked            → onRenderTracked
renderTriggered          → onRenderTriggered
```

### Watch Migration

```javascript
// Options API
export default {
  watch: {
    'form.name'(val) {
      this.validateName(val);
    },
    query: {
      handler(val) { this.search(val); },
      immediate: true,
      deep: true,
    },
  },
};

// Composition API
watch(() => form.name, (val) => {
  validateName(val);
});

watch(query, (val) => {
  search(val);
}, { immediate: true, deep: true });

// watchEffect: auto-track dependencies
watchEffect(() => {
  // Automatically tracks all reactive dependencies in formData
  console.log('Form changed:', formData.name, formData.email);
});
```

## Common Pitfalls

### 1. Using `this` in setup

```javascript
// Wrong: no `this` in setup
setup() {
  this.method(); // undefined!
}

// Correct: reference functions directly
setup() {
  function method() { /* ... */ }
  return { method };
}
```

### 2. Forgetting ref's .value

```typescript
const count = ref(0);

// Wrong: template auto-unwraps, but <script> does not
if (count === 0) { } // Always false

// Correct
if (count.value === 0) { }
```

### 3. Losing Reactivity

```typescript
const state = reactive({ list: [] });

// Wrong: destructuring reactive loses reactivity
const { list } = state;

// Fix 1: toRefs
const { list } = toRefs(state);

// Fix 2: use directly
state.list.push(item);

// Fix 3: use ref instead
const list = ref([]);
```

### 4. Proper Use of shallowRef

```typescript
// shallowRef: only .value replacement triggers updates
const items = shallowRef([{ name: 'A' }]);

items.value[0].name = 'B'; // No update triggered!
items.value = [...items.value]; // Triggers update

// Compare ref + reactive: deep reactivity
const items = ref([{ name: 'A' }]);
items.value[0].name = 'B'; // Triggers update
```

## Conclusion

The Composition API brings better logic reuse and code organization to Vue:

- **Composable functions** are the core abstraction — design with care for return types and cleanup logic
- **ref vs reactive**: prefer ref; reactive suits complex objects that won't be replaced
- **TypeScript integration**: leverage `defineProps<T>()`, `InjectionKey<T>`, and other typing tools
- **Migration strategy**: prefer `<script setup>`, organize new features as composables, migrate old code progressively

The core principle: **organize code by feature, not by option type**. This significantly improves readability, testability, and reusability.
