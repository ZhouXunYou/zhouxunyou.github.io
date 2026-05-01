---
layout: page
title: "JVM 调优参数详解"
category: jvm-parameters
sidebar: true
lang: zh
lang_alt: /en/jvm-parameters/
sort_order: 9
nav:
  prev: /jvm-diagnostics/
  next: /jvm-tuning-practice/
---

## JVM 参数分类

JVM 参数分为三类：

| 类型 | 格式 | 说明 |
|------|------|------|
| 标准参数 | `-` | 所有 JVM 实现都支持（如 `-version`、`-cp`） |
| 非标准参数 | `-X` | 不保证所有 JVM 支持但常见（如 `-Xms`、`-Xmx`） |
| 不稳定参数 | `-XX` | 特定 JVM 实现的扩展参数（如 `-XX:+UseG1GC`） |

不稳定参数的布尔类型使用 `+`/`-` 开关：
- `-XX:+UseG1GC` 启用
- `-XX:-UseG1GC` 禁用

非布尔类型使用 `=` 赋值：
- `-XX:MaxHeapSize=4g`

## 内存参数

### 堆内存

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `-Xms` | 初始堆大小 | 与 -Xmx 相同 |
| `-Xmx` | 最大堆大小 | 物理内存的 50-80% |
| `-Xmn` | 新生代大小 | 堆的 30-40% |
| `-XX:NewRatio` | 老年代/新生代比例 | 2（默认） |
| `-XX:SurvivorRatio` | Eden/Survivor 比例 | 8（默认） |
| `-XX:MaxTenuringThreshold` | 对象晋升老年代年龄 | 15（默认） |
| `-XX:PretenureSizeThreshold` | 大对象直接在老年代分配的阈值 | 无默认值 |

### 最佳实践

```bash
# 生产环境推荐
-Xms4g -Xmx4g        # 固定堆大小，避免动态扩缩容
-Xmn1536m            # 新生代约为堆的 37.5%
-XX:SurvivorRatio=8  # Eden:S0:S1 = 8:1:1
-XX:MaxTenuringThreshold=15
```

**为什么 -Xms 和 -Xmx 设为相同？**
- 避免堆大小调整带来的性能抖动
- 避免扩容时的 Full GC
- 提前分配内存，确保可用

### 非堆内存

| 参数 | 说明 | 推荐值 |
|------|------|--------|
| `-XX:MetaspaceSize` | 元空间初始大小 | 256m |
| `-XX:MaxMetaspaceSize` | 元空间最大大小 | 256m-512m |
| `-Xss` | 每个线程栈大小 | 256k-1m |
| `-XX:MaxDirectMemorySize` | 直接内存最大值 | 与 -Xmx 相同 |
| `-XX:ReservedCodeCacheSize` | JIT 代码缓存大小 | 240m（默认） |

```bash
# 元空间推荐
-XX:MetaspaceSize=256m -XX:MaxMetaspaceSize=512m

# 线程栈
-Xss512k    # 普通应用
-Xss256k    # 高并发应用（线程数多时节省内存）
```

## GC 参数

### 收集器选择

| 参数 | 收集器组合 |
|------|-----------|
| `-XX:+UseSerialGC` | Serial + Serial Old |
| `-XX:+UseParNewGC` | ParNew + Serial Old |
| `-XX:+UseParallelGC` | Parallel Scavenge + Parallel Old |
| `-XX:+UseConcMarkSweepGC` | ParNew + CMS + Serial Old（后备） |
| `-XX:+UseG1GC` | G1 |
| `-XX:+UseZGC` | ZGC |
| `-XX:+UseShenandoahGC` | Shenandoah |

### Parallel Scavenge 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:MaxGCPauseMillis` | 最大 GC 停顿目标 | 无 |
| `-XX:GCTimeRatio` | 吞吐量目标 | 99 |
| `-XX:+UseAdaptiveSizePolicy` | 自适应调节 | 开启 |
| `-XX:ParallelGCThreads` | GC 线程数 | CPU 核数 |

### CMS 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:CMSInitiatingOccupancyFraction` | 老年代占用率触发阈值 | 68（首次）/92 |
| `-XX:+UseCMSCompactAtFullCollection` | Full GC 后整理碎片 | 开启 |
| `-XX:CMSFullGCsBeforeCompaction` | 多少次 Full GC 后整理 | 0 |
| `-XX:ConcGCThreads` | 并发 GC 线程数 | (ParallelGCThreads+3)/4 |
| `-XX:+CMSParallelRemarkEnabled` | 并行重新标记 | 开启 |
| `-XX:+CMSParallelSurvivorRemarkEnabled` | 并行 Survivor 重新标记 | 开启 |

### G1 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:MaxGCPauseMillis` | 目标停顿时间 | 200ms |
| `-XX:G1HeapRegionSize` | Region 大小 | 自动计算 |
| `-XX:InitiatingHeapOccupancyPercent` | 触发并发标记的堆占用率 | 45% |
| `-XX:G1MixedGCCountTarget` | Mixed GC 次数目标 | 8 |
| `-XX:G1MixedGCLiveThresholdPercent` | Region 存活率回收阈值 | 85% |
| `-XX:G1ReservePercent` | 保留空间防止晋升失败 | 10% |
| `-XX:ParallelGCThreads` | STW 阶段并行线程数 | CPU 核数 |
| `-XX:ConcGCThreads` | 并发阶段线程数 | max(1, ParallelGCThreads/4) |

### ZGC 参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:ZCollectionInterval` | GC 间隔（0=自适应） | 0 |
| `-XX:ZAllocationSpikeTolerance` | 分配突发容忍度 | 1 |
| `-XX:ZFragmentationLimit` | 碎片率上限 | 5% |
| `-XX:+ZGenerational` | 分代模式（JDK 21+） | 关闭 |

## JIT 编译参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:+TieredCompilation` | 分层编译 | 开启 |
| `-XX:CompileThreshold` | 方法调用 JIT 阈值 | 10000 |
| `-XX:CompileThresholdScaling` | 阈值缩放因子 | 1.0 |
| `-XX:+PrintCompilation` | 打印 JIT 编译日志 | 关闭 |
| `-XX:ReservedCodeCacheSize` | 代码缓存大小 | 240MB |
| `-XX:+Inline` | 方法内联 | 开启 |
| `-XX:MaxInlineSize` | 内联方法最大字节码大小 | 35 |
| `-XX:FreqInlineSize` | 频繁调用方法内联上限 | 325 |

```bash
# JIT 调试
-XX:+PrintCompilation          # 查看哪些方法被 JIT 编译
-XX:+UnlockDiagnosticVMOptions # 解锁诊断选项
-XX:+LogCompilation            # 详细编译日志（XML 格式）
```

## 线程参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-Xss` | 线程栈大小 | 平台相关 |
| `-XX:ThreadStackSize` | 线程栈大小（同 -Xss） | 平台相关 |
| `-XX:+UseThreadPriorities` | 使用线程优先级 | 开启 |

```bash
# 高并发应用线程栈计算
# 可用内存 = 物理内存 - 堆 - 元空间 - 代码缓存 - OS保留
# 最大线程数 ≈ 可用内存 / Xss
# 例: (8G - 4G - 512M - 240M - 500M) / 512K ≈ 5400 线程
```

## 诊断参数

| 参数 | 说明 |
|------|------|
| `-XX:+HeapDumpOnOutOfMemoryError` | OOM 时自动 dump 堆 |
| `-XX:HeapDumpPath=/path/to/dump` | dump 文件路径 |
| `-XX:ErrorFile=/path/to/hs_err.log` | 致命错误日志路径 |
| `-XX:+PrintGCDetails` | 打印 GC 详情（JDK 8） |
| `-XX:+PrintGCDateStamps` | 打印 GC 时间戳（JDK 8） |
| `-Xlog:gc*:file=gc.log` | GC 日志（JDK 9+） |
| `-XX:+PrintSafepointStatistics` | 打印安全点统计 |
| `-XX:+PrintTLAB` | 打印 TLAB 信息 |
| `-XX:+TraceClassLoading` | 跟踪类加载 |
| `-XX:+TraceClassUnloading` | 跟踪类卸载 |

## 参数分类速查表

### 按场景分类

**Web 服务（Spring Boot）**
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

**大数据（Spark/Flink）**
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

**低延迟（交易系统）**
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

**微服务（Docker 容器）**
```bash
java -Xms512m -Xmx512m \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:MetaspaceSize=128m -XX:MaxMetaspaceSize=128m \
     -XX:+UseContainerSupport \
     -XX:MaxRAMPercentage=75.0 \
     -jar app.jar
```

### 容器感知参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-XX:+UseContainerSupport` | 启用容器感知 | 开启（JDK 10+） |
| `-XX:MaxRAMPercentage` | 最大堆占容器内存比例 | 25% |
| `-XX:InitialRAMPercentage` | 初始堆占容器内存比例 | 25% |
| `-XX:MinRAMPercentage` | 最小堆占容器内存比例 | 50% |

```bash
# Docker 容器推荐（4GB 容器内存）
-XX:+UseContainerSupport
-XX:MaxRAMPercentage=75.0     # 3GB 堆
-XX:InitialRAMPercentage=75.0 # 初始堆 = 最大堆
```

## 查看运行时参数

```bash
# 查看所有 JVM 参数（含默认值）
java -XX:+PrintFlagsFinal -version | grep -i "g1\|heap\|gc"

# 查看已被用户修改的参数
java -XX:+PrintCommandLineFlags -version

# 运行时查看
jcmd <pid> VM.flags
jcmd <pid> VM.command_line
jinfo -flags <pid>
```

## 小结

本章系统梳理了 JVM 调优参数：内存参数控制各区域大小，GC 参数选择收集器和调整策略，JIT 参数优化编译行为，诊断参数帮助排查问题。生产环境中推荐根据场景选择预设模板，再根据实际监控数据微调。下一章将通过综合调优实战案例将所有知识串联起来。
