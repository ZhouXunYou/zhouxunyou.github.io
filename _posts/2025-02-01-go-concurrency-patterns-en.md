---
layout: post
title: "Go Concurrency Patterns: From Goroutines to Production Pipelines"
date: 2025-02-01
categories: [backend]
author: Zhou Xunyou
lang: en
---

Go's concurrency model is based on CSP (Communicating Sequential Processes), with goroutines and channels as its core primitives. However, there's a big gap between a demo and production-grade code — goroutine leaks, race conditions, and context cancellation are common pitfalls in production. This article provides a systematic guide to Go's core concurrency patterns and production-grade practices.

## Goroutine Basics and Lifecycle

### Goroutine Overhead

```go
// Goroutine initial stack is only 2KB (can grow up to 1GB)
// Compare: Java thread default stack is 1MB
// This means you can easily create millions of goroutines

func main() {
    for i := 0; i < 1_000_000; i++ {
        go func(id int) {
            time.Sleep(10 * time.Second)
        }(i)
    }
    // One million goroutines use only about 2GB of memory
    time.Sleep(15 * time.Second)
}
```

### Goroutine Leaks: The Most Common Concurrency Bug

```go
// Leak example: channel has no consumer, goroutine blocks forever
func leak() <-chan int {
    ch := make(chan int)
    go func() {
        result := expensiveComputation()
        ch <- result // If no consumer, blocks here forever
    }()
    return ch
}

// Fix: use buffered channel or context cancellation
func noLeak(ctx context.Context) <-chan int {
    ch := make(chan int, 1) // Buffered, write won't block
    go func() {
        select {
        case <-ctx.Done():
            return // Context cancelled, goroutine exits
        case ch <- expensiveComputation():
        }
    }()
    return ch
}
```

## Channel Patterns

### Fan-out / Fan-in

```go
// Fan-out: distribute work across multiple goroutines
// Fan-in: merge results from multiple goroutines into one channel

func fanOutFanIn(ctx context.Context, items []Item) []Result {
    // Fan-out: launch multiple workers
    workers := make([]<-chan Result, 0, runtime.NumCPU())
    for i := 0; i < runtime.NumCPU(); i++ {
        ch := processItems(ctx, items, i)
        workers = append(workers, ch)
    }

    // Fan-in: merge all worker outputs
    merged := merge(ctx, workers...)

    var results []Result
    for r := range merged {
        results = append(results, r)
    }
    return results
}

func processItems(ctx context.Context, items []Item, workerID int) <-chan Result {
    out := make(chan Result)
    go func() {
        defer close(out)
        for _, item := range items {
            select {
            case <-ctx.Done():
                return
            case out <- process(item):
            }
        }
    }()
    return out
}

func merge(ctx context.Context, channels ...<-chan Result) <-chan Result {
    out := make(chan Result)
    var wg sync.WaitGroup

    // Launch one goroutine per input channel
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan Result) {
            defer wg.Done()
            for r := range c {
                select {
                case <-ctx.Done():
                    return
                case out <- r:
                }
            }
        }(ch)
    }

    // Close output channel after all goroutines complete
    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

### Pipeline Pattern

```go
// Pipeline: data flows through multiple stages, each stage is a goroutine

// Stage 1: generate data
func generate(ctx context.Context, nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums {
            select {
            case <-ctx.Done():
                return
            case out <- n:
            }
        }
    }()
    return out
}

// Stage 2: square computation
func square(ctx context.Context, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case <-ctx.Done():
                return
            case out <- n * n:
            }
        }
    }()
    return out
}

// Stage 3: print results
func print(ctx context.Context, in <-chan int) {
    for n := range in {
        fmt.Println(n)
    }
}

// Compose the pipeline
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // generate → square → square → print
    ch := generate(ctx, 1, 2, 3, 4, 5)
    ch = square(ctx, ch)
    ch = square(ctx, ch) // Fourth power
    print(ctx, ch)
}
```

### Worker Pool

```go
// Fixed number of workers pulling jobs from a jobs channel
func workerPool(ctx context.Context, jobs <-chan Job, results chan<- Result, numWorkers int) {
    var wg sync.WaitGroup

    for i := 0; i < numWorkers; i++ {
        wg.Add(1)
        go func(workerID int) {
            defer wg.Done()
            for job := range jobs {
                select {
                case <-ctx.Done():
                    return
                case results <- processJob(job):
                }
            }
        }(i)
    }

    go func() {
        wg.Wait()
        close(results)
    }()
}
```

## Context Cancellation and Timeouts

### Context Propagation

```go
// Context must be passed as the first parameter of a function
// Do not store context in a struct

// Correct usage
func FetchUser(ctx context.Context, id int) (*User, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    // ...
}

// Three ways to create context
ctx1 := context.Background()                        // Root context
ctx2, cancel2 := context.WithCancel(ctx1)            // Manual cancel
ctx3, cancel3 := context.WithTimeout(ctx1, 5*time.Second) // Timeout cancel
ctx4 := context.WithValue(ctx1, key, value)           // Pass values (use sparingly)

// Critical: call cancel to release resources
defer cancel2()
defer cancel3()
```

### Using Context Across Multiple Goroutines

```go
func fetchMultiple(ctx context.Context, urls []string) ([]string, error) {
    ctx, cancel := context.WithCancel(ctx)
    defer cancel()

    type result struct {
        data string
        err  error
    }

    results := make(chan result, len(urls))

    for _, url := range urls {
        go func(u string) {
            req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                results <- result{err: err}
                return
            }
            defer resp.Body.Close()
            body, _ := io.ReadAll(resp.Body)
            results <- result{data: string(body)}
        }(url)
    }

    var data []string
    for i := 0; i < len(urls); i++ {
        r := <-results
        if r.err != nil {
            cancel() // Cancel all requests on any failure
            return nil, r.err
        }
        data = append(data, r.data)
    }
    return data, nil
}
```

## Production-Grade Patterns

### errgroup: Goroutine Group with Error Handling

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) (map[string]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    mu := sync.Mutex{}
    results := make(map[string]string)

    for _, url := range urls {
        url := url // Capture loop variable
        g.Go(func() error {
            req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
            if err != nil {
                return err
            }
            resp, err := http.DefaultClient.Do(req)
            if err != nil {
                return err
            }
            defer resp.Body.Close()
            body, err := io.ReadAll(resp.Body)
            if err != nil {
                return err
            }

            mu.Lock()
            results[url] = string(body)
            mu.Unlock()
            return nil
        })
    }

    // Wait for all goroutines, return first error
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

### Semaphore: Limiting Concurrency

```go
import "golang.org/x/sync/semaphore"

func processWithLimit(ctx context.Context, items []Item) error {
    // Maximum 10 concurrent operations
    sem := semaphore.NewWeighted(10)
    g, ctx := errgroup.WithContext(ctx)

    for _, item := range items {
        item := item
        if err := sem.Acquire(ctx, 1); err != nil {
            break // Context cancelled
        }

        g.Go(func() error {
            defer sem.Release(1)
            return processItem(ctx, item)
        })
    }

    return g.Wait()
}
```

### Graceful Shutdown

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // Start server
    server := startServer(ctx)

    // Listen for termination signals
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

    <-sigCh
    fmt.Println("Shutting down...")

    // Give in-flight requests 30 seconds to complete
    shutdownCtx, shutdownCancel := context.WithTimeout(
        context.Background(), 30*time.Second,
    )
    defer shutdownCancel()

    if err := server.Shutdown(shutdownCtx); err != nil {
        fmt.Printf("Server shutdown error: %v\n", err)
    }
    fmt.Println("Server stopped")
}
```

## Race Condition Detection

```go
// Go has a built-in race detector — always enable it during development and testing
// go test -race ./...
// go run -race main.go

type Counter struct {
    mu    sync.Mutex
    value int
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.value++
    c.mu.Unlock()
}

func (c *Counter) Get() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.value
}

// sync/atomic is good for simple counters
type AtomicCounter struct {
    value atomic.Int64
}

func (c *AtomicCounter) Inc() {
    c.value.Add(1)
}

func (c *AtomicCounter) Get() int64 {
    return c.value.Load()
}
```

### Common Race Patterns and Fixes

```go
// Bug: concurrent map read/write
// fatal error: concurrent map writes

// Fix 1: sync.RWMutex
type SafeMap[K comparable, V any] struct {
    mu   sync.RWMutex
    data map[K]V
}

func (m *SafeMap[K, V]) Get(key K) (V, bool) {
    m.mu.RLock()
    defer m.mu.RUnlock()
    v, ok := m.data[key]
    return v, ok
}

func (m *SafeMap[K, V]) Set(key K, value V) {
    m.mu.Lock()
    defer m.mu.Unlock()
    m.data[key] = value
}

// Fix 2: sync.Map (better for specific patterns)
var m sync.Map
m.Store("key", "value")
v, ok := m.Load("key")
```

## Common Pitfalls

### 1. Loop Variable Capture

```go
// Bug: all goroutines use the same variable
for _, item := range items {
    go func() {
        process(item) // item is a reference to the loop variable!
    }()
}

// Fix 1: pass as parameter
for _, item := range items {
    go func(i Item) {
        process(i)
    }(item)
}

// Fix 2: local variable (Go 1.22+ fixes this automatically)
for _, item := range items {
    item := item // Create new variable
    go func() {
        process(item)
    }()
}
```

### 2. WaitGroup Add Timing

```go
// Bug: Add inside goroutine — Wait may return before any Add
var wg sync.WaitGroup
for _, item := range items {
    go func() {
        wg.Add(1) // Too late!
        defer wg.Done()
        process(item)
    }()
}
wg.Wait() // May return before any Add is called

// Correct: Add before launching goroutine
var wg sync.WaitGroup
for _, item := range items {
    wg.Add(1)
    go func() {
        defer wg.Done()
        process(item)
    }()
}
wg.Wait()
```

### 3. Channel Closure Responsibility

```go
// Principle: only the sender should close a channel; never close an already-closed channel

// Using defer + recover for unexpected cases (not recommended)
// Correct approach: clearly define closure responsibility

func producer(ctx context.Context, out chan<- int) {
    defer close(out) // Producer is responsible for closing
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return
        case out <- i:
        }
    }
}
```

## Conclusion

The core of Go concurrency is **"don't communicate by sharing memory; share memory by communicating"**, but production environments also require:

- **Always use context** to control timeouts and cancellation, preventing goroutine leaks
- **Use errgroup** instead of manual WaitGroup + error management
- **Use semaphore** to limit concurrency and prevent resource exhaustion
- **Enable -race** for race condition detection
- **Clarify goroutine lifecycles** — whoever starts it is responsible for stopping it

Master these patterns, and you'll write concurrent code that is both concise and production-ready.
