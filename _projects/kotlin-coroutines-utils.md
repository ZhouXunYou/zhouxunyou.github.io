---
layout: repo
title: "kotlin-coroutines-utils"
description: "Utility library for Kotlin coroutines with common patterns and extensions"
language: "Kotlin"
language_color: "#A97BFF"
stars: 33
forks: 6
category: kotlin
pinned: true
license: "MIT"
files:
  - name: "src/"
    type: dir
  - name: "src/main/kotlin/"
    type: dir
  - name: "src/test/kotlin/"
    type: dir
  - name: "README.md"
    type: file
  - name: "build.gradle.kts"
    type: file
  - name: "settings.gradle.kts"
    type: file
  - name: "LICENSE"
    type: file
---

# kotlin-coroutines-utils

Utility library for Kotlin coroutines with common patterns, extensions, and best practices.

## Features

- Retry with exponential backoff
- Rate limiter for coroutine scopes
- Circuit breaker pattern
- Parallel decomposition helpers
- Flow extension functions

## Installation

```kotlin
// build.gradle.kts
dependencies {
    implementation("com.github.zhouxunyou:coroutines-utils:1.2.0")
}
```

## Usage

### Retry with Backoff

```kotlin
val result = retry(
    times = 3,
    initialDelay = 100.milliseconds,
    factor = 2.0
) {
    apiClient.fetchData()
}
```

### Circuit Breaker

```kotlin
val circuitBreaker = CircuitBreaker(
    failureThreshold = 5,
    resetTimeout = 30.seconds
)

val data = circuitBreaker.execute {
    externalService.call()
}
```

### Parallel Decomposition

```kotlin
val (users, orders, stats) = parallel(
    { userService.getAll() },
    { orderService.getAll() },
    { statsService.getDashboard() }
)
```

## License

MIT
