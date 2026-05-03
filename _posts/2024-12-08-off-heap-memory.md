---
layout: post
title: "堆外内存与 DirectByteBuffer：高性能 I/O 的幕后功臣"
date: 2024-12-08
categories: [jvm]
author: Zhou Xunyou
lang: zh
---

除了堆内内存，JVM 还有一块常被忽视但至关重要的内存区域——**堆外内存（Off-Heap / Direct Memory）**。它由 NIO 的 `DirectByteBuffer` 和 native 代码使用，是高性能 I/O 的基础。

## 什么是堆外内存？

堆外内存是 ** JVM 堆以外、由操作系统直接管理的内存**，也叫做 **Direct Memory** 或 **Native Memory**。

```
JVM 进程内存布局：

┌──────────────────────────────────────────────────┐
│  JVM 进程（操作系统视角）                            │
│                                                   │
│  ┌────────────────────┐                          │
│  │    Java Heap (堆)    │  ← -Xms/-Xmx 控制    │
│  │   - 对象在此分配      │                        │
│  │   - 由 GC 管理        │                        │
│  └────────────────────┘                          │
│                                                   │
│  ┌────────────────────┐                          │
│  │  Metaspace          │  ← 类元数据              │
│  └────────────────────┘                          │
│                                                   │
│  ┌────────────────────┐                          │
│  │  Thread Stacks      │  ← 每个线程 ~1MB        │
│  └────────────────────┘                          │
│                                                   │
│  ┌────────────────────┐                          │
│  │  Direct Memory     │  ← NIO Buffer、native代码│
│  │  (堆外内存/本地内存)  │    不受 GC 直接管理      │
│  └────────────────────┘                          │
│                                                   │
│  ┌────────────────────┐                          │
│  │  JIT Compiled Code  │  ← JIT 编译后的机器码   │
│  └────────────────────┘                          │
│                                                   │
│  ┌────────────────────┐                          │
│  │  Internal / malloc  │  ← JVM 内部数据机构      │
│  └────────────────────┘                          │
└──────────────────────────────────────────────────┘
```

## 为什么需要堆外内存？

### 传统 I/O 的问题：内核缓冲区复制

```
传统 I/O（堆内 ByteBuffer）：

用户进程                     内核                    硬件
    │                        │                       │
    │  read(socket)          │                       │
    │ ─────────────────────→ │                       │
    │                        │  DMA 读取数据          │
    │                        │ ─────────────────────→ │
    │                        │                       │
    │   ① 内核缓冲区 → 用户缓冲区（复制）              │
    │ ←────────────────────── │                       │
    │                        │                       │
    │  ② JVM 堆内 Buffer 填充（又一次复制）           │
    │ ←────────────────────── │                       │
    │
问题：经历了两次数据复制！
```

### 零拷贝 I/O：堆外内存的解决方案

```
DMA I/O（DirectByteBuffer / 零拷贝）：

用户进程                     内核                    硬件
    │                        │                       │
    │  read(socket)          │                       │
    │ ─────────────────────→ │                       │
    │                        │  DMA 读取数据          │
    │                        │ ─────────────────────→ │
    │                        │                       │
    │  ① 直接在内核缓冲区使用，无需复制到用户空间       │
    │ ←────────────────────── │                       │
    │                        │                       │
    │
优点：只需一次 DMA 复制，不经过 JVM 堆！
```

## DirectByteBuffer 详解

### 创建与内存分配

```java
// 分配一块 64MB 的堆外内存
ByteBuffer buffer = ByteBuffer.allocateDirect(64 * 1024 * 1024);

// 写入数据
buffer.put("Hello, Off-Heap!".getBytes());
buffer.flip();

// 读取数据
byte[] data = new byte[buffer.remaining()];
buffer.get(data);
```

### DirectByteBuffer 的内存管理

`DirectByteBuffer` 对象本身在**堆内**（由 GC 管理），但它持有的**数据**在**堆外内存**中：

```
堆内（GC 管理）：
┌──────────────────────────────────────────────┐
│  DirectByteBuffer 对象                      │
│  - address: 0x7f8e000000L  （指向堆外地址）│
│  - capacity: 67108864                       │
│  - cleaner: Cleaner (虚引用)                │
└──────────────────────────────────────────────┘
              ↓ address 字段
堆外（OS 直接管理）：
┌──────────────────────────────────────────────┐
│  64MB Direct Memory                        │
│  0x7f8e000000 ~ 0x7f8e3FFFFF             │
│  数据在此                                  │
└──────────────────────────────────────────────┘
```

### 释放机制：PhantomReference + Cleaner

`DirectByteBuffer` 不再被引用时，GC 会回收堆内的 `DirectByteBuffer` 对象，其关联的** Cleaner（虚引用）**被加入 ReferenceQueue。GC 完成后， Cleaner 线程负责调用 `unsafe.freeMemory()` 释放堆外内存：

```
DirectByteBuffer 对象（堆内）
        ↓（不再被引用）
    GC 回收该对象
        ↓（虚引用被加入 ReferenceQueue）
    Cleaner 线程检测到引用
        ↓
    unsafe.freeMemory(address)  ← 释放堆外内存
```

## 堆外内存常见问题

### 1. Direct Memory OOM

**现象**：

```
java.lang.OutOfMemoryError: Direct buffer memory
    at java.nio.Bits.reserveMemory(Bits.java:217)
    at java.nio.DirectByteBuffer.<init>(DirectByteBuffer.java:104)
```

**原因**：堆外内存耗尽。通常是因为分配速度 > 释放速度，或 `MaxDirectMemorySize` 设置过小。

```bash
# 默认 MaxDirectMemorySize = -Xmx（堆最大内存）
# 设置堆外内存上限
-XX:MaxDirectMemorySize=512m
```

### 2. 堆外内存泄漏

**原因**：大量创建 `DirectByteBuffer` 但未及时释放（尤其在高并发 I/O 场景）。

```java
// 问题代码：每次请求都创建新的 DirectByteBuffer，但没有及时释放
public String readChannel(SocketChannel ch) throws IOException {
    ByteBuffer buf = ByteBuffer.allocateDirect(8 * 1024);  // 每次 8KB
    // ... 读写操作
    // ❌ buf 对象可能仍然被 channel 或其他引用持有
}
```

**正确做法**：使用对象池或复用 Buffer：

```java
// 复用 Buffer，避免频繁分配
ByteBuffer buf = ByteBuffer.allocateDirect(8 * 1024);
while (ch.read(buf) != -1) {
    buf.flip();
    process(buf);
    buf.clear();  // 复用，不创建新对象
}
```

### 3. -XX:NativeMemoryTracking 查看堆外内存

```bash
# 启动时开启 NMT
java -XX:NativeMemoryTracking=detail \
     -XX:+UseG1GC \
     -Xms4g -Xmx4g \
     your-app.jar

# 运行时查看内存分布（需要 jcmd）
jcmd <pid> VM.native_memory summary

# 示例输出：
# Native Memory Tracking:
# Total: reserved=4856MB, committed=4856MB
# - Java Heap (reserved=4096MB, committed=4096MB)
# - Class (reserved=128MB, committed=128MB)
# - Thread (reserved=64MB, committed=64MB)
# - Code (reserved=48MB, committed=48MB)
# - GC (reserved=256MB, committed=256MB)
# - Internal (reserved=64MB, committed=64MB)
# - Direct Memory (reserved=200MB, committed=200MB)  ← 堆外内存
```

## 堆外内存与 GC 的关系

| 特性 | 堆内内存 | 堆外内存（Direct Memory） |
|------|---------|------------------------|
| 管理方式 | GC 自动回收 | 手动或 Cleaner 释放 |
| 分配速度 | 快（有 TLAB） | 略慢（系统调用） |
| I/O 性能 | 需复制到内核 | 零拷贝（最优） |
| OOM 原因 | Java heap space | Direct buffer memory |
| 释放时机 | GC 时 | 对象不可达后 Cleaner 异步释放 |
| 大小控制 | -Xms/-Xmx | -XX:MaxDirectMemorySize |

## Netty 中的堆外内存使用

Netty 是堆外内存使用最成熟的框架，通过 `ByteBuf` 实现了高效内存管理：

```java
// PooledDirectByteBuf（池化堆外内存，Netty 默认）
ByteBuf buf = Unpooled.directBuffer(1024);

// 非池化（调试时用）
ByteBuf buf = Unpooled.directBuffer(1024);

// 从 Channel 读取
ctx.channel().read(buf).addListener(future -> {
    if (future.isSuccess()) {
        // buf 内容已经就绪，可以直接使用
        process(buf);
        buf.release();  // 显式释放（重要！）
    }
});
```

**Netty 的内存池**避免了频繁的 `allocateDirect()` 系统调用，大幅提升了高并发 I/O 场景的性能。

## 监控与调优建议

```bash
# 1. NMT 查看堆外内存使用
jcmd <pid> VM.native_memory baseline  # 建立基准线
# ... 运行一段时间后 ...
jcmd <pid> VM.native_memory summary.diff

# 2. Async-profiler 采样堆外内存分配
./async-profiler.sh profiler -e 'java/nio/DirectByteBuffer*' \
    -f direct-memory.html <pid>

# 3. 推荐参数配置（高并发 I/O 场景）
java -XX:+UseG1GC \
     -Xms8g -Xmx8g \
     -XX:MaxDirectMemorySize=1g \   # 堆外内存上限
     -XX:+DisableExplicitGC          # 不建议，可能影响 Cleaner
     your-app.jar
```

## 总结

- 堆外内存由 OS 直接管理，不受 GC 控制，适合高性能 I/O
- `DirectByteBuffer` 对象在堆内，数据在堆外，通过 Cleaner 异步释放
- **零拷贝**是堆外内存最大的优势：减少了内核缓冲区到用户缓冲区的复制
- NMT 和 async-profiler 是监控堆外内存的主要工具
- 高并发 I/O 场景推荐使用 **Netty** 等成熟框架的池化堆外内存

---

## 系列总结

本系列从 JVM 内存模型出发，介绍了：

1. **内存模型**：堆 / Metaspace / VM Stack 的职责
2. **GC 算法**：标记-清除 / 复制 / 标记-整理 / 分代收集
3. **G1GC**：Region 化设计、可预测停顿、Humongous 对象
4. **内存泄漏排查**：MAT + async-profiler 实战
5. **性能调优**：不同场景的参数配置方案
6. **堆外内存**：DirectByteBuffer 与零拷贝 I/O

理解底层原理，配合工具进行监控和分析，是解决生产环境 JVM 内存问题的必经之路。
