---
layout: post
title: "Go 并发模式：从 goroutine 到生产级管道"
date: 2025-02-01
categories: [backend, go]
author: Zhou Xunyou
lang: zh
---

Go 语言的并发模型基于 CSP（Communicating Sequential Processes），goroutine 和 channel 是其核心原语。然而，从 demo 到生产级代码之间有很大的距离——goroutine 泄漏、竞态条件、上下文取消等都是生产环境中常见的坑。本文将系统讲解 Go 并发的核心模式和生产级实践。

## Goroutine 基础与生命周期

### Goroutine 的开销

```go
// goroutine 初始栈仅 2KB（可动态增长到 1GB）
// 对比：Java 线程默认栈 1MB
// 这意味着你可以轻松创建百万级 goroutine

func main() {
    for i := 0; i < 1_000_000; i++ {
        go func(id int) {
            time.Sleep(10 * time.Second)
        }(i)
    }
    // 百万 goroutine 仅占用约 2GB 内存
    time.Sleep(15 * time.Second)
}
```

### Goroutine 泄漏：最常见的并发 Bug

```go
// 泄漏示例：channel 没有消费者，goroutine 永远阻塞
func leak() <-chan int {
    ch := make(chan int)
    go func() {
        result := expensiveComputation()
        ch <- result // 如果没有消费者，永远阻塞在这里
    }()
    return ch
}

// 修复：使用 buffered channel 或 context 取消
func noLeak(ctx context.Context) <-chan int {
    ch := make(chan int, 1) // buffered，写入不阻塞
    go func() {
        select {
        case <-ctx.Done():
            return // 上下文取消，goroutine 退出
        case ch <- expensiveComputation():
        }
    }()
    return ch
}
```

## Channel 模式

### Fan-out / Fan-in

```go
// Fan-out：将工作分发到多个 goroutine
// Fan-in：将多个 goroutine 的结果合并到一个 channel

func fanOutFanIn(ctx context.Context, items []Item) []Result {
    // Fan-out：启动多个 worker
    workers := make([]<-chan Result, 0, runtime.NumCPU())
    for i := 0; i < runtime.NumCPU(); i++ {
        ch := processItems(ctx, items, i)
        workers = append(workers, ch)
    }

    // Fan-in：合并所有 worker 的输出
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

    // 为每个输入 channel 启动一个 goroutine
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

    // 等待所有 goroutine 完成后关闭输出 channel
    go func() {
        wg.Wait()
        close(out)
    }()

    return out
}
```

### Pipeline 模式

```go
// Pipeline：数据流经多个阶段，每个阶段是一个 goroutine

// 阶段1：生成数据
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

// 阶段2：平方计算
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

// 阶段3：打印结果
func print(ctx context.Context, in <-chan int) {
    for n := range in {
        fmt.Println(n)
    }
}

// 组装管道
func main() {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    // 生成 → 平方 → 平方 → 打印
    ch := generate(ctx, 1, 2, 3, 4, 5)
    ch = square(ctx, ch)
    ch = square(ctx, ch) // 四次方
    print(ctx, ch)
}
```

### Worker Pool

```go
// 固定数量的 worker 从 jobs channel 取任务
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

## Context 取消与超时

### context 的传播机制

```go
// context 必须作为函数第一个参数传递
// 不要把 context 存在 struct 里

// 正确用法
func FetchUser(ctx context.Context, id int) (*User, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil {
        return nil, err
    }
    resp, err := http.DefaultClient.Do(req)
    // ...
}

// 三种 context 创建方式
ctx1 := context.Background()                        // 根 context
ctx2, cancel2 := context.WithCancel(ctx1)            // 手动取消
ctx3, cancel3 := context.WithTimeout(ctx1, 5*time.Second) // 超时取消
ctx4 := context.WithValue(ctx1, key, value)           // 传值（慎用）

// 关键：调用 cancel 释放资源
defer cancel2()
defer cancel3()
```

### 在多 goroutine 中使用 context

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
            cancel() // 任一失败，取消所有请求
            return nil, r.err
        }
        data = append(data, r.data)
    }
    return data, nil
}
```

## 生产级模式

### errgroup：带错误处理的 goroutine 组

```go
import "golang.org/x/sync/errgroup"

func fetchAll(ctx context.Context, urls []string) (map[string]string, error) {
    g, ctx := errgroup.WithContext(ctx)
    mu := sync.Mutex{}
    results := make(map[string]string)

    for _, url := range urls {
        url := url // 捕获循环变量
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

    // 等待所有 goroutine 完成，返回第一个错误
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
```

### Semaphore：限制并发数

```go
import "golang.org/x/sync/semaphore"

func processWithLimit(ctx context.Context, items []Item) error {
    // 最多 10 个并发
    sem := semaphore.NewWeighted(10)
    g, ctx := errgroup.WithContext(ctx)

    for _, item := range items {
        item := item
        if err := sem.Acquire(ctx, 1); err != nil {
            break // context 取消
        }

        g.Go(func() error {
            defer sem.Release(1)
            return processItem(ctx, item)
        })
    }

    return g.Wait()
}
```

### 优雅关闭

```go
func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    // 启动服务
    server := startServer(ctx)

    // 监听退出信号
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

    <-sigCh
    fmt.Println("Shutting down...")

    // 给正在处理的请求 30 秒完成
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

## 竞态条件检测

```go
// Go 内置竞态检测器，开发和测试时务必启用
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

// sync/atomic 适合简单计数器
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

### 常见竞态模式与修复

```go
// Bug：对 map 的并发读写
// fatal error: concurrent map writes

// 修复方案一：sync.RWMutex
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

// 修复方案二：sync.Map（特定场景更优）
var m sync.Map
m.Store("key", "value")
v, ok := m.Load("key")
```

## 常见陷阱

### 1. 循环变量捕获

```go
// Bug：所有 goroutine 使用相同的变量
for _, item := range items {
    go func() {
        process(item) // item 是循环变量的引用！
    }()
}

// 修复方案一：参数传递
for _, item := range items {
    go func(i Item) {
        process(i)
    }(item)
}

// 修复方案二：局部变量（Go 1.22+ 已修复此问题）
for _, item := range items {
    item := item // 创建新变量
    go func() {
        process(item)
    }()
}
```

### 2. WaitGroup 的 Add 时机

```go
// Bug：在 goroutine 内部 Add，可能 Wait 先执行完
var wg sync.WaitGroup
for _, item := range items {
    go func() {
        wg.Add(1) // 太晚了！
        defer wg.Done()
        process(item)
    }()
}
wg.Wait() // 可能在任何 Add 之前就返回

// 正确：在启动 goroutine 之前 Add
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

### 3. Channel 的关闭责任

```go
// 原则：只由发送方关闭 channel，不要关闭已关闭的 channel

// 使用 defer + recover 处理意外情况（不推荐）
// 正确做法：明确关闭责任

func producer(ctx context.Context, out chan<- int) {
    defer close(out) // 生产者负责关闭
    for i := 0; ; i++ {
        select {
        case <-ctx.Done():
            return
        case out <- i:
        }
    }
}
```

## 总结

Go 并发的核心是 **"不要通过共享内存来通信，而要通过通信来共享内存"**，但生产环境还需要：

- **始终使用 context** 控制超时和取消，避免 goroutine 泄漏
- **使用 errgroup** 替代手动 WaitGroup + error 管理
- **使用 semaphore** 限制并发数，防止资源耗尽
- **启用 -race** 进行竞态检测
- **明确 goroutine 的生命周期**——谁启动，谁负责停止

掌握这些模式后，你就能写出既简洁又可靠的生产级并发代码。
