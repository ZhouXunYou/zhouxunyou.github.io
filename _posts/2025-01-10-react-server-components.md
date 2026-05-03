---
layout: post
title: "React Server Components：彻底改变前端渲染模式"
date: 2025-01-10
categories: [frontend, react]
author: Zhou Xunyou
lang: zh
---

React Server Components（RSC）是 React 团队在 2020 年底提出的一种全新组件类型，它从根本上改变了前端应用的渲染方式。与传统的客户端渲染（CSR）和服务端渲染（SSR）不同，RSC 让组件可以在服务端执行，同时保留 React 的组合模型。本文将深入解析 RSC 的架构设计、工作原理以及在 Next.js App Router 中的实践。

## 为什么需要 RSC

传统前端渲染面临的核心矛盾：

- **CSR 的问题**：首屏需要下载大量 JS，TTFB 快但 FCP 慢，SEO 不友好
- **SSR 的问题**：服务端渲染 HTML 后仍需 hydration，客户端仍需下载所有组件的 JS
- **共同的痛点**：数据获取和渲染逻辑耦合，组件无法按需加载

RSC 的核心洞察是：**并非所有组件都需要在客户端运行**。纯展示组件可以在服务端完成渲染，只把交互组件发送到客户端。

```
传统 SSR：
  服务端渲染 HTML → 客户端下载全部 JS → Hydration → 可交互

RSC：
  服务端渲染 RSC 树 → 序列化为特殊格式流 → 客户端按需 Hydration 交互组件
```

## RSC 架构详解

### Server Component 与 Client Component 的区别

```jsx
// Server Component - 默认所有组件都是 Server Component
// 不能使用 useState、useEffect、onClick 等
async function UserProfile({ userId }) {
  // 可以直接访问数据库、文件系统等服务端资源
  const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  const posts = await fetchRecentPosts(userId);

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
      <PostList posts={posts} />
      <LikeButton postId={posts[0].id} /> {/* Client Component */}
    </div>
  );
}

// Client Component - 需要显式声明 'use client'
'use client';

import { useState } from 'react';

function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);

  return (
    <button onClick={() => setLiked(!liked)}>
      {liked ? '❤️ 已赞' : '🤍 点赞'}
    </button>
  );
}
```

### 关键规则

| 特性 | Server Component | Client Component |
|------|-----------------|------------------|
| 获取服务端数据 | 直接访问 | 通过 API/hooks |
| 访问后端资源 | 数据库、文件系统 | 不可 |
| 使用 useState/useEffect | 不可 | 可以 |
| 监听浏览器事件 | 不可 | 可以 |
| 使用自定义 hooks | 仅服务端 hooks | 可以 |
| 渲染 Client Component | 可以 | 可以 |
| 渲染 Server Component | 不可以（但可以通过 children） | 不可以 |

**注意**：Server Component 不能直接 import Client Component 中内嵌的 Server Component。但可以通过 `children` props 传递：

```jsx
// ServerComponent.jsx
export default function Layout() {
  return (
    <ClientWrapper>
      <ServerContent /> {/* 作为 children 传递，可行 */}
    </ClientWrapper>
  );
}

// ClientWrapper.jsx
'use client';
export default function ClientWrapper({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>Toggle</button>
      {isOpen && children}
    </div>
  );
}
```

## RSC 的序列化协议

RSC 的核心技术突破在于其序列化协议。服务端渲染的组件树被序列化为一种特殊的流格式：

```
0:"$Sreact.suspense"
1:["$","div",null,{"className":"profile","children":[
  ["$","h1",null,{"children":"用户名"}],
  ["$","p",null,{"children":"个人简介"}],
  ["$","$L2",null,{"postId":123}]
]}]
2:["$","button",null,{"onClick":...,"children":"点赞"}]
```

这种格式允许 React 在客户端精确地重建组件树，只为 Client Component 注入事件处理器和状态逻辑。

## Next.js App Router 实践

Next.js 13+ 的 App Router 是 RSC 的首个生产级实现。

### 路由结构

```
app/
├── layout.tsx          # 根布局 (Server Component)
├── page.tsx            # 首页 (Server Component)
├── about/
│   └── page.tsx        # Server Component
├── dashboard/
│   ├── layout.tsx      # Server Component
│   ├── page.tsx        # Client Component (需要交互)
│   └── settings/
│       └── page.tsx
└── api/
    └── route.ts        # Route Handler
```

### 数据获取模式

```tsx
// app/posts/page.tsx - Server Component，直接获取数据
async function PostsPage() {
  // 在 Server Component 中可以直接 async/await
  const posts = await fetch('https://api.example.com/posts', {
    next: { revalidate: 3600 } // ISR：每小时重新验证
  }).then(res => res.json());

  return (
    <main>
      {posts.map(post => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
          <ShareButton postId={post.id} />
        </article>
      ))}
    </main>
  );
}

// app/dashboard/page.tsx - Client Component
'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    // 客户端仍需通过 API 获取数据
    fetch('/api/dashboard').then(res => res.json()).then(setData);
  }, []);

  if (!data) return <LoadingSkeleton />;
  return <DashboardChart data={data} />;
}
```

### Streaming 与 Suspense

RSC 天然支持 Streaming，结合 Suspense 可以实现渐进式渲染：

```tsx
// app/page.tsx
import { Suspense } from 'react';

export default function HomePage() {
  return (
    <main>
      <HeroSection /> {/* 立即渲染 */}
      <Suspense fallback={<ProductSkeleton />}>
        <ProductList /> {/* 流式加载 */}
      </Suspense>
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewSection /> {/* 流式加载 */}
      </Suspense>
    </main>
  );
}

// components/ProductList.tsx
async function ProductList() {
  const products = await fetchProducts(); // 可能耗时
  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map(p => <ProductCard key={p.id} {...p} />)}
    </div>
  );
}
```

## 与传统方案的对比

### Bundle Size 对比

```
传统 SPA：
  React + React DOM + 所有组件代码 + 第三方库
  ≈ 300KB+ (gzipped)

SSR + Hydration：
  HTML + React + React DOM + 所有组件代码 + 第三方库
  ≈ 300KB+ (gzipped) + 服务端渲染开销

RSC：
  HTML + React + React DOM + 仅 Client Component 代码
  ≈ 80-150KB (gzipped)  // Server Component 的 JS 不会发送到客户端
```

### 渲染时序对比

```javascript
// 传统 CSR
// TTFB: 快  |  FCP: 慢  |  TTI: 最慢
// 1. 下载 HTML（空壳）→ 2. 下载 JS → 3. 执行渲染 → 4. 可交互

// 传统 SSR
// TTFB: 慢  |  FCP: 快  |  TTI: 慢
// 1. 服务端渲染 → 2. 下载 HTML → 3. 下载 JS → 4. Hydration → 5. 可交互

// RSC + Streaming
// TTFB: 快  |  FCP: 快  |  TTI: 最快（仅交互组件需 hydration）
// 1. 流式返回 HTML → 2. 逐步渲染 → 3. 下载少量 JS → 4. 交互组件 Hydration
```

## 迁移指南

### 从 Pages Router 迁移到 App Router

**第一步**：评估组件边界

```tsx
// 将组件分为三类：
// 1. 纯展示 → Server Component（默认）
// 2. 有交互 → Client Component（加 'use client'）
// 3. 混合 → 拆分为 Server + Client

// Before: 一个大组件包含展示和交互
function Article({ article }) {
  const [comment, setComment] = useState('');
  return (
    <div>
      <h1>{article.title}</h1>
      <div>{article.content}</div>
      <input value={comment} onChange={e => setComment(e.target.value)} />
      <button onClick={() => submitComment(comment)}>提交</button>
    </div>
  );
}

// After: 拆分为 Server + Client
// ArticleContent.tsx (Server Component)
export default function ArticleContent({ article }) {
  return (
    <article>
      <h1>{article.title}</h1>
      <div dangerouslySetInnerHTML={"{ __html: article.htmlContent }"} />
      {/* markdown 渲染库不会发送到客户端 */}
      <CommentForm articleId={article.id} />
    </article>
  );
}

// CommentForm.tsx (Client Component)
'use client';
export default function CommentForm({ articleId }) {
  const [comment, setComment] = useState('');
  return (
    <form>
      <textarea value={comment} onChange={e => setComment(e.target.value)} />
      <button onClick={() => submitComment(articleId, comment)}>提交</button>
    </form>
  );
}
```

**第二步**：迁移数据获取逻辑

```tsx
// Pages Router: getServerSideProps
export async function getServerSideProps(context) {
  const data = await fetchData(context.params.id);
  return { props: { data } };
}

// App Router: 直接在 Server Component 中 async
export default async function Page({ params }) {
  const data = await fetchData(params.id);
  return <DataView data={data} />;
}
```

**第三步**：处理共享状态

```tsx
// 对于跨组件共享状态，使用 URL searchParams 而非全局 state
// Server Component 可以直接读取 searchParams

// app/search/page.tsx
export default async function SearchPage({ searchParams }) {
  const query = searchParams.q || '';
  const results = await searchProducts(query);
  return (
    <div>
      <SearchInput defaultValue={query} />
      <SearchResults results={results} />
    </div>
  );
}
```

## 常见陷阱

### 1. 在 Server Component 中使用客户端 API

```tsx
// 错误：Server Component 不能使用 window/document
export default function Page() {
  const width = window.innerWidth; // ReferenceError!
  return <div>{width}</div>;
}

// 正确：在 Client Component 中使用
'use client';
import { useState, useEffect } from 'react';
export default function WindowSize() {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    setWidth(window.innerWidth);
    window.addEventListener('resize', () => setWidth(window.innerWidth));
  }, []);
  return <span>{width}px</span>;
}
```

### 2. Server Component 的 props 必须可序列化

```tsx
// 错误：函数无法序列化
<ServerComponent onClick={() => {}} /> // TypeError!

// 正确：通过 children 传递 Client Component
<ServerComponent>
  <ClientButton onClick={() => {}} />
</ServerComponent>
```

### 3. 过度使用 'use client'

```tsx
// 反模式：整个页面标记为 Client Component
'use client';
export default function Page() {
  // 这个页面其实大部分是静态内容
  // 只有搜索框需要交互
  return <div>...大量静态内容...</div>;
}

// 推荐：只给交互部分加 'use client'
// page.tsx (Server Component)
export default function Page() {
  return <div>...静态内容...<SearchBox /></div>;
}

// SearchBox.tsx (Client Component)
'use client';
export default function SearchBox() { ... }
```

## 总结

React Server Components 不是一个简单的性能优化，而是一次架构范式的转变：

- **零 Bundle 的服务端逻辑**：数据库查询、文件读取等不再需要 API 中间层
- **自动代码分割**：Client Component 天然是代码分割的边界
- **流式渲染**：与 Suspense 结合，用户可以更快看到内容
- **向后兼容**：现有 Client Component 代码无需修改

RSC 最适合内容驱动型应用（博客、电商、文档站点），对于高度交互的应用（在线编辑器、游戏）则需谨慎评估。迁移时建议从新页面开始，逐步引入 Server Component，而不是一次性重写。
