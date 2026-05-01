---
layout: page
title: "JVM Architecture Overview"
category: jvm-architecture
sidebar: true
lang: en
lang_alt: /jvm-architecture/
permalink: /en/jvm-architecture/
sort_order: 1
nav:
  prev:
  next: /en/jvm-memory/
---

## JVM Overall Architecture

The Java Virtual Machine (JVM) is a virtual machine instance that executes Java bytecode. The HotSpot JVM architecture consists of three major subsystems:

- **Class Loader Subsystem**: Responsible for loading class files from disk or network, and completing linking and initialization
- **Runtime Data Areas**: Memory regions managed by the JVM during execution, including the heap, stack, method area, etc.
- **Execution Engine**: Responsible for executing bytecode, comprising the interpreter, JIT compiler, and garbage collector

```
┌─────────────────────────────────────────────────┐
│                  Class Loader                    │
│  Loading → Linking (Verify/Prepare/Resolve)      │
│             → Initialization                     │
├─────────────────────────────────────────────────┤
│              Runtime Data Areas                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │ Heap │ │Method│ │  PC  │ │  VM  │ │Native│  │
│  │      │ │ Area │ │ Reg  │ │Stack │ │Stack │  │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │
├─────────────────────────────────────────────────┤
│              Execution Engine                    │
│  Interpreter │ JIT Compiler │ GC                 │
└─────────────────────────────────────────────────┘
```

## Class Loading Mechanism

### Parents Delegation Model

The JVM employs the Parents Delegation model for class loading:

1. **Bootstrap ClassLoader**: Loads core class libraries from `<JAVA_HOME>/lib` (e.g., `rt.jar`)
2. **Extension ClassLoader**: Loads extension libraries from `<JAVA_HOME>/lib/ext`
3. **Application ClassLoader**: Loads classes from the user classpath

When a class loading request is received, the class loader first delegates the request to its parent loader. Only when the parent loader cannot complete the loading does the loader attempt to load the class itself. This ensures the security and uniqueness of core class libraries.

### Breaking the Parents Delegation Model

The following scenarios require breaking the Parents Delegation model:

- **SPI Mechanism**: For example, JDBC — the core class `java.sql.Driver` is loaded by Bootstrap, but its implementations are on the classpath. This is resolved through the Thread Context ClassLoader
- **Tomcat Class Loading**: Each web application has its own WebAppClassLoader that prioritizes loading the application's own classes, achieving isolation between applications
- **OSGi Modularization**: A mesh-like class loading structure where each Bundle has its own class loader

### Custom ClassLoader

Extend `java.lang.ClassLoader` and override the `findClass()` method to implement a custom class loader. Typical use cases:

- Loading classes from network, database, or encrypted files
- Implementing class hot-swapping (Hot Swap)
- Achieving application isolation

```java
public class CustomClassLoader extends ClassLoader {
    private byte[] loadClassData(String name) {
        // Load class bytecode from a custom source
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] data = loadClassData(name);
        return defineClass(name, data, 0, data.length);
    }
}
```

## JIT Compiler

### Interpretation vs Compilation

The JVM initially uses the interpreter to execute bytecode instruction by instruction, which is relatively slow. The JIT (Just-In-Time) compiler compiles hot spots into native machine code at runtime, significantly improving execution speed.

### Tiered Compilation

HotSpot has supported tiered compilation since Java 7, with 5 compilation tiers:

| Tier | Compiler | Description |
|------|----------|-------------|
| 0 | Interpreter | Interpreted execution, collects profiling information |
| 1 | C1 | Simple compilation, no profiling |
| 2 | C1 | Compilation with limited profiling |
| 3 | C1 | Compilation with full profiling |
| 4 | C2 | Fully optimized compilation |

Default strategy: Code is first executed by the interpreter (tier 0). When the invocation count exceeds the threshold, it is compiled by C1 (tier 3). After sufficient profiling data is collected, it is then compiled by C2 (tier 4).

### Hot Spot Detection

JIT compilation determines hot spots based on the **method invocation counter** and **back-edge counter**:

- **Method Invocation Counter**: Tracks the number of times a method is invoked; triggers JIT compilation when the threshold is exceeded
- **Back-Edge Counter**: Tracks the number of loop back-edges; triggers OSR (On-Stack Replacement) compilation when the threshold is exceeded

Related parameters:
- `-XX:CompileThreshold`: Method invocation threshold (C1 default 1500, C2 default 10000)
- `-XX:-TieredCompilation`: Disable tiered compilation
- `-XX:+PrintCompilation`: Print JIT compilation logs

## JVM Specifications and Implementations

### JVM Specification

The *Java Virtual Machine Specification* defines:

- Class file format
- Data types and values
- Runtime data areas
- Stack frame structure
- Instruction set
- Class loading and linking process

The specification does not constrain implementation approaches — it only prescribes external behavior.

### Mainstream Implementations

| Implementation | Characteristics |
|----------------|-----------------|
| **HotSpot** | Oracle/OpenJDK default JVM, most widely used, includes C1/C2 compilers |
| **OpenJ9** | Contributed by IBM to Eclipse, fast startup, low memory footprint |
| **GraalVM** | Supports multiple languages (Java/JS/Python/Ruby), Truffle framework, Native Image |
| **Zing** | Azul Systems, pauseless GC based on the C4 algorithm |
| **Dragonwell** | Alibaba, based on OpenJDK, optimized for e-commerce scenarios |

## Summary

This chapter provided an overview of the JVM architecture. Understanding the class loading mechanism, JIT compilation principles, and characteristics of different JVM implementations lays the foundation for in-depth JVM tuning. The next chapter will cover the JVM memory model and runtime data areas in detail.
