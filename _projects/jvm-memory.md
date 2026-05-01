---
layout: page
title: "内存模型与运行时数据区"
category: jvm-memory
sidebar: true
lang: zh
lang_alt: /en/jvm-memory/
sort_order: 2
nav:
  prev: /jvm-architecture/
  next: /jvm-object/
---

## 运行时数据区概览

JVM 在执行 Java 程序时将其管理的内存划分为若干运行时数据区。其中有些随线程创建和销毁，有些随 JVM 启动和退出：

```
┌──────────────────────────────────────────┐
│           线程共享（GC 管理）              │
│  ┌─────────────────┐ ┌────────────────┐  │
│  │      堆 (Heap)   │ │  方法区/元空间  │  │
│  └─────────────────┘ └────────────────┘  │
├──────────────────────────────────────────┤
│           线程私有（无 GC）               │
│  ┌──────┐ ┌─────────┐ ┌───────────────┐  │
│  │  PC  │ │ VM Stack │ │ Native Stack  │  │
│  └──────┘ └─────────┘ └───────────────┘  │
├──────────────────────────────────────────┤
│              直接内存                      │
└──────────────────────────────────────────┘
```

## 程序计数器（PC Register）

程序计数器是一块较小的内存空间，可以看作当前线程所执行的字节码的行号指示器。

- **线程私有**：每个线程有独立的程序计数器
- **唯一不会 OOM 的区域**：JVM 规范中没有规定任何 OutOfMemoryError 情况
- **执行 native 方法时**：计数器值为空（Undefined）

## 虚拟机栈（VM Stack）

虚拟机栈描述的是 Java 方法执行的内存模型：每个方法执行时会创建一个**栈帧（Stack Frame）**，存储局部变量表、操作数栈、动态链接和方法返回地址。

### 栈帧结构

```
┌───────────────────────┐
│    局部变量表           │  ← 方法参数 + 局部变量
├───────────────────────┤
│    操作数栈             │  ← 计算中间结果
├───────────────────────┤
│    动态链接             │  ← 指向运行时常量池的方法引用
├───────────────────────┤
│    方法返回地址         │  ← 方法正常/异常退出后返回的位置
├───────────────────────┤
│    附加信息             │  ← 调试信息等
└───────────────────────┘
```

### 局部变量表

- 以**变量槽（Slot）**为基本单位，64 位类型（long/double）占 2 个 Slot
- 实例方法第 0 个 Slot 为 `this` 引用
- 局部变量表大小在编译期确定，运行期不会改变
- **垃圾回收根节点**：局部变量表中的引用可作为 GC Roots

### 异常

- **StackOverflowError**：线程请求的栈深度超过允许值（递归调用常见）
- **OutOfMemoryError**：无法分配新栈（-Xss 设置栈大小，通常 256K-1M）

## 本地方法栈（Native Method Stack）

为虚拟机使用到的 native 方法服务。HotSpot 将虚拟机栈和本地方法栈合二为一。同样会抛出 StackOverflowError 和 OutOfMemoryError。

## 堆（Heap）

堆是 JVM 管理的最大一块内存，所有线程共享，在 JVM 启动时创建。几乎所有对象实例和数组都在堆上分配。

### 分代结构

HotSpot 采用**分代收集**策略，堆内存分为：

```
┌──────────────────────────────────────────────────┐
│                      堆 (Heap)                    │
├───────────────────────┬──────────────────────────┤
│       新生代 (Young)   │      老年代 (Old)         │
├──────────┬────────────┤                          │
│   Eden   │ Survivor   │                          │
│          │  S0  │ S1  │                          │
└──────────┴──────┴─────┴──────────────────────────┘
```

- **Eden 区**：新对象首先在 Eden 区分配
- **Survivor 区**（S0/S1 或 From/To）：GC 后存活的对象从 Eden 搬到 Survivor
- **老年代**：经过多次 GC 仍然存活的对象晋升到老年代

默认比例：新生代:老年代 = 1:2（`-XX:NewRatio=2`），Eden:S0:S1 = 8:1:1（`-XX:SurvivorRatio=8`）

### 堆内存参数

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `-Xms` | 初始堆大小 | 与 -Xmx 相同，避免动态扩容 |
| `-Xmx` | 最大堆大小 | 物理内存的 50-80% |
| `-Xmn` | 新生代大小 | 堆的 30-40% |
| `-XX:NewRatio` | 老年代/新生代比例 | 2（默认） |
| `-XX:SurvivorRatio` | Eden/Survivor 比例 | 8（默认） |
| `-XX:MaxTenuringThreshold` | 对象晋升老年代年龄 | 15（默认） |

### OOM 场景

```java
// 堆 OOM 示例
List<byte[]> list = new ArrayList<>();
while (true) {
    list.add(new byte[1024 * 1024]); // 每次分配 1MB
}
// java.lang.OutOfMemoryError: Java heap space
```

## 方法区与元空间

### 从永久代到元空间

| 版本 | 实现 | 存储位置 | 大小限制 |
|------|------|---------|---------|
| Java 7 及之前 | 永久代（PermGen） | 堆内存 | `-XX:MaxPermSize`（默认 64M/82M） |
| Java 8+ | 元空间（Metaspace） | 本地内存 | `-XX:MaxMetaspaceSize`（默认无限制） |

元空间使用本地内存（Native Memory），不再受堆大小限制，解决了永久代容易 OOM 的问题。

### 方法区存储内容

- **类的元数据**：类名、访问修饰符、字段描述、方法描述
- **运行时常量池**：编译期生成的各种字面量和符号引用
- **静态变量**：类级别的 static 变量（Java 7+ 移至堆中）
- **JIT 编译后的代码缓存**

### 运行时常量池

class 文件中的常量池在类加载后存入方法区的运行时常量池。相比 class 文件常量池，运行时常量池更具动态性——运行期间也可以将新的常量放入池中，如 `String.intern()` 方法。

```java
// String.intern() 示例
String s1 = new String("hello");  // 堆上创建对象
String s2 = s1.intern();          // 尝试将 "hello" 放入字符串常量池
String s3 = "hello";              // 直接引用常量池
System.out.println(s2 == s3);     // true
```

### 元空间 OOM

```java
// 动态生成类导致元空间 OOM
// 常见于 CGLIB、Spring AOP 大量生成代理类
// java.lang.OutOfMemoryError: Metaspace
```

参数：`-XX:MaxMetaspaceSize=256m` 限制元空间最大值

## 直接内存

直接内存（Direct Memory）不属于 JVM 规范定义的运行时数据区，但也被频繁使用：

- **NIO**：`ByteBuffer.allocateDirect()` 分配堆外直接内存，避免 IO 时数据在堆和内核间拷贝
- **JNI**：native 代码直接分配的内存
- **线程栈**：每个线程栈占用的内存

直接内存不受堆大小限制，但受物理内存限制。`-XX:MaxDirectMemorySize` 可设置上限（默认与 -Xmx 相同）。

```java
// 直接内存 OOM
ByteBuffer buffer = ByteBuffer.allocateDirect(1024 * 1024 * 1024);
// java.lang.OutOfMemoryError: Direct buffer memory
```

## 各区域 OOM 速查表

| 区域 | OOM 信息 | 触发条件 | 排查参数 |
|------|---------|---------|---------|
| 堆 | `Java heap space` | 对象过多 | `-XX:+HeapDumpOnOutOfMemoryError` |
| 栈 | `StackOverflowError` | 递归过深 | `-Xss` |
| 元空间 | `Metaspace` | 类加载过多 | `-XX:MaxMetaspaceSize` |
| 直接内存 | `Direct buffer memory` | NIO 使用过量 | `-XX:MaxDirectMemorySize` |
| 本地内存 | `Cannot reserve enough space` | 进程内存不足 | 减小堆/Xss |

## 小结

本章详细介绍了 JVM 运行时数据区的划分和各区域的特点。理解堆的分代结构、元空间的演进以及各区域的 OOM 触发条件，是后续学习垃圾回收和性能调优的基础。下一章将深入对象在 JVM 中的创建过程和内存布局。
