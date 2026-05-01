---
layout: page
title: "Garbage Collection Algorithms"
category: jvm-gc-algorithms
sidebar: true
lang: en
lang_alt: /en/jvm-gc-algorithms/
permalink: /en/jvm-gc-algorithms/
sort_order: 4
nav:
  prev: /en/jvm-object/
  next: /en/jvm-gc-collectors/
---

## Garbage Collection Overview

Garbage Collection (GC) is the core mechanism of automatic memory management in the JVM. GC needs to address three fundamental questions:

1. **Which memory should be reclaimed?** — Object liveness determination
2. **When to reclaim?** — GC trigger timing
3. **How to reclaim?** — Garbage collection algorithms

## Object Liveness Determination

### Reference Counting

Add a reference counter to each object — increment by 1 when referenced, decrement by 1 when a reference is invalidated, and reclaim when the count reaches 0.

**Fatal flaw**: Cannot resolve circular references.

```java
Object a = new Object();
Object b = new Object();
a.field = b;
b.field = a;
a = null;
b = null;
// Both objects reference each other, counters != 0, but actually unreachable
```

The JVM does not use reference counting; it uses reachability analysis instead.

### Reachability Analysis Algorithm

Starting from **GC Roots**, follow the reference chains downward. The path traversed is called a Reference Chain. When an object has no reference chain connecting it to any GC Root, the object is proven unreachable and can be reclaimed.

```
GC Roots ──→ A ──→ B ──→ D
              │
              └──→ C ──→ E

     F ──→ G (unreachable, can be reclaimed)
```

### GC Roots

Objects that can serve as GC Roots include:

| Source | Description |
|--------|-------------|
| Objects referenced in the VM stack | References in local variable tables of each stack frame |
| Objects referenced by static fields in the method area | Variables modified with `static` |
| Objects referenced by constants in the method area | Variables modified with `final static` |
| Objects referenced by JNI in the native method stack | Objects referenced by native methods |
| JVM internal references | Class objects for primitive types, resident exceptions, class loaders, etc. |
| Objects held by synchronized locks | Objects locked by `synchronized` |
| Callbacks registered in JMXBean, JVMTI | Runtime management interface references |

### Four Reference Types

Since JDK 1.2, references have been classified into four types:

| Reference Type | Characteristics | Reclamation Timing | Use Case |
|---------------|----------------|-------------------|----------|
| **Strong Reference** | `Object obj = new Object()` | Never reclaimed (as long as the reference exists) | Normal object references |
| **Soft Reference** | `SoftReference<T>` | Reclaimed when memory is low | Caching |
| **Weak Reference** | `WeakReference<T>` | Reclaimed on the next GC | WeakHashMap, ThreadLocal |
| **Phantom Reference** | `PhantomReference<T>` | Reclaimed at any time; only used for tracking GC | Tracking GC, managing off-heap memory |

```java
// Soft reference example - suitable for caching
SoftReference<byte[]> cache = new SoftReference<>(new byte[1024 * 1024]);
byte[] data = cache.get();  // May return null (if already reclaimed by GC)

// Weak reference example - suitable for temporary mappings
WeakReference<Key> ref = new WeakReference<>(key);

// Phantom reference example - used with ReferenceQueue
ReferenceQueue<Object> queue = new ReferenceQueue<>();
PhantomReference<Object> phantom = new PhantomReference<>(obj, queue);
// After the object is reclaimed, the phantom reference is enqueued;
// off-heap memory can be cleaned up here
```

## Basic Garbage Collection Algorithms

### Mark-Sweep Algorithm

The most basic collection algorithm, operating in two phases:

1. **Mark**: Starting from GC Roots, mark all reachable objects
2. **Sweep**: Traverse the heap and reclaim unmarked objects

```
Before marking:  [A] [B] [C] [D] [E] [F]
                       ↑       ↑   ↑
                    reachable reachable reachable

After marking:   [A✓] [B] [C✓] [D] [E✓] [F]

After sweeping:  [  ] [C✓] [  ] [E✓] [  ]  ← Memory fragmentation
```

- **Advantage**: Simple implementation, no need to move objects
- **Disadvantages**:
  - Produces large amounts of non-contiguous memory fragmentation
  - Allocating large objects may trigger another GC
  - Both marking and sweeping are inefficient

### Copying Algorithm

Divide memory into two equal-sized regions, using only one at a time:

1. Copy surviving objects to the other region
2. Clear all objects in the current region
3. Swap the roles of the two regions

```
From space:  [A✓] [B] [C✓] [D] [E✓] [F]
                        ↓ copy
To space:    [A] [C] [E] [              ]  ← Contiguous space, no fragmentation
```

- **Advantage**: Simple implementation, efficient execution, no memory fragmentation
- **Disadvantage**: Available memory is halved, low space utilization

**Optimization**: In the young generation, 98% of objects are "short-lived", so a 1:1 split is unnecessary. HotSpot defaults to Eden:S0:S1 = 8:1:1, wasting only 10% of space.

### Mark-Compact Algorithm

Combines the advantages of Mark-Sweep and Copying:

1. **Mark**: Same as Mark-Sweep
2. **Compact**: Move all surviving objects to one end, then clear the memory beyond the boundary

```
After marking:  [A✓] [B] [C✓] [D] [E✓] [F]

After compacting: [A] [C] [E] [              ]  ← Contiguous space, no fragmentation
```

- **Advantage**: No memory fragmentation, no need to sacrifice extra space
- **Disadvantage**: Moving objects requires updating references, which is less efficient (especially when many objects survive)

### Algorithm Comparison

| Algorithm | Mark-Sweep | Copying | Mark-Compact |
|-----------|-----------|---------|-------------|
| Speed | Medium | Fastest | Slowest |
| Space Overhead | Low (with fragmentation) | High (2x space) | Low (no fragmentation) |
| Moves Objects | No | Yes | Yes |
| Suitable For | Old generation (CMS) | Young generation | Old generation |

## Generational Collection Theory

### Theoretical Foundation

Generational collection is based on two hypotheses:

1. **Weak generational hypothesis**: The vast majority of objects die young
2. **Strong generational hypothesis**: Objects that survive more GC cycles are harder to reclaim

Based on these hypotheses, the JVM divides the heap into a young generation and an old generation, applying different collection algorithms to each:

- **Young generation**: Low object survival rate, suitable for the Copying algorithm (only need to copy few surviving objects)
- **Old generation**: High object survival rate, suitable for Mark-Sweep or Mark-Compact algorithms

### Cross-Generational References

Cross-generational references (old generation referencing young generation, or vice versa) are problematic. If Minor GC only scans the young generation, how can we ensure that young generation objects referenced by the old generation are not mistakenly reclaimed?

**Solution: Remembered Set**

The Remembered Set records pointers from non-collection regions to collection regions. During young generation GC, only the Remembered Set needs to be scanned rather than the entire old generation.

HotSpot implements the Remembered Set using a **Card Table**: the old generation is divided into fixed-size card pages (512 bytes), each corresponding to one byte in the card table. When a reference field in a card page of the old generation is modified, the corresponding entry in the card table is marked as "dirty".

```
Card table:  [0] [0] [1] [0] [0] [1] [0] [0]
                   ↑           ↑
                Dirty page   Dirty page
           (cross-gen ref) (cross-gen ref)
```

Write barriers are used to maintain the card table, updating card table state on reference assignments.

## Safepoints and Safe Regions

### Safepoint

GC must ensure a consistent state — that is, no thread's reference relationships are changing. The JVM achieves this through Safepoints:

- **Safepoint locations**: Method calls, loop back-edges, exception jumps, etc.
- **Arrival methods**:
  - **Preemptive suspension** (deprecated): GC interrupts all threads; those not at a safepoint are resumed to reach one
  - **Voluntary suspension** (used by HotSpot): A flag is set; threads actively check and suspend themselves at safepoints

```bash
# Safepoint-related parameters
-XX:+PrintSafepointStatistics       # Print safepoint statistics
-XX:PrintSafepointStatisticsCount=1 # Print on every safepoint
```

### Safe Region

Safepoints solve the problem for "executing" threads, but for **blocked or sleeping** threads (e.g., `Thread.sleep()`, waiting for I/O), they cannot actively reach a safepoint.

A Safe Region is an extension of the Safepoint concept: within a Safe Region, reference relationships do not change. When a thread enters a Safe Region, it marks itself; when leaving, it checks whether GC has completed. If not, the thread waits.

## Incremental Update vs SATB

During the concurrent marking phase, collector threads and user threads run simultaneously, which may cause the **object disappearance** problem:

> A black object (marked) adds a new reference to a white object (unmarked), while a gray object (not fully scanned) removes its reference to the white object. The white object is incorrectly reclaimed.

Two solutions:

### Incremental Update

**Used by CMS**. When a black object inserts a new reference to a white object, this reference is recorded. After GC completes, the recorded references are used as roots for rescanning.

**Essence**: Focuses on reference additions.

### SATB (Snapshot At The Beginning)

**Used by G1**. When a gray object removes a reference to a white object, the deleted reference is recorded. After GC completes, the recorded references are used as roots for rescanning.

**Essence**: Focuses on reference deletions, ensuring consistency of the object graph at the start of GC.

```
         Incremental Update              SATB
         Record added refs            Record deleted refs
         (A → C added)               (B → C deleted)

   A(black) ──add──→ C(white)    A(black) ──→ C(white)
   B(gray)  ──del──↗              B(gray)  ──×──→ C
```

## Summary

This chapter introduced the core algorithms and theoretical foundations of garbage collection. Understanding reachability analysis and GC Roots is key to determining which objects can be reclaimed; understanding the pros and cons of the three basic algorithms is foundational for learning about specific collectors; understanding generational theory, remembered sets, and safepoints helps explain GC implementation mechanisms. The next chapter will detail various garbage collectors.
