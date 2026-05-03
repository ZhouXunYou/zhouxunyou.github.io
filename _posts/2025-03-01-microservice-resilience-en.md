---
layout: post
title: "Microservice Resilience: Circuit Breakers, Rate Limiting, and Graceful Degradation"
date: 2025-03-01
categories: [backend, microservice]
author: Zhou Xunyou
lang: en
---

In microservice architectures, service call chains can be deeply complex. A single downstream failure can trigger cascading failures that eventually bring down the entire system. Resilience design aims to ensure the system continues providing acceptable service under failure conditions, rather than collapsing completely. This article explores the three core strategies — circuit breakers, rate limiting, and graceful degradation — with production-ready implementations.

## Why Resilience Design Matters

### The Nature of Cascading Failures

```
User Request → API Gateway → User Service → Order Service → Inventory Service
                                    ↓
                                 Payment Service (slow response)
                                    ↓
                          Order Service thread pool exhausted
                                    ↓
                          User Service thread pool exhausted
                                    ↓
                          API Gateway timeout
                                    ↓
                          Entire system unavailable
```

The key insight: **a slow service is more dangerous than a down service**. A down service fails fast, while a slow service continuously consumes caller resources (threads, connections, memory), eventually leading to resource exhaustion.

### Three Goals of Resilience Design

1. **Fail Fast**: Don't wait for requests that are destined to fail
2. **Graceful Degradation**: Provide alternatives when core functionality is unavailable
3. **Fault Isolation**: One service's failure should not propagate

## Circuit Breaker Pattern

### Circuit Breaker State Machine

The circuit breaker borrows from electrical fuse concepts and has three states:

- **Closed**: Requests pass through normally; failure rate is tracked
- **Open**: Requests are rejected immediately; downstream is not called
- **Half-Open**: A few probe requests are allowed to test if downstream has recovered

```
         Failure rate exceeds threshold       After timeout
  Closed ──────────→ Open ──────────→ Half-Open
    ↑                                      │
    │         Probe succeeds                │
    └──────────────────────────────────────┘
                   Probe fails
    Half-Open ──────────→ Open
```

### Implementing a Circuit Breaker in Go

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
    threshold   float64 // Failure rate threshold, e.g. 0.5 = 50%
    minRequests int     // Minimum requests before calculating
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
            return true // Allow one probe request
        }
        return false
    case StateHalfOpen:
        return b.requests == 0 // Only allow one request
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

### Wrapping HTTP Calls with a Circuit Breaker

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

// Usage
func main() {
    breaker := NewBreaker(0.5, 10, 30*time.Second)
    client := NewCircuitBreakerClient(breaker, http.DefaultClient)

    resp, err := client.Get("http://payment-service/api/charge")
    if err != nil {
        var cbErr *CircuitBreakerError
        if errors.As(err, &cbErr) {
            // Circuit breaker is open, execute fallback
            return fallbackPayment()
        }
        return err
    }
    // Normal processing
}
```

## Rate Limiting Algorithms

### 1. Token Bucket

The most widely used rate limiting algorithm, allowing burst traffic.

```go
package ratelimit

import (
    "sync"
    "time"
)

type TokenBucket struct {
    mu         sync.Mutex
    rate       float64   // Tokens added per second
    capacity   float64   // Maximum bucket capacity
    tokens     float64   // Current token count
    lastRefill time.Time // Last refill time
}

func NewTokenBucket(rate, capacity float64) *TokenBucket {
    return &TokenBucket{
        rate:       rate,
        capacity:   capacity,
        tokens:     capacity, // Start with a full bucket
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

// Usage: 100 requests/second, burst cap of 200
limiter := NewTokenBucket(100, 200)
if !limiter.Allow() {
    http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
    return
}
```

### 2. Sliding Window

More precise time-window rate limiting, avoiding fixed-window boundary burst issues.

```go
package ratelimit

import (
    "sync"
    "time"
)

type SlidingWindow struct {
    mu        sync.Mutex
    limit     int           // Max requests in window
    window    time.Duration // Window size
    count     int           // Current window count
    prevCount int           // Previous window count
    windowStart time.Time   // Current window start time
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
        // Enter new window
        sw.prevCount = sw.count
        sw.count = 0
        sw.windowStart = now
        elapsed = 0
    }

    // Weighted calculation: previous window proportionally scaled by remaining time
    weight := 1 - float64(elapsed)/float64(sw.window)
    estimated := float64(sw.prevCount)*weight + float64(sw.count)

    if estimated < float64(sw.limit) {
        sw.count++
        return true
    }
    return false
}
```

### 3. Distributed Rate Limiting

Single-machine rate limiting isn't enough in microservices. You need Redis-based distributed rate limiting:

```go
// Redis + Lua script for sliding window rate limiting
var slidingWindowScript = redis.NewScript(`
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])

    -- Remove expired entries
    redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

    -- Current window request count
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

## Degradation Strategies

### Multi-level Degradation Design

```go
type PaymentService struct {
    primary    *PaymentClient
    secondary  *PaymentClient
    cache      *Cache
    breaker    *Breaker
}

func (s *PaymentService) Charge(ctx context.Context, req *ChargeReq) (*ChargeResp, error) {
    // Level 1: Try primary service (with circuit breaker)
    if s.breaker.Allow() {
        resp, err := s.primary.Charge(ctx, req)
        s.breaker.Record(err == nil)
        if err == nil {
            return resp, nil
        }
    }

    // Level 2: Fall back to secondary service
    resp, err := s.secondary.Charge(ctx, req)
    if err == nil {
        return resp, nil
    }

    // Level 3: Return cached/default value
    if cached, ok := s.cache.Get(req.OrderID); ok {
        return cached.(*ChargeResp), nil
    }

    // Level 4: Queue for async retry
    s.asyncQueue.Enqueue(req)
    return &ChargeResp{
        OrderID:  req.OrderID,
        Status:   "pending",
        Message:  "Payment is being processed, please check later",
    }, nil
}
```

### Feature Degradation: Disable Non-Core Features by Priority

```go
type DegradationManager struct {
    mu      sync.RWMutex
    levels  map[string]int // Feature → degradation level
    current int            // Current degradation level
}

// Degradation level definitions
const (
    LevelNormal    = 0 // Full service
    LevelReduce1   = 1 // Disable recommendations
    LevelReduce2   = 2 // Disable comments/ratings
    LevelReduce3   = 3 // Disable search, browsing only
    LevelEmergency = 4 // Core transactions only
)

func (d *DegradationManager) IsAvailable(feature string) bool {
    d.mu.RLock()
    defer d.mu.RUnlock()
    return d.levels[feature] <= d.current
}

// Use as middleware
func (d *DegradationManager) Middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        feature := getFeatureFromPath(r.URL.Path)
        if !d.IsAvailable(feature) {
            http.Error(w, "Service temporarily unavailable", http.StatusServiceUnavailable)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

## Resilience in Service Mesh

In Istio and similar service meshes, resilience policies can be configured at the mesh layer without modifying business code:

### Istio DestinationRule Circuit Breaker Config

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

### Istio VirtualService Rate Limiting Config

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

## Observability

Resilience design must be paired with comprehensive monitoring:

```go
// Metrics definitions
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

// Alert rules
// - Circuit breaker open > 5 minutes → P1
// - Rate limit rejection rate > 10% → P2
// - Degradation level >= 2 → P3
```

## Common Pitfalls

### 1. Poorly Tuned Circuit Breaker Thresholds

```go
// Anti-pattern: threshold too low, normal fluctuations trigger the breaker
breaker := NewBreaker(0.1, 5, 30*time.Second) // 10% failure rate, 5 requests

// Recommended: tune based on business SLA
// Core services: 30% failure rate, minimum 20 requests
// Non-core services: 50% failure rate, minimum 10 requests
breaker := NewBreaker(0.3, 20, 30*time.Second)
```

### 2. Rate Limiting Granularity Too Coarse

```go
// Anti-pattern: global uniform rate limiting
limiter := NewTokenBucket(1000, 1500) // Everyone shares 1000 QPS

// Recommended: per-user/tenant/endpoint rate limiting
userLimiters := sync.Map{}
func getLimiter(userID string) *TokenBucket {
    if l, ok := userLimiters.Load(userID); ok {
        return l.(*TokenBucket)
    }
    l := NewTokenBucket(10, 20) // 10 QPS per user
    userLimiters.Store(userID, l)
    return l
}
```

### 3. Fallback Logic Becoming a Failure Point

```go
// Anti-pattern: fallback depends on another external service
func fallback() {
    resp, _ := http.Get("http://another-service/fallback") // Could also be down!
}

// Recommended: keep fallback logic as local as possible
func fallback() *Response {
    return &Response{
        Data:    defaultData,    // Pre-set static data
        Message: "Service temporarily unavailable",
        Cached:  true,
    }
}
```

## Conclusion

Resilience design is essential for microservice architectures. The three strategies each address different concerns:

| Strategy | Problem Solved | Core Idea |
|----------|---------------|-----------|
| Circuit Breaker | Prevent cascading failures | Fail fast, give downstream time to recover |
| Rate Limiting | Prevent overload | Keep traffic within system capacity |
| Degradation | Preserve core functionality | Sacrifice non-core features for system survival |

Implementation principles:
- **Layered defense**: Every layer from gateway to service should have resilience policies
- **Observability first**: Resilience without monitoring equals no resilience
- **Chaos engineering validation**: Regularly test with Chaos Mesh to verify resilience strategies actually work
- **Start simple**: Implement basic timeouts + retries first, then gradually introduce circuit breakers and rate limiting
