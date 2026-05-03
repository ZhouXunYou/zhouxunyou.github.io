---
layout: post
title: "React Server Components: Revolutionizing Frontend Rendering"
date: 2025-01-10
categories: [frontend, react]
author: Zhou Xunyou
lang: en
---

React Server Components (RSC) represent a fundamentally new component type introduced by the React team in late 2020. Unlike traditional client-side rendering (CSR) and server-side rendering (SSR), RSC allows components to execute on the server while preserving React's composition model. This article dives deep into RSC's architecture, how it works under the hood, and practical patterns in Next.js App Router.

## Why RSC Matters

Traditional frontend rendering faces a core dilemma:

- **CSR problems**: Large JS bundles for first paint, fast TTFB but slow FCP, poor SEO
- **SSR problems**: Server-rendered HTML still requires hydration; the client still downloads all component JS
- **Shared pain point**: Data fetching and rendering logic are tightly coupled; components can't be loaded on demand

The key insight behind RSC: **not every component needs to run on the client**. Purely presentational components can be rendered on the server, and only interactive components are sent to the client.

```
Traditional SSR:
  Server renders HTML → Client downloads all JS → Hydration → Interactive

RSC:
  Server renders RSC tree → Serialized to special stream format → Client hydrates only interactive components on demand
```

## RSC Architecture Deep Dive

### Server Component vs. Client Component

```jsx
// Server Component — all components are Server Components by default
// Cannot use useState, useEffect, onClick, etc.
async function UserProfile({ userId }) {
  // Can directly access databases, file systems, and other server resources
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

// Client Component — requires explicit 'use client' directive
'use client';

import { useState } from 'react';

function LikeButton({ postId }) {
  const [liked, setLiked] = useState(false);

  return (
    <button onClick={() => setLiked(!liked)}>
      {liked ? '❤️ Liked' : '🤍 Like'}
    </button>
  );
}
```

### Key Rules at a Glance

| Feature | Server Component | Client Component |
|---------|-----------------|------------------|
| Access server data | Direct access | Through API/hooks |
| Access backend resources | Database, filesystem | No |
| Use useState/useEffect | No | Yes |
| Listen to browser events | No | Yes |
| Use custom hooks | Server-only hooks | Yes |
| Render Client Components | Yes | Yes |
| Render Server Components | No (but via children) | No |

**Important**: A Server Component cannot directly import a Server Component nested inside a Client Component. However, you can pass Server Components through `children` props:

```jsx
// ServerComponent.jsx
export default function Layout() {
  return (
    <ClientWrapper>
      <ServerContent /> {/* Passed as children — this works */}
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

## The RSC Serialization Protocol

The core technical breakthrough of RSC lies in its serialization protocol. The server-rendered component tree is serialized into a special stream format:

```
0:"$Sreact.suspense"
1:["$","div",null,{"className":"profile","children":[
  ["$","h1",null,{"children":"Username"}],
  ["$","p",null,{"children":"Bio text"}],
  ["$","$L2",null,{"postId":123}]
]}]
2:["$","button",null,{"onClick":...,"children":"Like"}]
```

This format enables React to precisely reconstruct the component tree on the client, injecting event handlers and state logic only for Client Components.

## Next.js App Router in Practice

Next.js 13+ App Router is the first production-grade implementation of RSC.

### Route Structure

```
app/
├── layout.tsx          # Root layout (Server Component)
├── page.tsx            # Home page (Server Component)
├── about/
│   └── page.tsx        # Server Component
├── dashboard/
│   ├── layout.tsx      # Server Component
│   ├── page.tsx        # Client Component (needs interactivity)
│   └── settings/
│       └── page.tsx
└── api/
    └── route.ts        # Route Handler
```

### Data Fetching Patterns

```tsx
// app/posts/page.tsx — Server Component with direct data fetching
async function PostsPage() {
  // In Server Components, you can use async/await directly
  const posts = await fetch('https://api.example.com/posts', {
    next: { revalidate: 3600 } // ISR: revalidate every hour
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

// app/dashboard/page.tsx — Client Component
'use client';

import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    // Client still needs to fetch data via API
    fetch('/api/dashboard').then(res => res.json()).then(setData);
  }, []);

  if (!data) return <LoadingSkeleton />;
  return <DashboardChart data={data} />;
}
```

### Streaming with Suspense

RSC natively supports streaming. Combined with Suspense, you can achieve progressive rendering:

```tsx
// app/page.tsx
import { Suspense } from 'react';

export default function HomePage() {
  return (
    <main>
      <HeroSection /> {/* Renders immediately */}
      <Suspense fallback={<ProductSkeleton />}>
        <ProductList /> {/* Streams in */}
      </Suspense>
      <Suspense fallback={<ReviewSkeleton />}>
        <ReviewSection /> {/* Streams in */}
      </Suspense>
    </main>
  );
}

// components/ProductList.tsx
async function ProductList() {
  const products = await fetchProducts(); // May take time
  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map(p => <ProductCard key={p.id} {...p} />)}
    </div>
  );
}
```

## Comparison with Traditional Approaches

### Bundle Size Comparison

```
Traditional SPA:
  React + React DOM + all component code + third-party libs
  ≈ 300KB+ (gzipped)

SSR + Hydration:
  HTML + React + React DOM + all component code + third-party libs
  ≈ 300KB+ (gzipped) + server rendering overhead

RSC:
  HTML + React + React DOM + only Client Component code
  ≈ 80-150KB (gzipped)  // Server Component JS is never sent to the client
```

### Rendering Timeline Comparison

```javascript
// Traditional CSR
// TTFB: fast  |  FCP: slow  |  TTI: slowest
// 1. Download HTML (shell) → 2. Download JS → 3. Execute render → 4. Interactive

// Traditional SSR
// TTFB: slow  |  FCP: fast  |  TTI: slow
// 1. Server render → 2. Download HTML → 3. Download JS → 4. Hydration → 5. Interactive

// RSC + Streaming
// TTFB: fast  |  FCP: fast  |  TTI: fastest (only interactive components need hydration)
// 1. Stream HTML → 2. Progressive rendering → 3. Download minimal JS → 4. Hydrate interactive components
```

## Migration Guide

### From Pages Router to App Router

**Step 1**: Evaluate component boundaries

```tsx
// Categorize components into three groups:
// 1. Pure display → Server Component (default)
// 2. Has interactivity → Client Component (add 'use client')
// 3. Mixed → Split into Server + Client

// Before: one large component mixing display and interaction
function Article({ article }) {
  const [comment, setComment] = useState('');
  return (
    <div>
      <h1>{article.title}</h1>
      <div>{article.content}</div>
      <input value={comment} onChange={e => setComment(e.target.value)} />
      <button onClick={() => submitComment(comment)}>Submit</button>
    </div>
  );
}

// After: split into Server + Client
// ArticleContent.tsx (Server Component)
export default function ArticleContent({ article }) {
  return (
    <article>
      <h1>{article.title}</h1>
      <div dangerouslySetInnerHTML={"{ __html: article.htmlContent }"} />
      {/* markdown rendering lib won't be sent to the client */}
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
      <button onClick={() => submitComment(articleId, comment)}>Submit</button>
    </form>
  );
}
```

**Step 2**: Migrate data fetching logic

```tsx
// Pages Router: getServerSideProps
export async function getServerSideProps(context) {
  const data = await fetchData(context.params.id);
  return { props: { data } };
}

// App Router: directly async in Server Component
export default async function Page({ params }) {
  const data = await fetchData(params.id);
  return <DataView data={data} />;
}
```

**Step 3**: Handle shared state

```tsx
// For cross-component shared state, use URL searchParams instead of global state
// Server Components can read searchParams directly

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

## Common Pitfalls

### 1. Using Client APIs in Server Components

```tsx
// Wrong: Server Components can't use window/document
export default function Page() {
  const width = window.innerWidth; // ReferenceError!
  return <div>{width}</div>;
}

// Correct: use in a Client Component
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

### 2. Server Component Props Must Be Serializable

```tsx
// Wrong: functions can't be serialized
<ServerComponent onClick={() => {}} /> // TypeError!

// Correct: pass Client Components through children
<ServerComponent>
  <ClientButton onClick={() => {}} />
</ServerComponent>
```

### 3. Overusing 'use client'

```tsx
// Anti-pattern: marking the entire page as a Client Component
'use client';
export default function Page() {
  // Most of this page is actually static content
  // Only the search box needs interactivity
  return <div>...lots of static content...</div>;
}

// Recommended: only add 'use client' to the interactive part
// page.tsx (Server Component)
export default function Page() {
  return <div>...static content...<SearchBox /></div>;
}

// SearchBox.tsx (Client Component)
'use client';
export default function SearchBox() { ... }
```

## Conclusion

React Server Components are not just a simple performance optimization — they represent an architectural paradigm shift:

- **Zero-bundle server logic**: Database queries, file reads, etc. no longer need API middleware
- **Automatic code splitting**: Client Components naturally serve as code-splitting boundaries
- **Streaming rendering**: Combined with Suspense, users see content faster
- **Backward compatible**: Existing Client Component code works without modification

RSC is best suited for content-driven applications (blogs, e-commerce, documentation sites). For highly interactive applications (online editors, games), careful evaluation is needed. When migrating, start with new pages and gradually introduce Server Components rather than rewriting everything at once.
