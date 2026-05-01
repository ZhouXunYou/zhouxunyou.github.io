---
layout: page
title: "Diagnostics & Troubleshooting"
category: jvm-diagnostics
sidebar: true
lang: en
lang_alt: /jvm-diagnostics/
permalink: /en/jvm-diagnostics/
sort_order: 8
nav:
  prev: /en/jvm-tools/
  next: /en/jvm-parameters/
---

## Troubleshooting Methodology

JVM troubleshooting follows a cycle of "Monitor → Locate → Analyze → Resolve → Verify":

```
Detect anomaly (monitoring alert / user report)
    │
    ▼
Locate problem (tool-based investigation)
    │
    ▼
Analyze cause (log/dump analysis)
    │
    ▼
Implement fix (parameter adjustment / code fix)
    │
    ▼
Verify results (compare against baseline)
```

## High CPU Usage Troubleshooting

### Investigation Steps

```
1. top — Find the Java process with high CPU usage
2. top -Hp <pid> — Find the high-CPU thread
3. printf '%x\n' <tid> — Convert to hexadecimal
4. jstack <pid> | grep <hex_tid> — View thread stack
5. Analyze hotspot methods
```

### Detailed Procedure

```bash
# 1. Find the Java process
top -c
# PID  USER   %CPU  %MEM  COMMAND
# 12345 app    98.2  15.3  java -jar app.jar

# 2. Find the high-CPU thread
top -Hp 12345
# PID    USER   %CPU  COMMAND
# 12350  app    95.1  java -jar app.jar

# 3. Convert thread ID to hexadecimal
printf '%x\n' 12350
# 303e

# 4. View thread stack
jstack 12345 | grep -A 30 "0x303e"
```

### Common Causes

| Cause | Stack Characteristic | Solution |
|-------|---------------------|----------|
| Infinite loop | Method stack repeatedly calls the same method | Fix code logic |
| Regex backtracking | `java.util.regex.Pattern` | Use possessive quantifiers or atomic groups |
| Frequent GC | `VM Thread` or GC threads have high CPU | Increase heap / optimize GC |
| Cryptographic operations | `sun.security.*` | Use caching / async |
| Serialization | `java.io.ObjectOutputStream` | Optimize serialization strategy |

### Quick Investigation with Arthas

```bash
# Directly find the top 3 threads by CPU usage
thread -n 3

# View specific thread stack
thread <thread-id>

# Trace method execution time
trace com.example.Service method
```

## Memory Leak Investigation

### Investigation Steps

```
1. Confirm memory is continuously growing (jstat/jmap/JFR)
2. Export heap dump (jmap -dump or -XX:+HeapDumpOnOutOfMemoryError)
3. Analyze dump with MAT
4. Find the leaking object and GC Roots reference chain
5. Fix the code
```

### Analyzing Heap Dumps with MAT

MAT (Memory Analyzer Tool) is a heap analysis tool provided by Eclipse.

**1. Leak Suspects Report**

After opening the dump, MAT automatically generates a leak suspects report identifying potential leak points:

```
Problem Suspect 1:
  The class java.util.concurrent.ConcurrentHashMap$Node occupies 256 MB (50%) of the heap.
  The class is loaded by org.apache.catalina.loader.WebappClassLoader.
  Keywords: java.util.concurrent.ConcurrentHashMap$Node

Problem Suspect 2:
  Thread main keeps local variables with total size 128 MB (25%).
```

**2. Dominator Tree**

View the object dominator tree, sorted by Retained Size:

```
Class                                    | Shallow Heap | Retained Heap
─────────────────────────────────────────|──────────────|──────────────
java.util.concurrent.ConcurrentHashMap   |        48 B  |      256 MB
  └─ java.util.concurrent.ConcurrentHashMap$Node[] | 1 MB |  255 MB
       └─ [0] ConcurrentHashMap$Node      |       32 B  |     10 MB
            └─ value: byte[10485760]      |   10 MB     |     10 MB
       └─ [1] ConcurrentHashMap$Node      |       32 B  |     20 MB
       └─ ...
```

- **Shallow Size**: Memory occupied by the object itself
- **Retained Size**: Total memory that would be freed if the object were garbage collected (including all objects it dominates)

**3. GC Roots Reference Chain**

Right-click object → Path To GC Roots → exclude weak/soft references:

```
Thread main
  └─ local variable: ConcurrentHashMap
       └─ [47] ConcurrentHashMap$Node
            └─ value: byte[10485760]   ← Leaking object
```

### Common Memory Leak Scenarios

| Scenario | Cause | Detection Method |
|----------|-------|-----------------|
| Uncleared collections | Map/List keeps adding without removing | MAT: find collection reference chain |
| ThreadLocal leak | Thread pool reuse causes ThreadLocal not to be released | Check ThreadLocalMap |
| Unregistered listeners | Registered but never unregistered | Search addListener/removeListener |
| Unclosed resources | Connections/streams not close()'d | Related objects in Finalizer queue |
| Unbounded cache | Custom cache with no size limit | Check cache-related object count |
| Inner class references | Non-static inner class holds outer class reference | MAT: view outer class references |

### ThreadLocal Leak Example

```java
// Wrong: ThreadLocal not cleaned in thread pool
ExecutorService pool = Executors.newFixedThreadPool(10);
pool.execute(() -> {
    threadLocal.set(largeObject);
    // Forgot remove! Thread is reused, largeObject cannot be collected
});

// Correct: Clean up in finally block
pool.execute(() -> {
    try {
        threadLocal.set(largeObject);
        // Business logic
    } finally {
        threadLocal.remove();  // Must clean up
    }
});
```

## OOM Failure Handling

### OOM Types and Investigation Paths

| OOM Message | Area | Investigation Direction |
|-------------|------|------------------------|
| `Java heap space` | Heap | Memory leak or insufficient heap |
| `Metaspace` | Metaspace | Too many classes loaded (dynamic proxies/CGLIB) |
| `GC overhead limit exceeded` | Heap | Poor GC reclaim efficiency (98% time in GC, reclaiming < 2%) |
| `Direct buffer memory` | Direct memory | NIO off-heap memory overflow |
| `Unable to create new native thread` | System memory | Too many threads |
| `Requested array size exceeds VM limit` | Heap | Array allocation too large |

### Heap OOM Investigation Flow

```
OOM: Java heap space
    │
    ├── Sudden OOM?
    │   ├── Yes → Check for bulk data loading
    │   │        → Increase -Xmx
    │   └── No (gradual growth) → Memory leak
    │
    ▼
Export heap dump for analysis
    │
    ├── Abnormal object count → Check code creating those objects
    │
    ├── Oversized collections → Check collection operation logic
    │
    └── Too many Classes/ClassLoaders → Check dynamic class generation
```

### Metaspace OOM Investigation

```bash
# View loaded class count
jcmd <pid> GC.class_stats | head -20

# View class histogram
jcmd <pid> GC.class_histogram | head -30

# Common causes
# 1. CGLIB/Spring AOP generating large numbers of proxy classes
# 2. JSPs frequently recompiled
# 3. Groovy/Scala scripts repeatedly compiled
# 4. ClassLoader leaks (web app hot deployment)

# Solutions
# - Increase metaspace: -XX:MaxMetaspaceSize=512m
# - Investigate class leaks: -XX:+TraceClassLoading -XX:+TraceClassUnloading
```

## Thread Deadlock Investigation

### Detecting Deadlocks

```bash
# Method 1: jstack automatic detection
jstack <pid>
# Output at the end will report:
# Found one Java-level deadlock:
# =============================
# "Thread-1":
#   waiting to lock monitor... (a java.lang.Object),
#   which is held by "Thread-0"
# "Thread-0":
#   waiting to lock monitor... (a java.lang.Object),
#   which is held by "Thread-1"

# Method 2: Arthas
thread -b

# Method 3: JMX
jconsole → Threads → Detect Deadlock
```

### Deadlock Types

**1. Classic Deadlock (two threads waiting for each other)**

```java
// Thread 1
synchronized(lockA) {
    synchronized(lockB) { /* ... */ }
}

// Thread 2
synchronized(lockB) {
    synchronized(lockA) { /* ... */ }
}
```

**2. Livelock (threads keep retrying but never succeed)**

```java
while (true) {
    if (tryLock()) {
        // Operation fails, release lock, retry immediately
        unlock();
    }
}
```

**3. Database Deadlock**

```sql
-- View deadlocks
SHOW ENGINE INNODB STATUS;
```

### Preventing Deadlocks

- Fixed lock ordering
- Use `tryLock(timeout)` instead of `lock()`
- Reduce lock granularity
- Use concurrent utility classes instead of explicit locking

## Class Loading Conflict Investigation

### Common Errors

| Error | Cause |
|-------|-------|
| `ClassNotFoundException` | Class not found on classpath |
| `NoClassDefFoundError` | Class existed at compile time but not at runtime |
| `ClassCastException` | Same-named class loaded by different ClassLoaders |
| `LinkageError` | Class version mismatch |

### Investigation Methods

```bash
# View class loading source
jcmd <pid> VM.system_properties | grep java.class.path

# Find classes with Arthas
sc -d com.example.MyClass
# classLoaderHash  classLoaderName  loading source

# Find all ClassLoaders
classloader -t

# View which jar a class is loaded from
classloader -c <hash> -r com/example/MyClass.class
```

### Maven Dependency Conflicts

```bash
# View dependency tree
mvn dependency:tree -Dverbose | grep conflicting-lib

# Exclude conflicting dependency
<exclusion>
    <groupId>com.example</groupId>
    <artifactId>conflicting-lib</artifactId>
</exclusion>
```

## Emergency Handling Procedures

### Application Unresponsive

```bash
# 1. Check if process is alive
ps aux | grep java

# 2. Check CPU usage
top -Hp <pid>

# 3. Export thread dumps (3 consecutive times, 5 seconds apart)
jstack <pid> > dump1.txt
sleep 5
jstack <pid> > dump2.txt
sleep 5
jstack <pid> > dump3.txt

# 4. Export heap dump (optional, risky)
jcmd <pid> GC.heap_dump filename=emergency_dump.hprof

# 5. If jstack doesn't work, use forced mode
jstack -F <pid> > forced_dump.txt

# 6. If completely unresponsive, generate core dump
gcore <pid>
```

### Frequent Full GC Emergency

```bash
# 1. Confirm Full GC frequency
jstat -gcutil <pid> 1000 10

# 2. Export heap histogram
jcmd <pid> GC.class_histogram > histo.txt

# 3. If memory leak confirmed, export dump
jcmd <pid> GC.heap_dump filename=fullgc_dump.hprof

# 4. Temporary mitigation: increase heap + switch collector
# Modify startup parameters and restart
java -Xmx4g -XX:+UseG1GC -jar app.jar
```

## Summary

This chapter covered troubleshooting methods for common JVM failures: high CPU usage with top+jstack to locate hotspot threads; memory leaks with MAT for heap dump analysis; OOM by type for different areas; deadlocks with jstack or Arthas. Mastering these troubleshooting methods enables quick identification and resolution of JVM issues in production. The next chapter will systematically cover JVM tuning parameters.
