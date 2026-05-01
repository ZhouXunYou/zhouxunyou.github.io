---
layout: post
title: "JVM 内存模型入门：一文看懂堆与非堆"
date: 2024-11-01
category: java
author: Zhou Xunyou
---

JVM 运行时数据区是理解 Java 内存管理的基础。本文从整体架构出发，介绍 JVM 如何划分内存、各区域的作用以及常见的内存溢出场景。

## JVM 内存全景图

JVM 在运行时将内存划分为多个区域，大致可分为**线程共享区域**和**线程私有区域**：

```
┌─────────────────────────────────────────────────────────────┐
│                        JVM 进程内存                          │
├─────────────────────────┬───────────────────────────────────┤
│     线程共享区域         │         线程私有区域               │
│  ┌─────────────────┐   │   ┌──────────┐ ┌──────────┐       │
│  │  Heap (堆)     │   │   │ VM Stack │ │ VM Stack │  ... │
│  │  - Young Gen   │   │   │ (每个    │ │ (每个    │       │
│  │    - Eden      │   │   │  线程    │ │  线程    │       │
│  │    - S0 / S1   │   │   │  私有)  │ │  私有)  │       │
│  │  - Old Gen     │   │   └──────────┘ └──────────┘       │
│  └─────────────────┘   │   ┌──────────┐                    │
│  ┌─────────────────┐   │   │Native    │                    │
│  │  Metaspace     │   │   │Method    │                    │
│  │  (元空间)       │   │   │Area/     │                    │
│  └─────────────────┘   │   │Stack     │                    │
└─────────────────────────┴───────────────────────────────────┘
```

## 堆（Heap）— 对象的大本营

堆是 JVM 最大的一块内存区域，**所有通过 `new` 关键字创建的对象都存放在这里**，由所有线程共享。

### 堆的内部结构

现代 JVM（尤其是 G1GC）将堆划分为多个区域：

```
┌──────────────────────────────────────────────┐
│                   Heap (堆)                    │
├──────────────────────────┬─────────────────────┤
│       Young Generation   │   Old Generation    │
│   ┌──────┬──────┬────┐  │   ┌──────────────┐ │
│   │ Eden │  S0  │ S1 │  │   │              │ │
│   │      │ (From)│   │  │   │   (Tenured)   │ │
│   │      │ (To) │    │  │   │              │ │
│   └──────┴──────┴────┘  │   └──────────────┘ │
│      ↓ Minor GC          │      ↓ Major GC    │
└──────────────────────────┴─────────────────────┘
```

### 对象分配流程

1. 新对象首先在 **Eden 区** 分配
2. Eden 区满时触发 **Minor GC**，存活对象复制到 Survivor 区（S0 或 S1）
3. 对象在 S0/S1 之间复制交换，每经历一次 Minor GC 年龄计数器 +1
4. 年龄达到阈值（默认 15，可通过 `-XX:MaxTenuringThreshold` 设置）的对象晋升到 **Old 区**
5. Old 区满时触发 **Major GC** 或 **Full GC**

## 方法区（Metaspace）— 类的家

方法区存储**类的元数据**：类的结构信息（字段、方法、构造函数）、运行时常量池、 JIT 编译后的代码等。

> **注意**：在 JDK 8 之前，方法区由 **PermGen（永久代）** 实现，存在大小上限且容易 OOM。JDK 8+ 改用 **Metaspace**，使用本地内存（Native Memory），理论上不受堆大小限制，但也会因为加载过多类而导致 OOM。

```
JDK 7 及之前：
┌─────────────────────────┐
│         PermGen          │  ← 有固定上限（-XX:PermSize）
│  - 类元数据             │
│  - 字符串常量池          │
│  - JIT 编译代码         │
└─────────────────────────┘

JDK 8+：
┌─────────────────────────┐
│       Metaspace         │  ← 使用本地内存，动态扩展
│  - 类元数据             │  ← 默认无上限，受 OS 可用内存限制
│  - 字符串常量池移至堆     │
│  - JIT 编译代码         │
└─────────────────────────┘
```

## 线程私有区域

### 虚拟机栈（VM Stack）

每个线程在创建时拥有一个独立的虚拟机栈，存储**方法调用的栈帧（Stack Frame）**。

```
线程 A 的 VM Stack：
┌────────────┐
│  Frame: main() │  ← 栈顶（当前执行帧）
├────────────┤
│  Frame: foo()  │
├────────────┤
│  Frame: bar()  │
└────────────┘

每个 Frame 包含：
  - 局部变量表（Local Variables）
  - 操作数栈（Operand Stack）
  - 帧数据（Frame Data）
```

### 本地方法栈（Native Method Stack）

与 VM Stack 类似，但为 **Native（C/C++）方法** 服务。HotSpot JVM 将两者合一实现。

## 常见内存溢出（OOM）场景

| 区域 | 错误信息 | 常见原因 |
|------|---------|---------|
| Heap | `java.lang.OutOfMemoryError: Java heap space` | 创建过多对象、大数组、内存泄漏 |
| Metaspace | `java.lang.OutOfMemoryError: Metaspace` | 动态类加载（CGLIB、ByteBuddy）过多 |
| VM Stack | `java.lang.StackOverflowError` | 递归调用过深（单线程）、线程创建过多 |
| Direct Memory | `java.lang.OutOfMemoryError: Direct buffer memory` | NIO `ByteBuffer.allocateDirect()` 使用过多 |

## 快速验证

```bash
# 查看 JVM 默认内存布局
java -XX:+PrintFlagsFinal -version 2>&1 | grep -i HeapSize

# 启动时指定堆大小
java -Xms256m -Xmx512m -XX:+UseG1GC your-app.jar

# 打印 GC 日志
java -Xms256m -Xmx512m -XX:+UseG1GC \
     -Xlog:gc*:file=gc.log:time,level,tags \
     your-app.jar
```

## 总结

- **堆**是 Java 内存管理的核心，所有对象在堆中分配，由 GC 自动回收
- **Metaspace** 存储类元数据，JDK 8 后使用本地内存
- **VM Stack** 是线程私有的，记录方法调用链路
- 理解各区域职责是排查 OOM 的第一步

下一篇将深入讲解**垃圾回收算法**——标记、清除、复制、压缩各有何优缺点。
