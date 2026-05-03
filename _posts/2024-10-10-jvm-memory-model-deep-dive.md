---
layout: post
title: "JVM Memory Model Deep Dive"
date: 2024-10-10
categories: [jvm]
author: Zhou Xunyou
lang: zh
---

Understanding the JVM memory model is essential for writing high-performance Java applications and diagnosing production issues.

## Memory Regions

The JVM divides managed memory into several distinct regions:

| Region | Purpose | OutOfMemoryError |
|--------|---------|------------------|
| Heap | Object instances | `Java heap space` |
| Metaspace | Class metadata | `Metaspace` |
| Thread Stacks | Per-thread call frames | `unable to create new native thread` |
| Direct Buffer | Off-heap NIO buffers | `Direct buffer memory` |

## Heap Structure

```
┌──────────────────────────────────────────┐
│                  Heap                     │
├────────────┬──────────┬─────────────────┤
│   Young    │          │      Old        │
│ Generation │          │    Generation   │
├─────┬──────┤          │                 │
│ Eden│ S0/S1│          │                 │
└─────┴──────┴──────────┴─────────────────┘
```

### GC Flow

1. New objects allocated in **Eden**
2. Minor GC copies survivors to **Survivor** space
3. After surviving N cycles, promoted to **Old** generation
4. Major GC / Full GC cleans the entire heap

## Key JVM Flags

```bash
# Heap sizing
-Xms2g -Xmx2g                    # Initial & max heap
-XX:MetaspaceSize=256m            # Initial metaspace
-XX:MaxMetaspaceSize=512m         # Max metaspace

# GC Selection
-XX:+UseG1GC                      # G1 collector (default since JDK 9)
-XX:+UseZGC                       # ZGC for low-latency (JDK 15+)

# GC Logging
-Xlog:gc*:file=gc.log:time,level,tags

# Useful diagnostics
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/tmp/heapdump.hprof
```

## Common Pitfalls

- **OOME from thread creation**: Each thread stack consumes ~1MB. 2000 threads = 2GB off-heap
- **Metaspace leak**: Dynamic class generation (CGLIB, ByteBuddy) without unloading
- **Direct buffer leak**: NIO `ByteBuffer.allocateDirect()` not deallocated
- **Finalizer queue**: Objects with `finalize()` delay GC and consume heap

## Profiling Tips

Use async-profiler for production-safe profiling:

```bash
# CPU profiling
asprof -d 30 -f cpu.html <pid>

# Allocation profiling
asprof -d 30 -e alloc -f alloc.html <pid>

# Wall clock (includes blocking)
asprof -d 30 -e wall -f wall.html <pid>
```
