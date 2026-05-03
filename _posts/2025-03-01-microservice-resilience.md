---
layout: post
title: "微服务弹性设计：熔断、限流与降级实战"
date: 2025-03-01
categories: [backend]
author: Zhou Xunyou
lang: zh
---

微服务架构中，服务之间的调用链路可能非常复杂。一个下游服务的故障可能引发级联失败，最终拖垮整个系统。弹性设计（Resilience Design）的目标是让系统在面对故障时仍能提供可接受的服务，而不是彻底崩溃。本文将深入讲解熔断、限流和降级三大核心策略，并给出可落地的实现方案。

## 为什么需要弹性设计

### 级联故障的本质

```
用户请求 → API Gateway → 用户服务 → 订单服务 → 库存服务
                                    ↓
                                 支付服务（响应变慢）
                                    ↓
                          订单服务线程池耗尽
                                    ↓
                          用户服务线程池耗尽
                                    ↓
                          API Gateway 超时
                                    ↓
                          整个系统不可用
```

关键问题：**一个慢服务比一个挂掉的服务更危险**。挂掉的服务会快速失败，而慢服务会持续占用调用方的资源（线程、连接、内存），最终导致资源耗尽。

### 弹性设计的三大目标

1. **快速失败**（Fail Fast）：不要等待注定失败的请求
2. **优雅降级**（Graceful Degradation）：核心功能不可用时提供替代方案
3. **故障隔离**（Fault Isolation）：一个服务的故障不应该扩散

## 熔断器模式

### 熔断器状态机

熔断器借鉴了电路中的保险丝概念，有三种状态：

- **Closed**（关闭）：正常放行请求，同时统计失败率
- **Open**（打开）：直接拒绝请求，不再调用下游
- **Half-Open**（半开）：放行少量请求试探，判断下游是否恢复

```
         失败率超过阈值            超时后
  Closed ──────────→ Open ──────────→ Half-Open
    ↑                                      │
    │         探测成功                      │
    └──────────────────────────────────────┘
                   探测失败
    Half-Open ──────────→ Open
```

### Go 实现熔断器

```go
package circuitbreaker

import (
    "sync"
    "time"
)

type State int

const (
    StateClosed   State = iota
    StateOpen
    StateHalfOpen
)

type Breaker struct {
    mu          sync.Mutex
    state       State
    failures    int
    successes   int
    requests    int
    threshold   float64 // 失败率阈值，如 0.5 = 50%
    minRequests int     // 最小请求数，达到后才开始计算
    timeout     time.Duration
    lastStateChange time.Time
}

func NewBreaker(threshold float64, minRequests int, timeout time.Duration) *Breaker {
    return &Breaker{
        state:       StateClosed,
        threshold:   threshold,
        minRequests: minRequests,
        timeout:     timeout,
    }
}

func (b *Breaker) Allow() bool {
    b.mu.Lock()
    defer b.mu.Unlock()

    switch b.state {
    case StateClosed:
        return true
    case StateOpen:
        if time.Since(b.lastStateChange) > b.timeout {
            b.state = StateHalfOpen
            b.failures = 0
            b.successes = 0
            b.requests = 0
            b.lastStateChange = time.Now()
            return true // 放行一个探测请求
        }
        return false
    case StateHalfOpen:
        return b.requests == 0 // 只放行一个请求
    }
    return false
}

func (b *Breaker) Record(success bool) {
    b.mu.Lock()
    defer b.mu.Unlock()

    b.requests++
    if success {
        b.successes++
    } else {
        b.failures++
    }

    switch b.state {
    case StateClosed:
        if b.requests >= b.minRequests {
            failureRate := float64(b.failures) / float64(b.requests)
            if failureRate >= b.threshold {
                b.transitionTo(StateOpen)
            }
        }
    case StateHalfOpen:
        if success {
            b.transitionTo(StateClosed)
        } else {
            b.transitionTo(StateOpen)
        }
    }
}

func (b *Breaker) transitionTo(state State) {
    b.state = state
    b.failures = 0
    b.successes = 0
    b.requests = 0
    b.lastStateChange = time.Now()
}
```

### 使用熔断器包装 HTTP 调用

```go
func NewCircuitBreakerClient(breaker *Breaker, client *http.Client) *http.Client {
    transport := &cbTransport{
        base:    client.Transport,
        breaker: breaker,
    }
    client.Transport = transport
    return client
}

type cbTransport struct {
    base    http.RoundTripper
    breaker *Breaker
}

func (t *cbTransport) RoundTrip(req *http.Request) (*http.Response, error) {
    if !t.breaker.Allow() {
        return nil, &CircuitBreakerError{State: "open"}
    }

    resp, err := t.base.RoundTrip(req)
    success := err == nil && resp.StatusCode < 500
    t.breaker.Record(success)

    return resp, err
}

// 使用
func main() {
    breaker := NewBreaker(0.5, 10, 30*time.Second)
    client := NewCircuitBreakerClient(breaker, http.DefaultClient)

    resp, err := client.Get("http://payment-service/api/charge")
    if err != nil {
        var cbErr *CircuitBreakerError
        if errors.As(err, &cbErr) {
            // 熔断打开，执行降级逻辑
            return fallbackPayment()
        }
        return err
    }
    // 正常处理
}
```

## 限流算法

### 1. 令牌桶（Token Bucket）

最常用的限流算法，允许突发流量。

```go
package ratelimit

import (
    "sync"
    "time"
)

type TokenBucket struct {
    mu         sync.Mutex
    rate       float64   // 每秒添加的令牌数
    capacity   float64   // 桶的最大容量
    tokens     float64   // 当前令牌数
    lastRefill time.Time // 上次填充时间
}

func NewTokenBucket(rate, capacity float64) *TokenBucket {
    return &TokenBucket{
        rate:       rate,
        capacity:   capacity,
        tokens:     capacity, // 初始满桶
        lastRefill: time.Now(),
    }
}

func (tb *TokenBucket) Allow() bool {
    tb.mu.Lock()
    defer tb.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(tb.lastRefill).Seconds()
    tb.tokens += elapsed * tb.rate
    if tb.tokens > tb.capacity {
        tb.tokens = tb.capacity
    }
    tb.lastRefill = now

    if tb.tokens >= 1 {
        tb.tokens--
        return true
    }
    return false
}

// 使用：每秒100个请求，突发上限200
limiter := NewTokenBucket(100, 200)
if !limiter.Allow() {
    http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
    return
}
```

### 2. 滑动窗口（Sliding Window）

更精确的时间窗口限流，避免固定窗口的边界突发问题。

```go
package ratelimit

import (
    "sync"
    "time"
)

type SlidingWindow struct {
    mu        sync.Mutex
    limit     int           // 窗口内最大请求数
    window    time.Duration // 窗口大小
    count     int           // 当前窗口计数
    prevCount int           // 前一窗口计数
    windowStart time.Time   // 当前窗口起始时间
}

func NewSlidingWindow(limit int, window time.Duration) *SlidingWindow {
    return &SlidingWindow{
        limit:       limit,
        window:      window,
        windowStart: time.Now(),
    }
}

func (sw *SlidingWindow) Allow() bool {
    sw.mu.Lock()
    defer sw.mu.Unlock()

    now := time.Now()
    elapsed := now.Sub(sw.windowStart)

    if elapsed >= sw.window {
        // 进入新窗口
        sw.prevCount = sw.count
        sw.count = 0
        sw.windowStart = now
        elapsed = 0
    }

    // 加权计算：前一窗口按剩余时间比例折算
    weight := 1 - float64(elapsed)/float64(sw.window)
    estimated := float64(sw.prevCount)*weight + float64(sw.count)

    if estimated < float64(sw.limit) {
        sw.count++
        return true
    }
    return false
}
```

### 3. 分布式限流

单机限流在微服务中不够，需要基于 Redis 的分布式限流：

```go
// Redis + Lua 脚本实现滑动窗口限流
var slidingWindowScript = redis.NewScript(`
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])

    -- 移除过期数据
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

    -- 当前窗口请求数
    local count = redis.call('ZCARD', key)

    if count < limit then
        redis.call('ZADD', key, now, now .. '-' .. math.random())
        redis.call('PEXPIRE', key, window)
        return 1
    end
    return 0
`)

func (l *RedisLimiter) Allow(ctx context.Context, key string) (bool, error) {
    now := time.Now().UnixMilli()
    result, err := slidingWindowScript.Run(ctx, l.client, 
        []string{key}, now, l.window.Milliseconds(), l.limit,
    ).Int64()
    if err != nil {
        return false, err
    }
    return result == 1, nil
}
```

## 降级策略

### 多级降级设计

```go
type PaymentService struct {
    primary    *PaymentClient
    secondary  *PaymentClient
    cache      *Cache
    breaker    *Breaker
}

func (s *PaymentService) Charge(ctx context.Context, req *ChargeReq) (*ChargeResp, error) {
    // 第一级：尝试主服务（带熔断）
    if s.breaker.Allow() {
        resp, err := s.primary.Charge(ctx, req)
        s.breaker.Record(err == nil)
        if err == nil {
            return resp, nil
        }
    }

    // 第二级：切换到备用服务
    resp, err := s.secondary.Charge(ctx, req)
    if err == nil {
        return resp, nil
    }

    // 第三级：返回缓存/默认值
    if cached, ok := s.cache.Get(req.OrderID); ok {
        return cached.(*ChargeResp), nil
    }

    // 第四级：记录请求，稍后重试（异步降级）
    s.asyncQueue.Enqueue(req)
    return &ChargeResp{
        OrderID:  req.OrderID,
        Status:   "pending",
        Message:  "支付处理中，请稍后查询",
    }, nil
}
```

### 功能降级：按优先级关闭非核心功能

```go
type DegradationManager struct {
    mu      sync.RWMutex
    levels  map[string]int // 功能 → 降级等级
    current int            // 当前降级等级
}

// 降级等级定义
const (
    LevelNormal    = 0 // 正常服务
    LevelReduce1   = 1 // 关闭推荐系统
    LevelReduce2   = 2 // 关闭评论/评分
    LevelReduce3   = 3 // 关闭搜索，只保留浏览
    LevelEmergency = 4 // 只保留核心交易
)

func (d *DegradationManager) IsAvailable(feature string) bool {
    d.mu.RLock()
    defer d.mu.RUnlock()
    return d.levels[feature] <= d.current
}

// 中间件中使用
func (d *DegradationManager) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        feature := getFeatureFromPath(r.URL.Path)
        if !d.IsAvailable(feature) {
            http.Error(w, "服务暂时不可用", http.StatusServiceUnavailable)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

## Service Mesh 中的弹性

在 Istio 等 Service Mesh 中，弹性策略可以在网格层统一配置，无需修改业务代码：

### Istio DestinationRule 熔断配置

```yaml
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: payment-service
spec:
  host: payment-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100
      http:
        h2UpgradePolicy: DEFAULT
        http1MaxPendingRequests: 1000
        http2MaxRequests: 1000
        maxRequestsPerConnection: 10
    outlierDetection:
      consecutive5xxErrors: 5
      interval: 30s
      baseEjectionTime: 30s
      maxEjectionPercent: 50
      minHealthPercent: 25
```

### Istio VirtualService 限流配置

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: payment-service
spec:
  hosts:
    - payment-service
  http:
    - route:
        - destination:
            host: payment-service
      retries:
        attempts: 3
        perTryTimeout: 2s
        retryOn: 5xx,reset,connect-failure
      timeout: 10s
      fault:
        abort:
          percentage:
            value: 0.1
          httpStatus: 500
```

## 可观测性

弹性设计必须配合完善的监控：

```go
// 指标定义
var (
    breakerState = prometheus.NewGaugeVec(
        prometheus.GaugeOpts{
            Name: "circuit_breaker_state",
            Help: "Circuit breaker state: 0=closed, 1=open, 2=half-open",
        },
        []string{"service"},
    )

    rateLimitRejected = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "rate_limit_rejected_total",
            Help: "Number of requests rejected by rate limiter",
        },
        []string{"service", "limiter"},
    )

    degradationLevel = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "degradation_level",
            Help: "Current degradation level",
        },
    )
)

// 告警规则
// - 熔断器打开超过 5 分钟 → P1
// - 限流拒绝率超过 10% → P2
// - 降级等级 >= 2 → P3
```

## 常见陷阱

### 1. 熔断器阈值设置不合理

```go
// 反模式：阈值太低，正常波动就触发熔断
breaker := NewBreaker(0.1, 5, 30*time.Second) // 10% 失败率，5 个请求

// 推荐：结合业务 SLA 设置
// 核心服务：30% 失败率，最少 20 个请求
// 非核心服务：50% 失败率，最少 10 个请求
breaker := NewBreaker(0.3, 20, 30*time.Second)
```

### 2. 限流粒度太粗

```go
// 反模式：全局统一限流
limiter := NewTokenBucket(1000, 1500) // 所有人共享 1000 QPS

// 推荐：按用户/租户/接口分别限流
userLimiters := sync.Map{}
func getLimiter(userID string) *TokenBucket {
    if l, ok := userLimiters.Load(userID); ok {
        return l.(*TokenBucket)
    }
    l := NewTokenBucket(10, 20) // 每用户 10 QPS
    userLimiters.Store(userID, l)
    return l
}
```

### 3. 降级逻辑本身成为故障点

```go
// 反模式：降级逻辑依赖外部服务
func fallback() {
    resp, _ := http.Get("http://another-service/fallback") // 也可能挂！
}

// 推荐：降级逻辑应尽量本地化
func fallback() *Response {
    return &Response{
        Data:    defaultData,    // 预置的静态数据
        Message: "服务暂时不可用",
        Cached:  true,
    }
}
```

## 总结

弹性设计是微服务架构的必修课，三大策略各有侧重：

| 策略 | 解决的问题 | 核心思想 |
|------|-----------|---------|
| 熔断 | 防止级联故障 | 快速失败，给下游恢复时间 |
| 限流 | 防止过载 | 控制流量在系统可承受范围内 |
| 降级 | 保证核心可用 | 牺牲非核心功能换取系统存活 |

实施原则：
- **分层防御**：从网关层到服务层，每层都应有弹性策略
- **可观测先行**：没有监控的弹性设计等于没有弹性设计
- **混沌工程验证**：用 Chaos Mesh 等工具定期演练，确保弹性策略真的有效
- **从简到繁**：先实现基本的超时 + 重试，再逐步引入熔断和限流
