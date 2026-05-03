---
layout: post
title: "Kotlin Coroutines: From Basics to Production"
date: 2024-09-15
categories: [jvm]
author: Zhou Xunyou
lang: zh
---

Kotlin coroutines simplify asynchronous programming on the JVM. This post covers the core concepts and production patterns.

## Coroutine Builders

```kotlin
// Launch and forget
scope.launch {
    delay(1000)
    println("Done!")
}

// Await result
val result = scope.async {
    fetchFromNetwork()
}.await()

// Channel-based producer
val channel = scope.produce {
    repeat(10) { send(it) }
}
```

## Structured Concurrency

Coroutines follow a parent-child hierarchy. Cancelling a parent cancels all children:

```kotlin
val job = scope.launch {
    launch { slowOperation1() }  // Child 1
    launch { slowOperation2() }  // Child 2
}

job.cancel()  // Both children are cancelled
```

## Dispatchers

| Dispatcher | Use Case | Thread Pool |
|-----------|----------|-------------|
| `Dispatchers.Default` | CPU-bound work | Shared pool, cores count |
| `Dispatchers.IO` | Network/Disk I/O | Shared pool, up to 64 threads |
| `Dispatchers.Main` | UI updates | Main/UI thread |

## Flow for Streams

```kotlin
fun userEvents(userId: String): Flow<Event> = flow {
    while (currentCoroutineContext().isActive) {
        val events = pollEvents(userId)
        events.forEach { emit(it) }
        delay(5000)
    }
}

// Usage with operators
userEvents("user-1")
    .filter { it.type != "ping" }
    .map { transform(it) }
    .debounce(100.milliseconds)
    .collect { handleEvent(it) }
```

## Production Patterns

### Timeout

```kotlin
try {
    val result = withTimeout(5000.milliseconds) {
        callExternalService()
    }
} catch (e: TimeoutCancellationException) {
    fallback()
}
```

### Retry with Exponential Backoff

```kotlin
suspend fun <T> retry(
    times: Int = 3,
    initialDelay: Duration = 100.milliseconds,
    factor: Double = 2.0,
    block: suspend () -> T
): T {
    var currentDelay = initialDelay
    repeat(times) {
        try {
            return block()
        } catch (e: Exception) {
            if (it == times - 1) throw e
            delay(currentDelay)
            currentDelay = (currentDelay * factor).toDuration(DurationUnit.MILLISECONDS)
        }
    }
    throw IllegalStateException("Unreachable")
}
```
