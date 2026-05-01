---
layout: page
title: "垃圾收集器详解"
category: jvm-gc-collectors
sidebar: true
lang: zh
lang_alt: /en/jvm-gc-collectors/
sort_order: 5
nav:
  prev: /jvm-gc-algorithms/
  next: /jvm-gc-logging/
---

## 垃圾收集器概览

垃圾收集器是垃圾回收算法的具体实现。不同收集器各有侧重，适用于不同场景：

```
    新生代收集器           老年代收集器           整堆收集器
  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
  │   Serial    │────→│  Serial Old │     │             │
  ├─────────────┤     ├─────────────┤     │             │
  │   ParNew    │────→│    CMS      │     │             │
  ├─────────────┤     ├─────────────┤     │             │
  │ Parallel    │────→│  Parallel   │     │             │
  │ Scavenge    │     │    Old      │     │             │
  ├─────────────┤     ├─────────────┤     ├─────────────┤
  │             │     │             │     │     G1      │
  ├─────────────┤     ├─────────────┤     ├─────────────┤
  │             │     │             │     │    ZGC      │
  ├─────────────┤     ├─────────────┤     ├─────────────┤
  │             │     │             │     │ Shenandoah  │
  └─────────────┘     └─────────────┘     └─────────────┘
```

## Serial / Serial Old

最基础、最古老的收集器，使用**单线程**进行垃圾回收。

### 工作过程

```
用户线程 ──███──暂停──██████████──暂停──███──
Serial  ────────→ GC ←──────────────→ GC ←──
```

- **Serial**（新生代）：复制算法
- **Serial Old**（老年代）：标记-整理算法

### 特点

- 单线程工作，GC 时必须暂停所有用户线程（Stop The World, STW）
- 实现简单，内存开销小
- 适合客户端模式或小内存应用

```bash
# 使用参数
-XX:+UseSerialGC    # 同时使用 Serial + Serial Old
```

## ParNew

Serial 的多线程版本，使用多个 GC 线程进行垃圾回收。

### 特点

- 多线程并发执行 GC（默认线程数 = CPU 核数）
- 除多线程外，其余行为与 Serial 完全一致
- **唯一能与 CMS 配合使用的新生代收集器**

```bash
# 使用参数
-XX:+UseParNewGC           # 使用 ParNew
-XX:ParallelGCThreads=4    # GC 线程数
```

## Parallel Scavenge / Parallel Old

### Parallel Scavenge（新生代）

与 ParNew 类似，但关注点是**吞吐量**（Throughput）而非停顿时间。

```
吞吐量 = 运行用户代码时间 / (运行用户代码时间 + GC 时间)
```

**自适应调节策略（GC Ergonomics）**：Parallel Scavenge 可根据当前系统运行情况动态调整新生代大小、Eden/Survivor 比例、对象晋升年龄等参数，以尽可能满足吞吐量目标。

```bash
# 核心参数
-XX:+UseParallelGC                    # 使用 Parallel Scavenge + Parallel Old
-XX:MaxGCPauseMillis=200              # 最大 GC 停顿时间目标（尽力满足）
-XX:GCTimeRatio=99                    # 吞吐量大小（默认 99，即 GC 时间占 1%）
-XX:+UseAdaptiveSizePolicy            # 自适应调节（默认开启）
-XX:ParallelGCThreads=4               # GC 线程数
```

### Parallel Old（老年代）

Parallel Scavenge 的老年代搭档，使用标记-整理算法。JDK 6 开始提供，之前 Parallel Scavenge 只能搭配 Serial Old（严重影响吞吐量）。

## CMS（Concurrent Mark Sweep）

CMS 以获取**最短回收停顿时间**为目标，基于标记-清除算法，适用于对响应时间敏感的应用。

### 四个阶段

```
1. 初始标记 (STW)  ──短暂暂停，标记 GC Roots 直接关联的对象
2. 并发标记        ──与用户线程并发，进行 GC Roots Tracing
3. 重新标记 (STW)  ──短暂暂停，修正并发标记期间变动的引用（增量更新）
4. 并发清除        ──与用户线程并发，清除未标记对象
```

```
用户线程 ──███──暂停──████████████████──暂停──████████████████──
CMS     ────→初始标记──→  并发标记  ──→重新标记──→  并发清除  ──→
```

### 优缺点

**优点**：
- 并发收集，停顿时间短
- 适合对响应时间要求高的 Web 应用

**缺点**：
- **CPU 敏感**：并发阶段占用 CPU，默认启动 (CPU核数+3)/4 个 GC 线程
- **浮动垃圾**：并发清除阶段用户线程产生的新垃圾，只能下次 GC 处理
- **内存碎片**：标记-清除算法导致碎片，可能触发 Serial Old 整理
- **Concurrent Mode Failure**：老年代预留空间不足，退化为 Serial Old 全停顿

```bash
# CMS 参数
-XX:+UseConcMarkSweepGC        # 使用 CMS
-XX:CMSInitiatingOccupancyFraction=75  # 老年代使用 75% 时触发 GC
-XX:+UseCMSCompactAtFullCollection     # Full GC 后整理碎片
-XX:CMSFullGCsBeforeCompaction=5       # 5 次 Full GC 后整理
-XX:ConcGCThreads=2                    # 并发 GC 线程数
-XX:+CMSParallelRemarkEnabled          # 并行重新标记
```

### CMS 已被弃用

- JDK 9 标记为 Deprecated
- JDK 14 正式移除
- 推荐迁移到 G1

## G1（Garbage-First）

G1 是 JDK 9 的默认收集器，面向服务端应用，兼顾吞吐量和停顿时间。

### Region 化内存布局

G1 打破传统的物理分代，将堆划分为大小相等的 **Region**（1-32MB，默认 2048 个）：

```
┌────┬────┬────┬────┬────┬────┬────┬────┐
│ E  │ S  │ O  │ H  │ E  │ O  │ E  │ S  │
├────┼────┼────┼────┼────┼────┼────┼────┤
│ O  │ E  │ E  │ O  │ E  │ S  │ O  │ E  │
└────┴────┴────┴────┴────┴────┴────┴────┘

E = Eden  S = Survivor  O = Old  H = Humongous
```

每个 Region 可以是 Eden、Survivor、Old 或 Humongous（大对象）。G1 仍保留分代概念，但新生代和老年代不再是连续的内存区域。

### 回收模式

- **Young GC**：回收所有 Eden 和 Survivor Region
- **Mixed GC**：回收所有新生代 Region + 部分老年代 Region（回收价值高的优先）
- **Full GC**：退化为单线程整堆收集（应避免）

### 工作流程

```
1. Young GC ── 回收新生代（STW，多线程并行）
2. 并发标记 ── 类似 CMS 的四个阶段
3. Mixed GC ── 根据停顿预测模型选择回收的 Region
```

### 关键特性

- **可预测停顿**：`-XX:MaxGCPauseMillis=200` 设置目标停顿时间，G1 根据历史数据预测选择回收哪些 Region
- **回收价值优先（Garbage-First）**：优先回收垃圾最多的 Region
- **无碎片**：整体基于标记-整理，局部（Region 之间）基于复制算法
- **大对象处理**：超过 Region 大小一半的对象直接分配在 Humongous Region

```bash
# G1 参数
-XX:+UseG1GC                       # 使用 G1
-XX:MaxGCPauseMillis=200           # 目标停顿时间（默认 200ms）
-XX:G1HeapRegionSize=4m            # Region 大小
-XX:InitiatingHeapOccupancyPercent=45  # 触发并发标记的堆占用率
-XX:G1MixedGCCountTarget=8         # Mixed GC 次数目标
-XX:G1MixedGCLiveThresholdPercent=85   # Region 存活率低于此值才回收
```

## ZGC

ZGC（Z Garbage Collector）是 JDK 11 引入的低延迟收集器，目标是将 GC 停顿控制在 **1ms 以内**（JDK 16 之前为 10ms）。

### 核心技术

**1. 着色指针（Colored Pointers）**

在 64 位指针中借用几位存储 GC 元信息，避免修改对象头：

```
 63        42 41 40 39 38 37                    0
┌──────────┬──┬──┬──┬──┬──┬─────────────────────┐
│  未使用    │R0│R1│F │R │P │    对象地址           │
└──────────┴──┴──┴──┴──┴──┴─────────────────────┘
             ↑  ↑  ↑  ↑  ↑
            Remap1 Remap Finalized Remapped
               └──┘            Pinning
            Relocation
```

**2. 读屏障（Load Barrier）**

在对象引用被加载时执行检查，如果指针着色表示对象已被移动，则自动修正引用：

```java
Object o = obj.field;  // 读屏障：检查 o 的指针颜色
// 如果 o 被标记为 "relocated"，修正为新的地址
```

**3. 并发整理**

ZGC 实现了真正的并发整理——在移动对象的同时，用户线程可以继续运行。通过读屏障和着色指针配合，确保用户线程总是访问到正确的地址。

### 特点

- STW 时间 < 1ms，且不随堆大小增长
- 支持 TB 级堆内存
- 并发标记、并发转移、并发整理
- 无分代（JDK 21 之前），每次都是整堆收集
- JDK 21 引入分代 ZGC，大幅改善年轻代回收效率

```bash
# ZGC 参数
-XX:+UseZGC                        # 使用 ZGC
-XX:ZCollectionInterval=0          # GC 间隔（0 为自适应）
-XX:ZAllocationSpikeTolerance=2    # 分配突发容忍度
-XX:+UnlockDiagnosticVMOptions     # 解锁诊断选项
-XX:+ZStatisticsForceTrace         # 强制追踪统计
-XX:+UseZGC -XX:+ZGenerational     # JDK 21+ 分代 ZGC
```

## Shenandoah

Shenandoah 是 RedHat 开发的低延迟收集器，与 ZGC 目标类似但实现不同。

### 核心技术

**Brooks Pointer**：每个对象头部增加一个额外指针，指向对象自身。当对象被移动时，只需更新 Brooks Pointer，旧引用会通过间接跳转找到新地址。

```
移动前：  引用 → [对象 | Brooks Pointer → 自身]
移动后：  引用 → [旧位置 | Brooks Pointer → 新地址]  → [对象 | Brooks Pointer → 自身]
```

### 特点

- GC 停顿与堆大小无关
- 使用读屏障 + 写屏障（比 ZGC 的纯读屏障开销略大）
- 有分代模式（JDK 22+）
- 在 OpenJDK 中可用，非 Oracle JDK 默认

```bash
# Shenandoah 参数
-XX:+UseShenandoahGC              # 使用 Shenandoah
-XX:ShenandoahGCHeuristics=adaptive  # 启发式算法
```

## 收集器选择策略

| 场景 | 推荐收集器 | 理由 |
|------|-----------|------|
| 客户端/小内存 | Serial | 简单高效，无线程开销 |
| 批处理/后台计算 | Parallel Scavenge + Parallel Old | 最大化吞吐量 |
| Web 服务（JDK 8） | ParNew + CMS | 低停顿 |
| Web 服务（JDK 9-14） | G1 | 平衡吞吐和延迟 |
| 低延迟要求（JDK 11+） | ZGC | 亚毫秒停顿 |
| 低延迟要求（非 Oracle JDK） | Shenandoah | 亚毫秒停顿 |

### 版本默认收集器

| JDK 版本 | 默认收集器 |
|---------|-----------|
| JDK 8 | Parallel Scavenge + Parallel Old |
| JDK 9 - 20 | G1 |
| JDK 21+ | G1（ZGC 仍需手动启用） |

## 小结

本章详细介绍了从 Serial 到 ZGC 的各种垃圾收集器。选择收集器时需要在吞吐量和延迟之间权衡：Parallel 系列侧重吞吐量，CMS/G1 侧重延迟平衡，ZGC/Shenandoah 追求极致低延迟。下一章将学习如何通过 GC 日志分析收集器行为。
