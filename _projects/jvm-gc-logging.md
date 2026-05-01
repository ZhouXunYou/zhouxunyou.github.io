---
layout: page
title: "GC 日志与分析"
category: jvm-gc-logging
sidebar: true
lang: zh
lang_alt: /en/jvm-gc-logging/
sort_order: 6
nav:
  prev: /jvm-gc-collectors/
  next: /jvm-tools/
---

## GC 日志的重要性

GC 日志是 JVM 调优最核心的数据来源。通过分析 GC 日志可以：

- 确认 GC 频率和停顿时间是否符合预期
- 发现内存泄漏、频繁 Full GC 等问题
- 评估不同收集器和参数的效果
- 定位性能瓶颈

## GC 日志参数配置

### JDK 8 及之前

```bash
-XX:+PrintGCDetails              # 打印详细 GC 信息
-XX:+PrintGCDateStamps           # 打印 GC 发生的时间戳
-XX:+PrintGCTimeStamps           # 打印 JVM 启动后的相对时间
-XX:+PrintGCApplicationStoppedTime  # 打印 STW 停顿时间
-XX:+PrintGCApplicationConcurrentTime  # 打印应用运行时间
-XX:+PrintHeapAtGC               # 打印 GC 前后堆信息
-Xloggc:/var/log/gc.log          # GC 日志输出文件
-XX:+UseGCLogFileRotation        # GC 日志滚动
-XX:NumberOfGCLogFiles=5         # 滚动文件数
-XX:GCLogFileSize=20M            # 单文件大小
```

### JDK 9+（统一日志框架 -Xlog）

JDK 9 引入了统一的 `-Xlog` 参数替代多个 Print* 参数：

```bash
# 基本格式
-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=5,filesize=20m

# 参数说明
# gc*          — 日志标签（gc* 表示所有 GC 相关日志）
# file=...     — 输出到文件
# time,uptime  — 输出时间戳
# level        — 输出日志级别
# tags         — 输出日志标签
# filecount    — 滚动文件数
# filesize     — 单文件大小

# 常用配置
-Xlog:gc*=info:file=gc.log:time,uptime:filecount=5,filesize=20m

# 只看 GC 停顿时间
-Xlog:gc+phases=debug

# 查看 JIT 编译信息
-Xlog:jit+compilation=info
```

### 关键诊断参数

```bash
-XX:+HeapDumpOnOutOfMemoryError          # OOM 时自动 dump 堆
-XX:HeapDumpPath=/var/log/heapdump.hprof  # dump 文件路径
-XX:ErrorFile=/var/log/hs_err_%p.log      # 致命错误日志
```

## GC 日志格式解读

### G1 GC 日志示例

```
# Young GC
[2024-01-15T10:30:45.123+0800][2024-01-15T10:30:45.123+0800] GC pause (G1 Evacuation Pause) (young)
  [Eden: 256.0M(256.0M)->0.0B(230.0M) Survivors: 0.0B->26.0M Heap: 256.0M(512.0M)->24.0M(512.0M)]
  [Times: user=0.08 sys=0.01, real=0.02 secs]

# 并发标记
[2024-01-15T10:30:46.456+0800] GC concurrent-root-region-scan-start
[2024-01-15T10:30:46.458+0800] GC concurrent-root-region-scan-end, 0.0019875 secs
[2024-01-15T10:30:46.458+0800] GC concurrent-mark-start
[2024-01-15T10:30:46.567+0800] GC concurrent-mark-end, 0.1092341 secs
[2024-01-15T10:30:46.568+0800] GC remark, 0.0054321 secs
[2024-01-15T10:30:46.574+0800] GC cleanup, 0.0012345 secs

# Mixed GC
[2024-01-15T10:30:47.890+0800] GC pause (G1 Evacuation Pause) (mixed)
  [Eden: 128.0M(128.0M)->0.0B(112.0M) Survivors: 16.0M->20.0M Heap: 380.0M(512.0M)->210.0M(512.0M)]
  [Times: user=0.12 sys=0.02, real=0.04 secs]

# Full GC（应避免）
[2024-01-15T10:31:00.000+0800] Full GC (Allocation Failure)
  [Eden: 0.0B(0.0B)->0.0B(112.0M) Survivors: 0.0B->0.0B Heap: 512.0M(512.0M)->256.0M(512.0M)]
  [Times: user=1.20 sys=0.05, real=0.35 secs]
```

### 关键指标解读

| 指标 | 含义 | 关注点 |
|------|------|--------|
| GC pause (young) | Young GC 停顿 | 频率和时长 |
| GC pause (mixed) | Mixed GC 停顿 | 回收老年代 Region 数量 |
| Eden: X->Y | Eden 区变化 | 回收效率 |
| Survivors: X->Y | Survivor 区变化 | 存活对象比例 |
| Heap: X->Y | 堆整体变化 | 内存使用趋势 |
| real=0.02 secs | 实际停顿时间 | 核心指标 |
| user=0.08 sys=0.01 | CPU 时间 | user/real > CPU 核数说明并行有效 |

### CMS GC 日志示例

```
# 初始标记（STW）
[GC (CMS Initial Mark) [1 CMS-initial-mark: 256M(512M)] 300M(768M), 0.001234 secs]

# 并发标记
[CMS-concurrent-mark: 0.123/0.456 secs]

# 重新标记（STW）
[GC (CMS Final Remark) [Rescan (parallel), 0.005678 secs]
  [weak refs processing, 0.000234 secs]
  [class unloading, 0.001234 secs]
  [scrub symbol table, 0.000456 secs]
  [scrub string table, 0.000123 secs]
  [1 CMS-remark: 256M(512M)] 300M(768M), 0.008901 secs]

# 并发清除
[CMS-concurrent-sweep: 0.234/0.567 secs]

# 并发重置
[CMS-concurrent-reset: 0.012/0.034 secs]
```

## GC 日志分析工具

### GCViewer

开源 GC 日志可视化工具，支持 JDK 8 的 PrintGCDetails 格式。

```bash
# 下载
# https://github.com/chewiebug/GCViewer

# 使用
java -jar gcviewer.jar gc.log
```

输出统计信息：
- 总 GC 次数和时间
- 平均/最大停顿时间
- 吞吐量（应用运行时间占比）
- 堆内存使用曲线

### GCEasy

在线 GC 日志分析工具，上传日志即可获得详细报告。

特点：
- 支持 G1/CMS/Parallel/ZGC 等所有收集器
- 自动识别问题（频繁 Full GC、内存泄漏等）
- 生成图表和统计信息
- 免费版有限制，付费版功能更全

### GCPlot

分布式 GC 日志分析平台，适合大规模微服务环境。

### JDK Mission Control (JMC)

配合 JFR 使用，提供实时 GC 监控和历史数据分析。

## 从日志定位问题

### 问题 1：频繁 Young GC

**日志特征**：Young GC 间隔极短（秒级或更短），每次回收对象少

```
[GC pause (young), 0.015 secs]  -- 1 秒前
[GC pause (young), 0.012 secs]  -- 当前
```

**可能原因**：
- 新生代过小，对象过早晋升
- 产生大量临时对象（如日志格式化、大字符串拼接）
- TLAB 分配失败频繁

**解决方案**：
- 增大新生代（`-Xmn`）
- 优化代码减少临时对象
- 使用 `-XX:+PrintTLAB` 分析 TLAB 情况

### 问题 2：对象过早晋升

**日志特征**：Survivor 区使用率高，Young GC 后老年代持续增长

```
[Eden: 256.0M->0.0B Survivors: 0.0B->32.0M]  -- Survivor 几乎满
[Eden: 224.0M->0.0B Survivors: 32.0M->32.0M] -- 无法容纳，晋升老年代
```

**可能原因**：
- Survivor 区过小
- 晋升年龄阈值过低
- 突发流量导致对象存活率上升

**解决方案**：
- 增大 Survivor 区（`-XX:SurvivorRatio`）
- 增大新生代整体
- 提高晋升年龄（`-XX:MaxTenuringThreshold`）

### 问题 3：频繁 Full GC

**日志特征**：Full GC 日志频繁出现，停顿时间长

```
[Full GC (Allocation Failure)  512M->256M(512M), 0.350 secs]
[Full GC (Ergonomics)  480M->260M(512M), 0.320 secs]
```

**可能原因**：
- 内存泄漏
- 老年代空间不足
- 元空间不足
- System.gc() 被调用
- CMS Concurrent Mode Failure

**排查步骤**：
1. 确认 Full GC 触发原因（日志中的原因字段）
2. 使用 `jmap -histo` 查看对象分布
3. 使用 `jmap -dump` 导出堆 dump 分析
4. 排查是否有内存泄漏

### 问题 4：GC 停顿过长

**日志特征**：real 时间远超预期

```
[GC pause (G1 Evacuation Pause) (young), 0.500 secs]  -- 正常应 < 50ms
```

**可能原因**：
- 堆过大，单次回收区域多
- 对象存活率高，复制开销大
- 磁盘 IO 导致 Swap
- 安全点等待时间过长

**解决方案**：
- 减小 `-XX:MaxGCPauseMillis` 目标值
- 检查是否有 Swap（`free -h`）
- 使用 `-XX:+PrintSafepointStatistics` 检查安全点

## GC 日志分析最佳实践

1. **始终开启 GC 日志**：生产环境必须开启，磁盘开销极小
2. **设置日志滚动**：避免单个文件过大
3. **OOM 时自动 dump**：`-XX:+HeapDumpOnOutOfMemoryError`
4. **定期分析**：建立 GC 日志定期巡检机制
5. **基线对比**：调优前记录基线，调优后对比效果
6. **关注 real 时间**：而非 user/sys 时间，real 才是实际停顿

## 小结

本章介绍了 GC 日志的配置、格式解读和分析方法。GC 日志是 JVM 调优最重要的数据来源，掌握日志分析能力是排查 GC 问题的关键。下一章将介绍 JVM 性能监控工具。
