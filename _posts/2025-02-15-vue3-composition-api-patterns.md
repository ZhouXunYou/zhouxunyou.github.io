---
layout: post
title: "Vue 3 组合式 API 最佳实践模式"
date: 2025-02-15
categories: [frontend, vue]
author: Zhou Xunyou
lang: zh
---

Vue 3 的组合式 API（Composition API）是对 Options API 的彻底重构，它提供了更灵活的逻辑组织和复用方式。本文将深入解析组合式 API 的设计模式、响应式系统原理、TypeScript 集成以及从 Options API 迁移的实战经验。

## 为什么需要组合式 API

Options API 的核心问题在于**逻辑分散**。一个功能的代码被拆散到 `data`、`computed`、`methods`、`watch` 等多个选项中：

```javascript
// Options API：搜索功能的代码分散在各处
export default {
  data() {
    return {
      query: '',
      results: [],
      loading: false,
      // 其他功能的 data...
      currentPage: 1,
      pageSize: 10,
    };
  },
  computed: {
    filteredResults() { /* ... */ },
    // 其他功能的 computed...
  },
  methods: {
    async search() { /* ... */ },
    // 其他功能的 methods...
  },
  watch: {
    query(val) { /* ... */ },
    // 其他功能的 watch...
  },
};
```

组合式 API 让同一功能的代码聚合在一起：

```javascript
// Composition API：搜索功能的所有逻辑聚合在一处
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

// 使用
export default {
  setup() {
    const search = useSearch();
    const pagination = usePagination();
    return { ...search, ...pagination };
  },
};
```

## 响应式系统原理

### Proxy-based 响应式

Vue 3 使用 ES6 Proxy 替代了 Vue 2 的 `Object.defineProperty`：

```javascript
// Vue 2 的局限性
const obj = {};
Object.defineProperty(obj, 'name', {
  get() { /* ... */ },
  set(val) { /* ... */ },
});
// 无法检测：属性新增、数组索引修改、数组长度变化

// Vue 3 的 Proxy 方案
const reactive = (target) => {
  return new Proxy(target, {
    get(target, key, receiver) {
      track(target, key); // 收集依赖
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      const oldValue = target[key];
      const result = Reflect.set(target, key, value, receiver);
      if (oldValue !== value) {
        trigger(target, key); // 触发更新
      }
      return result;
    },
    deleteProperty(target, key) {
      const hadKey = key in target;
      const result = Reflect.deleteProperty(target, key);
      if (hadKey) {
        trigger(target, key); // 检测属性删除
      }
      return result;
    },
  });
};
```

### ref 与 reactive 的选择

```javascript
import { ref, reactive, toRefs } from 'vue';

// ref：适用于基础类型和需要重新赋值的场景
const count = ref(0);
const user = ref({ name: 'Alice' });
user.value = { name: 'Bob' }; // 可以整体替换

// reactive：适用于复杂对象，不需要重新赋值
const state = reactive({
  users: [],
  loading: false,
  filters: { status: 'active' },
});
state.users.push(newUser); // 直接操作
// state = { users: [] }; // 错误！不能整体替换

// 最佳实践：在 composable 中优先使用 ref
function useUser() {
  const user = ref(null); // 初始为 null，后续赋值
  const loading = ref(false);

  async function fetchUser(id) {
    loading.value = true;
    user.value = await api.getUser(id); // 整体替换 OK
    loading.value = false;
  }

  return { user, loading, fetchUser };
}

// 解构 reactive 对象会丢失响应性，使用 toRefs
const state = reactive({ name: 'Alice', age: 30 });
const { name, age } = toRefs(state); // 保持响应性
```

## Composable 函数设计模式

### 基础模式

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

### 异步状态管理模式

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

### 事件总线模式

```typescript
// composables/useEventBus.ts
type Handler<T = void> = (payload: T) => void;

export function useEventBus<T = void>() {
  const handlers = new Set<Handler<T>>();

  function on(handler: Handler<T>) {
    handlers.add(handler);
    return () => handlers.delete(handler); // 返回取消函数
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

// 使用
const bus = useEventBus<{ type: string; payload: any }>();
const off = bus.on((event) => console.log(event));
bus.emit({ type: 'user:login', payload: { id: 1 } });
off(); // 取消监听
```

## TypeScript 集成

### 类型化的 Props 和 Emits

```typescript
// 推荐：使用类型声明而非运行时声明
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

// 泛型组件
defineOptions({ inheritAttrs: false });
</script>
```

### 类型化的 provide/inject

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

const user = inject(UserKey); // 类型自动推断为 Ref<UserInfo>
if (!user) throw new Error('UserKey not provided');
</script>
```

## 状态管理模式

### 轻量状态：composable + reactive

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

// 导出只读状态和操作方法
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

### 使用 Pinia

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

## 从 Options API 迁移

### 渐进式迁移策略

```vue
<!-- 方式一：setup 选项（最小改动） -->
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

<!-- 方式二：<script setup>（推荐） -->
<script setup lang="ts">
import { ref } from 'vue';

// 直接定义，无需 return
const count = ref(0);
function increment() {
  count.value++;
}

// 生命周期
onMounted(() => console.log('mounted'));

// Props 和 Emits
const props = defineProps<{ title: string }>();
const emit = defineEmits<{ (e: 'change', value: number): void }>();
</script>
```

### 生命周期映射

```javascript
// Options API           → Composition API
beforeCreate             → setup() 本身
created                  → setup() 本身
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

### Watch 迁移

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

// watchEffect：自动追踪依赖
watchEffect(() => {
  // 自动追踪 formData 内的所有响应式依赖
  console.log('Form changed:', formData.name, formData.email);
});
```

## 常见陷阱

### 1. 在 setup 中使用 this

```javascript
// 错误：setup 中没有 this
setup() {
  this.method(); // undefined!
}

// 正确：直接引用函数
setup() {
  function method() { /* ... */ }
  return { method };
}
```

### 2. ref 的 .value 遗忘

```typescript
const count = ref(0);

// 错误：模板中自动解包，但 <script> 中不会
if (count === 0) { } // 永远为 false

// 正确
if (count.value === 0) { }
```

### 3. 响应性丢失

```typescript
const state = reactive({ list: [] });

// 错误：解构 reactive 丢失响应性
const { list } = state;

// 正确方案一：toRefs
const { list } = toRefs(state);

// 正确方案二：直接使用
state.list.push(item);

// 正确方案三：改用 ref
const list = ref([]);
```

### 4. shallowRef 的正确使用

```typescript
// shallowRef：只有 .value 的替换触发更新
const items = shallowRef([{ name: 'A' }]);

items.value[0].name = 'B'; // 不触发更新！
items.value = [...items.value]; // 触发更新

// 对比 ref + reactive：深层响应
const items = ref([{ name: 'A' }]);
items.value[0].name = 'B'; // 触发更新
```

## 总结

组合式 API 为 Vue 带来了更好的逻辑复用和代码组织能力：

- **Composable 函数**是组合式 API 的核心抽象，设计时注意返回值类型和清理逻辑
- **ref vs reactive**：优先使用 ref，reactive 适合不需要替换的复杂对象
- **TypeScript 集成**：充分利用 `defineProps<T>()`、`InjectionKey<T>` 等类型工具
- **迁移策略**：优先使用 `<script setup>`，新功能用 composable 组织，旧代码渐进迁移

核心原则：**以功能为单位组织代码，而不是以选项类型**。这将显著提升代码的可读性、可测试性和可复用性。
