---
layout: page
title: "Comprehensive Tuning Case Studies"
category: jvm-tuning-practice
sidebar: true
lang: en
lang_alt: /jvm-tuning-practice/
permalink: /en/jvm-tuning-practice/
sort_order: 10
nav:
  prev: /en/jvm-parameters/
  next:
---

## Tuning Methodology

JVM tuning is not about blindly adjusting parameters — it follows a scientific methodology:

### Tuning Principles

1. **Optimize code first, then tune the JVM**: Most performance issues stem from code, not JVM configuration
2. **Tune with data, not guesses**: Base decisions on GC logs and monitoring data
3. **Change only one parameter at a time**: Avoid multiple variables that make it impossible to determine causation
4. **Establish a baseline before tuning**: Record pre-optimization metrics for comparison
5. **Verify tuning results with real load**: Not idle testing

### Tuning Process

```
1. Define goals (throughput? latency? memory footprint?)
2. Establish baseline (collect current metrics)
3. Analyze bottlenecks (GC logs / monitoring / thread dumps)
4. Formulate plan (parameter adjustments / code optimization)
5. Implement and verify (A/B testing / canary deployment)
6. Compare results (against baseline)
```

## Case 1: Spring Boot Web Service GC Tuning

### Background

A Spring Boot e-commerce backend service, 4C8G container, JDK 17, G1GC.

### Problem

- API P99 latency > 500ms, with occasional spikes > 2s
- Young GC frequency approximately every 3 seconds
- Sporadic Full GC causing service pauses

### Analysis

```bash
# 1. Examine GC logs
# Young GC pause times
[GC pause (G1 Evacuation Pause) (young), 0.045 secs]  # 45ms, acceptable
[GC pause (G1 Evacuation Pause) (young), 0.080 secs]  # 80ms, on the high side

# Full GC
[Full GC (Allocation Failure)  4096M->2800M(4096M), 1.200 secs]  # 1.2 seconds!

# 2. jstat analysis
jstat -gcutil <pid> 1000 10
# O (old generation utilization) consistently at 75-85%, triggering frequent concurrent marking
# FGC count 2-3 times per hour
```

### Diagnosis

- **Root cause**: 4G heap too small, high old generation utilization, Mixed GC reclamation can't keep up with allocation rate, degrading to Full GC
- **Contributing factor**: Large objects (order list JSON serialization) allocated directly in Humongous Regions, triggering premature GC

### Optimization Plan

```bash
# Before
java -Xms4g -Xmx4g -XX:+UseG1GC -jar app.jar

# After
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \          # Lower target pause (200→100)
     -XX:G1HeapRegionSize=8m \           # Larger Region (avoid large objects becoming Humongous)
     -XX:InitiatingHeapOccupancyPercent=40 \  # Trigger concurrent marking earlier (45→40)
     -XX:G1MixedGCCountTarget=12 \       # More Mixed GC cycles (8→12)
     -XX:G1MixedGCLiveThresholdPercent=80 \  # More aggressive reclaim (85→80)
     -XX:SurvivorRatio=6 \               # Larger Survivor (8→6)
     -Xlog:gc*:file=/var/log/gc.log:time,uptime:filecount=5,filesize=20m \
     -jar app.jar
```

### Code Optimization

```java
// Before: large object serialization
String json = objectMapper.writeValueAsString(orders);  // Large string when order count is high

// After: streaming write
objectMapper.writeValue(outputStream, orders);

// Before: unbounded cache
Map<String, Order> cache = new HashMap<>();

// After: bounded cache
Cache<String, Order> cache = Caffeine.newBuilder()
    .maximumSize(10000)
    .expireAfterWrite(Duration.ofMinutes(30))
    .build();
```

### Results

| Metric | Before | After |
|--------|--------|-------|
| P99 latency | 520ms | 85ms |
| Young GC pause | 45-80ms | 20-35ms |
| Full GC frequency | 2-3/hour | 0 |
| Old generation utilization | 75-85% | 50-65% |

## Case 2: Spark Job Off-Heap Memory Tuning

### Background

A Spark ETL job processing 500GB of data, JDK 11, running on YARN with 8G Executor memory.

### Problem

- OOM after running for a while: `java.lang.OutOfMemoryError: Direct buffer memory`
- Severe GC pauses during shuffle stage

### Analysis

```bash
# Executor log
ERROR Executor: Exception in task 123.0 in stage 45
java.lang.OutOfMemoryError: Direct buffer memory
    at java.nio.Bits.reserveMemory(Bits.java:175)

# GC log: long Old GC pauses
[GC pause (G1 Evacuation Pause) (mixed), 0.800 secs]
```

### Diagnosis

- **Root cause 1**: Spark network transport uses Netty, which heavily uses off-heap DirectByteBuffer, exceeding `-XX:MaxDirectMemorySize`
- **Root cause 2**: Too many on-heap cached objects, poor Mixed GC reclaim efficiency

### Optimization Plan

```bash
# Before
--conf spark.executor.memory=8g
--conf spark.executor.memoryOverhead=2g

# After
--conf spark.executor.memory=6g                # Reduce heap memory
--conf spark.executor.memoryOverhead=4g         # Increase off-heap memory (2→4G)
--conf spark.executor.extraJavaOptions="-XX:+UseG1GC -XX:MaxDirectMemorySize=3g -XX:MaxGCPauseMillis=100"
--conf spark.memory.fraction=0.6               # Reduce execution/storage memory ratio (0.6→0.5)
--conf spark.memory.storageFraction=0.3        # Reduce storage memory fraction
--conf spark.sql.shuffle.partitions=400        # Increase shuffle partition count

# Code optimization: reduce broadcast variable size
# Before
broadcast(bigLookupTable)  // 2GB lookup table
# After
broadcast(filteredLookupTable)  // Filtered to 200MB
```

### Results

| Metric | Before | After |
|--------|--------|-------|
| OOM frequency | Every run | Eliminated |
| Job duration | 3.5 hours | 2.1 hours |
| Total GC time | 45 minutes | 18 minutes |

## Case 3: Containerized Microservice JVM Limits and Tuning

### Background

50+ microservices running in a Kubernetes cluster, container limits 2C4G, JDK 17.

### Problem

- Multiple services OOMKilled (container killed, not Java OOM)
- GC logs show heap utilization only 60%
- Container actual memory usage close to limit

### Analysis

```bash
# View container memory usage
kubectl top pod <pod-name>
# NAME         CPU    MEMORY
# my-service   800m   3900Mi  (limit 4Gi, 95% used)

# Java process memory breakdown (Native Memory Tracking)
jcmd <pid> VM.native_memory summary

# Findings:
# - Java Heap:     2.0G (-Xmx2g)
# - Class:          0.5G (metaspace)
# - Thread:         0.6G (300 threads × 2M/Xss)
# - Internal:       0.3G (Direct ByteBuffer)
# - Code:           0.2G (JIT code cache)
# - GC:             0.2G (GC data structures)
# Total:            3.8G → approaching 4G limit
```

### Diagnosis

- **Root cause**: JVM off-heap memory + native memory + container overhead exceeds container limit
- `-Xmx2g` only limits the heap; off-heap memory is uncontrolled
- Thread stack `Xss` defaults to 1M, 300 threads = 300M

### Optimization Plan

```bash
# Before
java -Xmx2g -jar app.jar

# After — using container-aware parameters
java -XX:+UseContainerSupport \
     -XX:MaxRAMPercentage=50.0 \       # Heap = 50% × 4G = 2G
     -XX:InitialRAMPercentage=50.0 \
     -XX:MaxMetaspaceSize=256m \        # Limit metaspace
     -XX:MaxDirectMemorySize=256m \     # Limit direct memory
     -XX:ReservedCodeCacheSize=128m \   # Reduce code cache
     -Xss512k \                         # Reduce thread stack (1M→512K)
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/tmp/heapdump.hprof \
     -Xlog:gc*:file=/tmp/gc.log:time:filecount=3,filesize=10m \
     -jar app.jar
```

### Kubernetes Configuration

```yaml
resources:
  requests:
    memory: "3Gi"
    cpu: "1.5"
  limits:
    memory: "4Gi"
    cpu: "2"

# Increase container memory headroom
# JVM heap 2G + off-heap ~1.5G + OS ~0.5G = 4G
```

### Results

| Metric | Before | After |
|--------|--------|-------|
| OOMKilled | 3-5 per week | 0 |
| Container memory usage | 3.9G/4G | 3.0G/4G |
| GC P99 pause | 120ms | 45ms |

## Full-Stack Tuning Case Study

### Scenario

An online education platform where users report slow video loading, API P99 > 3s.

### Step 1: Monitoring and Detection

```bash
# Prometheus alerts
# - API service P99 > 3s
# - GC pause P99 > 500ms

# Grafana Dashboard
# - Heap utilization consistently at 85%
# - Young GC frequency every 2 seconds
# - Old generation steadily growing
```

### Step 2: Analyze GC Logs

```bash
# Upload GC logs to GCEasy
# Analysis results:
# - Throughput: 92% (target > 98%)
# - Avg Young GC pause: 65ms
# - Max Young GC pause: 320ms
# - Full GC: 5 times in 2 hours
# - Object promotion rate: 200MB/s
```

### Step 3: Thread Analysis

```bash
# jstack reveals numerous BLOCKED threads
"pool-3-thread-15" #45 prio=5 os_prio=0 tid=0x... nid=0x... waiting for monitor entry
   java.lang.Thread.State: BLOCKED (on object monitor)
    at com.example.VideoService.getVideoInfo(VideoService.java:123)
    - waiting to lock <0x...> (a java.lang.Object)
    at com.example.VideoService.process(VideoService.java:89)
```

### Step 4: Code Investigation

```java
// Problematic code: synchronized lock + unbounded cache
public class VideoService {
    private Map<String, VideoInfo> cache = new HashMap<>();

    public synchronized VideoInfo getVideoInfo(String id) {
        VideoInfo info = cache.get(id);
        if (info == null) {
            info = loadFromDB(id);  // Slow DB query
            cache.put(id, info);     // Cache grows unbounded
        }
        return info;
    }
}
```

### Step 5: Implement Optimization

```java
// After optimization: async loading + bounded cache
public class VideoService {
    private Cache<String, VideoInfo> cache = Caffeine.newBuilder()
        .maximumSize(50000)
        .expireAfterWrite(Duration.ofMinutes(30))
        .refreshAfterWrite(Duration.ofMinutes(10))
        .buildAsync(this::loadFromDB);  // Async refresh

    public CompletableFuture<VideoInfo> getVideoInfo(String id) {
        return cache.get(id);
    }
}
```

```bash
# JVM parameter adjustments
# Increase heap + optimize G1
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:G1HeapRegionSize=8m \
     -XX:InitiatingHeapOccupancyPercent=40 \
     -jar app.jar
```

### Step 6: Verify Results

| Metric | Before | After |
|--------|--------|-------|
| API P99 latency | 3200ms | 180ms |
| GC throughput | 92% | 99.2% |
| Full GC | 5 times/2 hours | 0 |
| BLOCKED threads | 30+ | 0 |

## Tuning Best Practices Summary

1. **Always enable GC logging and HeapDump** — this is the foundation for tuning and troubleshooting
2. **Set -Xms = -Xmx** to avoid jitter from dynamic heap expansion/contraction
3. **Use `-XX:MaxRAMPercentage` in container environments** instead of fixed `-Xmx`
4. **Optimize code before tuning JVM** — code issues cannot be solved with parameters
5. **Avoid explicit System.gc()** — use `-XX:+DisableExplicitGC` to disable it
6. **Choose the right collector**: G1/ZGC for latency-sensitive workloads, Parallel for throughput
7. **Monitor off-heap memory**: Native Memory Tracking helps with investigation
8. **Tune incrementally**: change one parameter at a time, compare against baseline
9. **Use canary deployments**: validate tuning parameters on a subset of instances first
10. **Monitor continuously**: tuning is not a one-time task — keep watching metric changes

## Summary

This chapter demonstrated the full JVM tuning process through four case studies: from monitoring to detect issues, to analyzing GC logs and thread dumps to identify root causes, to formulating and implementing optimization plans, and finally verifying results. The core of tuning is not memorizing parameters, but mastering the "Monitor → Locate → Analyze → Optimize → Verify" methodology.
