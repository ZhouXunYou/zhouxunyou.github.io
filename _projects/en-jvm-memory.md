---
layout: page
title: "Memory Model & Runtime Data Areas"
category: jvm-memory
sidebar: true
lang: en
lang_alt: /jvm-memory/
permalink: /en/jvm-memory/
sort_order: 2
nav:
  prev: /en/jvm-architecture/
  next: /en/jvm-object/
---

## Runtime Data Areas Overview

The JVM divides the memory it manages into several runtime data areas when executing a Java program. Some are created and destroyed with threads, while others exist for the lifetime of the JVM:

```
┌──────────────────────────────────────────┐
│        Thread-Shared (GC Managed)        │
│  ┌─────────────────┐ ┌────────────────┐  │
│  │   Heap           │ │ Method Area /  │  │
│  │                  │ │ Metaspace      │  │
│  └─────────────────┘ └────────────────┘  │
├──────────────────────────────────────────┤
│        Thread-Private (No GC)            │
│  ┌──────┐ ┌─────────┐ ┌───────────────┐  │
│  │  PC  │ │ VM Stack │ │ Native Stack  │  │
│  └──────┘ └─────────┘ └───────────────┘  │
├──────────────────────────────────────────┤
│            Direct Memory                  │
└──────────────────────────────────────────┘
```

## PC Register

The PC Register is a small memory space that acts as a line number indicator for the bytecode being executed by the current thread.

- **Thread-private**: Each thread has its own PC Register
- **The only area that never throws OOM**: The JVM specification defines no OutOfMemoryError conditions for it
- **When executing native methods**: The PC value is undefined

## VM Stack

The VM Stack describes the memory model for Java method execution. Each method invocation creates a **Stack Frame** that stores the local variable table, operand stack, dynamic linking, and method return address.

### Stack Frame Structure

```
┌───────────────────────┐
│  Local Variable Table │  ← Method parameters + local variables
├───────────────────────┤
│    Operand Stack      │  ← Intermediate computation results
├───────────────────────┤
│   Dynamic Linking     │  ← Reference to method in runtime constant pool
├───────────────────────┤
│  Method Return Address│  ← Return position after normal/exceptional exit
├───────────────────────┤
│   Additional Info     │  ← Debug info, etc.
└───────────────────────┘
```

### Local Variable Table

- Based on **Slots** as the fundamental unit; 64-bit types (long/double) occupy 2 Slots
- Slot 0 in instance methods holds the `this` reference
- The size of the local variable table is determined at compile time and does not change at runtime
- **GC Root**: References in the local variable table can serve as GC Roots

### Exceptions

- **StackOverflowError**: The thread's requested stack depth exceeds the allowed limit (common with recursive calls)
- **OutOfMemoryError**: Unable to allocate a new stack (use `-Xss` to set stack size, typically 256K–1M)

## Native Method Stack

Serves native methods used by the JVM. HotSpot combines the VM Stack and Native Method Stack into one. It can also throw StackOverflowError and OutOfMemoryError.

## Heap

The Heap is the largest piece of memory managed by the JVM, shared by all threads, and created at JVM startup. Nearly all object instances and arrays are allocated on the heap.

### Generational Structure

HotSpot employs a **generational collection** strategy, dividing heap memory into:

```
┌──────────────────────────────────────────────────┐
│                     Heap                          │
├───────────────────────┬──────────────────────────┤
│    Young Generation   │     Old Generation        │
├──────────┬────────────┤                          │
│   Eden   │ Survivor   │                          │
│          │  S0  │ S1  │                          │
└──────────┴──────┴─────┴──────────────────────────┘
```

- **Eden**: New objects are first allocated in Eden
- **Survivor** (S0/S1 or From/To): Objects surviving GC are moved from Eden to Survivor
- **Old Generation**: Objects surviving multiple GC cycles are promoted to the old generation

Default ratios: Young:Old = 1:2 (`-XX:NewRatio=2`), Eden:S0:S1 = 8:1:1 (`-XX:SurvivorRatio=8`)

### Heap Memory Parameters

| Parameter | Description | Recommended Value |
|-----------|-------------|-------------------|
| `-Xms` | Initial heap size | Same as -Xmx to avoid dynamic expansion |
| `-Xmx` | Maximum heap size | 50–80% of physical memory |
| `-Xmn` | Young generation size | 30–40% of heap |
| `-XX:NewRatio` | Old/Young generation ratio | 2 (default) |
| `-XX:SurvivorRatio` | Eden/Survivor ratio | 8 (default) |
| `-XX:MaxTenuringThreshold` | Age threshold for promotion to old gen | 15 (default) |

### OOM Scenario

```java
// Heap OOM example
List<byte[]> list = new ArrayList<>();
while (true) {
    list.add(new byte[1024 * 1024]); // Allocate 1MB each time
}
// java.lang.OutOfMemoryError: Java heap space
```

## Method Area and Metaspace

### From PermGen to Metaspace

| Version | Implementation | Storage Location | Size Limit |
|---------|---------------|-----------------|------------|
| Java 7 and earlier | Permanent Generation (PermGen) | Heap memory | `-XX:MaxPermSize` (default 64M/82M) |
| Java 8+ | Metaspace | Native memory | `-XX:MaxMetaspaceSize` (default unlimited) |

Metaspace uses native memory and is no longer constrained by heap size, resolving the OOM-prone nature of PermGen.

### Method Area Contents

- **Class metadata**: Class name, access modifiers, field descriptors, method descriptors
- **Runtime constant pool**: Compile-time generated literals and symbolic references
- **Static variables**: Class-level static variables (moved to the heap since Java 7+)
- **JIT-compiled code cache**

### Runtime Constant Pool

The constant pool in the class file is stored in the runtime constant pool of the method area after class loading. Compared to the class file constant pool, the runtime constant pool is more dynamic — new constants can be added at runtime, such as via the `String.intern()` method.

```java
// String.intern() example
String s1 = new String("hello");  // Creates object on the heap
String s2 = s1.intern();          // Attempts to add "hello" to the string constant pool
String s3 = "hello";              // Directly references the constant pool
System.out.println(s2 == s3);     // true
```

### Metaspace OOM

```java
// Dynamically generating classes leading to Metaspace OOM
// Common with CGLIB, Spring AOP generating large numbers of proxy classes
// java.lang.OutOfMemoryError: Metaspace
```

Parameter: `-XX:MaxMetaspaceSize=256m` to limit the maximum Metaspace size

## Direct Memory

Direct Memory is not part of the runtime data areas defined by the JVM specification, but it is frequently used:

- **NIO**: `ByteBuffer.allocateDirect()` allocates off-heap direct memory, avoiding data copying between the heap and kernel during I/O
- **JNI**: Memory directly allocated by native code
- **Thread stacks**: Memory occupied by each thread stack

Direct memory is not constrained by heap size but is limited by physical memory. `-XX:MaxDirectMemorySize` can set an upper limit (default equals -Xmx).

```java
// Direct memory OOM
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024 * 1024);
// java.lang.OutOfMemoryError: Direct buffer memory
```

## OOM Quick Reference Table

| Area | OOM Message | Trigger Condition | Troubleshooting Parameter |
|------|-------------|-------------------|--------------------------|
| Heap | `Java heap space` | Too many objects | `-XX:+HeapDumpOnOutOfMemoryError` |
| Stack | `StackOverflowError` | Excessive recursion depth | `-Xss` |
| Metaspace | `Metaspace` | Excessive class loading | `-XX:MaxMetaspaceSize` |
| Direct Memory | `Direct buffer memory` | Excessive NIO usage | `-XX:MaxDirectMemorySize` |
| Native Memory | `Cannot reserve enough space` | Insufficient process memory | Reduce heap/Xss |

## Summary

This chapter covered the JVM runtime data areas in detail, including the characteristics of each region. Understanding the heap's generational structure, the evolution from PermGen to Metaspace, and OOM trigger conditions for each area provides the foundation for learning about garbage collection and performance tuning. The next chapter will dive into object creation and memory layout in the JVM.
