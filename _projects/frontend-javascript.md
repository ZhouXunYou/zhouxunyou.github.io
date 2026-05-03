---
layout: page
title: "JavaScript 语言精粹"
category: frontend-javascript
sidebar: true
lang: zh
lang_alt: /en/frontend-javascript/
sort_order: 2
nav:
  prev: /frontend-html-css/
  next: /frontend-async/
---

## 执行上下文与调用栈

JavaScript 引擎执行代码时，会创建**执行上下文（Execution Context）**。每个上下文包含三部分：

- **变量环境（Variable Environment）**：存储 var 声明和函数声明
- **词法环境（Lexical Environment）**：存储 let/const 声明
- **this 绑定**：由调用方式决定

执行上下文的生命周期：创建 → 执行 → 回收。调用栈（Call Stack）管理上下文的进出：

```javascript
function greet(name) {
  return `Hello, ${name}`;
}
function start() {
  const msg = greet("World");
  console.log(msg);
}
start();
// 调用栈变化: start() → greet() → 返回 → console.log() → 返回
```

调用栈是后进先出（LIFO）结构。当调用栈过深时会抛出 **RangeError: Maximum call stack size exceeded**，即栈溢出——典型场景是递归没有终止条件。

## 闭包、作用域链与变量提升

### 作用域链

JavaScript 采用**词法作用域（Lexical Scope）**——函数的作用域在定义时确定，而非调用时。引擎通过作用域链查找变量：从当前作用域开始，逐层向外查找直到全局。

### 闭包

闭包是指函数能够访问其词法作用域中的变量，即使函数在该作用域之外执行：

```javascript
function createCounter() {
  let count = 0; // 被闭包捕获
  return {
    increment: () => ++count,
    getCount: () => count,
  };
}
const counter = createCounter();
counter.increment(); // 1
counter.increment(); // 2
counter.getCount();  // 2
```

闭包的实战价值：**数据私有化**（模块模式）、**函数工厂**（柯里化）、**回调保持状态**（事件处理）。注意闭包会阻止垃圾回收，使用不当可能造成内存泄漏。

### 变量提升

```javascript
console.log(a); // undefined（var 提升，赋值不提升）
console.log(b); // ReferenceError（let 暂时性死区 TDZ）
var a = 1;
let b = 2;
```

`var` 声明被提升到作用域顶部并初始化为 `undefined`；`let`/`const` 声明也被提升，但在声明语句之前处于**暂时性死区（TDZ）**，访问会报错。函数声明会整体提升（包括函数体），而函数表达式只提升变量声明。

## 原型链与继承

JavaScript 的继承基于原型链，而非类。每个对象都有一个内部属性 `[[Prototype]]`，指向其原型对象。

```mermaid
graph TD
    A["实例 obj"] -->|"__proto__"| B["Person.prototype"]
    B -->|"__proto__"| C["Object.prototype"]
    C -->|"__proto__"| D["null"]
    B -->|"constructor"| E["Person 函数"]
    E -->|"prototype"| B
```

属性查找沿原型链向上搜索：`obj.name` → `obj.__proto__.name` → `obj.__proto__.__proto__.name` → ... → `null`。

### 继承模式演进

```javascript
// 1. 原型链继承
Child.prototype = new Parent();

// 2. 构造函数继承
function Child() {
  Parent.call(this);
}

// 3. 组合继承（最常用 ES5 方式）
function Child() {
  Parent.call(this);           // 实例属性
}
Child.prototype = Object.create(Parent.prototype); // 原型方法
Child.prototype.constructor = Child;

// 4. ES6 class 语法糖
class Child extends Parent {
  constructor() {
    super();
  }
}
```

`class` 本质是原型链的语法糖，但写法更清晰、更接近其他语言的习惯。

## ES6+ 核心特性

### 解构赋值

```javascript
// 数组解构
const [first, , third] = [1, 2, 3];

// 对象解构 + 重命名 + 默认值
const { name: userName = "匿名", age } = user;

// 函数参数解构
function render({ title, items = [] }) {
  // ...
}
```

### 箭头函数

箭头函数没有自己的 `this`、`arguments`、`super`，它从外层词法作用域继承 `this`：

```javascript
const team = {
  members: ["Alice", "Bob"],
  list() {
    // 箭头函数继承 this，指向 team
    this.members.forEach(member => console.log(member, this.members));
  },
};
```

### Symbol 与 Iterator

```javascript
// Symbol — 唯一标识符
const id = Symbol("id");
const user = { [id]: 123, name: "Alice" };

// Iterator — 统一遍历接口
const range = {
  from: 1,
  to: 5,
  [Symbol.iterator]() {
    let current = this.from;
    return {
      next: () => current <= this.to
        ? { value: current++, done: false }
        : { done: true },
    };
  },
};
[...range]; // [1, 2, 3, 4, 5]
```

实现 `Symbol.iterator` 协议的对象都可用 `for...of` 和展开运算符遍历。

## 模块化演进

```mermaid
flowchart LR
    A["IIFE<br/>立即执行函数"] --> B["CommonJS<br/>require/exports"]
    B --> C["AMD<br/>define/require"]
    C --> D["ES Modules<br/>import/export"]
    style D fill:#4caf50,color:#fff
```

| 规范 | 加载方式 | 适用场景 | 特点 |
|------|----------|----------|------|
| IIFE | 同步 | 早期浏览器 | 全局污染隔离，无法依赖管理 |
| CommonJS | 同步 | Node.js | 运行时加载，值的拷贝 |
| AMD | 异步 | 早期浏览器 | RequireJS，语法繁琐 |
| ES Modules | 静态 | 浏览器 + Node | 编译时静态分析，值的引用，Tree-shaking 友好 |

```javascript
// ES Modules — 现代标准
export const API_BASE = "/api";
export function fetchUser(id) { /* ... */ }
export default class UserService { /* ... */ }

// 导入
import UserService, { API_BASE } from "./user.js";
```

ES Modules 的静态特性使得构建工具能在编译阶段分析依赖图，实现 Tree-shaking——移除未使用的代码。这是 Vite、Rollup 等现代构建工具的基石。

## 6. 异步编程核心

### 6.1 Promise 链式调用

{% raw %}
```javascript
fetch('/api/user')
  .then(res => res.json())
  .then(user => fetch(`/api/posts?userId=${user.id}`))
  .then(res => res.json())
  .then(posts => console.log(posts))
  .catch(err => console.error('请求失败:', err));
```
{% endraw %}

### 6.2 async/await 错误处理

{% raw %}
```javascript
// 推荐的错误处理模式
async function fetchUser(id) {
  try {
    const res = await fetch(`/api/user/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error(`获取用户 ${id} 失败:`, error);
    return null;
  }
}

// 并行请求
const [users, posts] = await Promise.all([
  fetch('/api/users').then(r => r.json()),
  fetch('/api/posts').then(r => r.json())
]);
```
{% endraw %}

### 6.3 Event Loop 机制

```
┌───────────────────────┐
│     调用栈 (Call Stack) │
└───────────┬───────────┘
            │
┌───────────▼───────────┐
│   微任务队列 (Microtask) │  ← Promise.then, queueMicrotask
└───────────┬───────────┘
            │
┌───────────▼───────────┐
│   宏任务队列 (Macrotask) │  ← setTimeout, setInterval, I/O
└───────────────────────┘

执行顺序：同步代码 → 微任务清空 → 下一个宏任务
```

## 7. Proxy 与 Reflect

```javascript
// 响应式数据代理
const reactive = (target) => {
  return new Proxy(target, {
    get(obj, key, receiver) {
      track(obj, key);  // 依赖收集
      return Reflect.get(obj, key, receiver);
    },
    set(obj, key, value, receiver) {
      const oldValue = obj[key];
      Reflect.set(obj, key, value, receiver);
      if (oldValue !== value) trigger(obj, key);  // 触发更新
      return true;
    }
  });
};
```

## 8. 函数式编程

### 8.1 纯函数与组合

```javascript
// 纯函数：相同输入始终产生相同输出，无副作用
const add = (a) => (b) => a + b;
const multiply = (a) => (b) => a * b;

// 函数组合
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x);

const add10 = add(10);
const double = multiply(2);
const add10ThenDouble = compose(double, add10);

add10ThenDouble(5); // 30
```

### 8.2 柯里化

```javascript
const curry = (fn) => {
  const arity = fn.length;
  return function curried(...args) {
    return args.length >= arity
      ? fn.apply(this, args)
      : (...more) => curried.apply(this, args.concat(more));
  };
};

const sum = curry((a, b, c) => a + b + c);
sum(1)(2)(3);    // 6
sum(1, 2)(3);    // 6
sum(1)(2, 3);    // 6
```
