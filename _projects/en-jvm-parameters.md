---
layout: page
title: "JVM Tuning Parameters Guide"
category: jvm-parameters
sidebar: true
lang: en
lang_alt: /jvm-parameters/
permalink: /en/jvm-parameters/
sort_order: 9
nav:
  prev: /en/jvm-diagnostics/
  next: /en/jvm-tuning-practice/
---

## JVM Parameter Categories

JVM parameters fall into three categories:

| Type | Format | Description |
|------|--------|-------------|
| Standard | `-` | Supported by all JVM implementations (e.g., `-version`, `-cp`) |
| Non-standard | `-X` | Not guaranteed on all JVMs but commonly available (e.g., `-Xms`, `-Xmx`) |
| Developer | `-XX` | Extension parameters specific to a JVM implementation (e.g., `-XX:+UseG1GC`) |

Boolean-type developer parameters use `+`/`-` switches:
- `-XX:+UseG1GC` enables
- `-XX:-UseG1GC` disables

Non-boolean types use `=` assignment:
- `-XX:MaxHeapSize=4g`

## Memory Parameters

### Heap Memory

| Parameter | Description | Recommended Value |
|-----------|-------------|-------------------|
| `-Xms` | Initial heap size | Same as -Xmx |
| `-Xmx` | Maximum heap size | 50-80% of physical memory |
| `-Xmn` | Young generation size | 30-40% of heap |
| `-XX:NewRatio` | Old/young generation ratio | 2 (default) |
| `-XX:SurvivorRatio` | Eden/Survivor ratio | 8 (default) |
| `-XX:MaxTenuringThreshold` | Age threshold for promotion to old generation | 15 (default) |
| `-XX:PretenureSizeThreshold` | Size threshold for direct allocation in old generation | No default |

### Best Practices

```bash
# Production environment recommendation
-Xms4g -Xmx4g        # Fixed heap size, avoid dynamic expansion/contraction
-Xmn1536m            # Young generation ~37.5% of heap
-XX:SurvivorRatio=8  # Eden:S0:S1 = 8:1:1
-XX:MaxTenuringThreshold=15
```

**Why set -Xms and -Xmx to the same value?**
- Avoid performance jitter from heap resizing
- Avoid Full GC during expansion
- Pre-allocate memory to ensure availability

### Non-Heap Memory

| Parameter | Description | Recommended Value |
|-----------|-------------|-------------------|
| `-XX:MetaspaceSize` | Initial metaspace size | 256m |
| `-XX:MaxMetaspaceSize` | Maximum metaspace size | 256m-512m |
| `-Xss` | Per-thread stack size | 256k-1m |
| `-XX:MaxDirectMemorySize` | Maximum direct memory | Same as -Xmx |
| `-XX:ReservedCodeCacheSize` | JIT code cache size | 240m (default) |

```bash
# Metaspace recommendation
-XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m

# Thread stack
-Xss512k    # General applications
-Xss256k    # High-concurrency applications (saves memory with many threads)
```

## GC Parameters

### Collector Selection

| Parameter | Collector Combination |
|-----------|----------------------|
| `-XX:+UseSerialGC` | Serial + Serial Old |
| `-XX:+UseParNewGC` | ParNew + Serial Old |
| `-XX:+UseParallelGC` | Parallel Scavenge + Parallel Old |
| `-XX:+UseConcMarkSweepGC` | ParNew + CMS + Serial Old (fallback) |
| `-XX:+UseG1GC` | G1 |
| `-XX:+UseZGC` | ZGC |
| `-XX:+UseShenandoahGC` | Shenandoah |

### Parallel Scavenge Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:MaxGCPauseMillis` | Maximum GC pause target | None |
| `-XX:GCTimeRatio` | Throughput target | 99 |
| `-XX:+UseAdaptiveSizePolicy` | Adaptive sizing | Enabled |
| `-XX:ParallelGCThreads` | GC thread count | CPU cores |

### CMS Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:CMSInitiatingOccupancyFraction` | Old generation occupancy trigger threshold | 68 (first time)/92 |
| `-XX:+UseCMSCompactAtFullCollection` | Compact fragmentation after Full GC | Enabled |
| `-XX:CMSFullGCsBeforeCompaction` | Number of Full GCs before compaction | 0 |
| `-XX:ConcGCThreads` | Concurrent GC thread count | (ParallelGCThreads+3)/4 |
| `-XX:+CMSParallelRemarkEnabled` | Parallel remark | Enabled |
| `-XX:+CMSParallelSurvivorRemarkEnabled` | Parallel Survivor remark | Enabled |

### G1 Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:MaxGCPauseMillis` | Target pause time | 200ms |
| `-XX:G1HeapRegionSize` | Region size | Auto-calculated |
| `-XX:InitiatingHeapOccupancyPercent` | Heap occupancy to trigger concurrent marking | 45% |
| `-XX:G1MixedGCCountTarget` | Mixed GC count target | 8 |
| `-XX:G1MixedGCLiveThresholdPercent` | Region liveness threshold for reclaim | 85% |
| `-XX:G1ReservePercent` | Reserved space to prevent promotion failure | 10% |
| `-XX:ParallelGCThreads` | STW phase parallel thread count | CPU cores |
| `-XX:ConcGCThreads` | Concurrent phase thread count | max(1, ParallelGCThreads/4) |

### ZGC Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:ZCollectionInterval` | GC interval (0 = adaptive) | 0 |
| `-XX:ZAllocationSpikeTolerance` | Allocation spike tolerance | 1 |
| `-XX:ZFragmentationLimit` | Fragmentation limit | 5% |
| `-XX:+ZGenerational` | Generational mode (JDK 21+) | Disabled |

## JIT Compilation Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:+TieredCompilation` | Tiered compilation | Enabled |
| `-XX:CompileThreshold` | Method invocation count for JIT | 10000 |
| `-XX:CompileThresholdScaling` | Threshold scaling factor | 1.0 |
| `-XX:+PrintCompilation` | Print JIT compilation log | Disabled |
| `-XX:ReservedCodeCacheSize` | Code cache size | 240MB |
| `-XX:+Inline` | Method inlining | Enabled |
| `-XX:MaxInlineSize` | Max bytecode size for inlined methods | 35 |
| `-XX:FreqInlineSize` | Inline size limit for frequently called methods | 325 |

```bash
# JIT debugging
-XX:+PrintCompilation          # View which methods are JIT-compiled
-XX:+UnlockDiagnosticVMOptions # Unlock diagnostic options
-XX:+LogCompilation            # Detailed compilation log (XML format)
```

## Thread Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-Xss` | Thread stack size | Platform-dependent |
| `-XX:ThreadStackSize` | Thread stack size (same as -Xss) | Platform-dependent |
| `-XX:+UseThreadPriorities` | Use thread priorities | Enabled |

```bash
# Thread stack calculation for high-concurrency applications
# Available memory = Physical memory - Heap - Metaspace - Code cache - OS reserved
# Max threads ≈ Available memory / Xss
# Example: (8G - 4G - 512M - 240M - 500M) / 512K ≈ 5400 threads
```

## Diagnostic Parameters

| Parameter | Description |
|-----------|-------------|
| `-XX:+HeapDumpOnOutOfMemoryError` | Auto heap dump on OOM |
| `-XX:HeapDumpPath=/path/to/dump` | Dump file path |
| `-XX:ErrorFile=/path/to/hs_err.log` | Fatal error log path |
| `-XX:+PrintGCDetails` | Print GC details (JDK 8) |
| `-XX:+PrintGCDateStamps` | Print GC timestamps (JDK 8) |
| `-Xlog:gc*:file=gc.log` | GC log (JDK 9+) |
| `-XX:+PrintSafepointStatistics` | Print safepoint statistics |
| `-XX:+PrintTLAB` | Print TLAB information |
| `-XX:+TraceClassLoading` | Trace class loading |
| `-XX:+TraceClassUnloading` | Trace class unloading |

## Parameter Quick Reference by Scenario

### By Use Case

**Web Service (Spring Boot)**
```bash
java -Xms2g -Xmx2g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=200 \
     -XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=256m \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/var/log/heapdump.hprof \
     -Xlog:gc*:file=/var/log/gc.log:time,uptime:filecount=5,filesize=20m \
     -jar app.jar
```

**Big Data (Spark/Flink)**
```bash
java -Xms8g -Xmx8g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:G1HeapRegionSize=16m \
     -XX:InitiatingHeapOccupancyPercent=35 \
     -XX:ParallelGCThreads=8 \
     -XX:ConcGCThreads=2 \
     -XX:+HeapDumpOnOutOfMemoryError \
     -jar app.jar
```

**Low-Latency (Trading Systems)**
```bash
java -Xms4g -Xmx4g \
     -XX:+UseZGC \
     -XX:ZAllocationSpikeTolerance=2 \
     -XX:ConcGCThreads=2 \
     -XX:+UnlockDiagnosticVMOptions \
     -XX:+ZStatisticsForceTrace \
     -XX:+HeapDumpOnOutOfMemoryError \
     -jar app.jar
```

**Microservice (Docker Container)**
```bash
java -Xms512m -Xmx512m \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:MetaspaceSize=128m -XX:MaxMetaspaceSize=128m \
     -XX:+UseContainerSupport \
     -XX:MaxRAMPercentage=75.0 \
     -jar app.jar
```

### Container-Aware Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `-XX:+UseContainerSupport` | Enable container awareness | Enabled (JDK 10+) |
| `-XX:MaxRAMPercentage` | Max heap as percentage of container memory | 25% |
| `-XX:InitialRAMPercentage` | Initial heap as percentage of container memory | 25% |
| `-XX:MinRAMPercentage` | Min heap as percentage of container memory | 50% |

```bash
# Docker container recommendation (4GB container memory)
-XX:+UseContainerSupport
-XX:MaxRAMPercentage=75.0     # 3GB heap
-XX:InitialRAMPercentage=75.0 # Initial heap = max heap
```

## Viewing Runtime Parameters

```bash
# View all JVM parameters (including defaults)
java -XX:+PrintFlagsFinal -version | grep -i "g1\|heap\|gc"

# View user-modified parameters only
java -XX:+PrintCommandLineFlags -version

# View at runtime
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jinfo -flags <pid>
```

## Summary

This chapter provided a systematic guide to JVM tuning parameters: memory parameters control the size of each area, GC parameters select the collector and adjust strategies, JIT parameters optimize compilation behavior, and diagnostic parameters help with troubleshooting. In production, it's recommended to start with scenario-based presets and then fine-tune based on actual monitoring data. The next chapter ties all the knowledge together through comprehensive tuning case studies.
