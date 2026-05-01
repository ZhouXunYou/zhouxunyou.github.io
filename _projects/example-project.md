---
layout: repo
title: "project-one"
description: "A TypeScript library for building modern web apps"
language: "TypeScript"
language_color: "#3178c6"
stars: 42
forks: 7
category: react
pinned: true
license: "MIT"
files:
  - name: "src/"
    type: dir
  - name: "docs/"
    type: dir
  - name: "README.md"
    type: file
  - name: "package.json"
    type: file
  - name: "tsconfig.json"
    type: file
  - name: "LICENSE"
    type: file
---

# project-one

A TypeScript library for building modern web apps.

## Features

- Type-safe API design
- Zero dependencies
- Full TypeScript support
- Tree-shakeable

## Installation

```bash
npm install project-one
```

## Usage

```typescript
import { createApp } from 'project-one';

const app = createApp({
  name: 'My App',
  debug: true,
});

app.start();
```

## License

MIT
