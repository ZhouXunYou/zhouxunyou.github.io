---
layout: post
title: "JVM 性能调优实战：从参数到工具的完整流程"
date: 2024-12-01
categories: [jvm]
author: Zhou Xunyou
lang: zh
---

前面的文章介绍了原理和工具，本篇将理论与实践结合，讲解如何对真实业务系统做 JVM 调优，包括常见场景的参数配置与调优思路。

## 调优的基本原则

> **调优之前先监控**——不要猜测，用数据说话。

调优的核心指标：
- **吞吐量**（Throughput）：应用实际运行时间 / 总时间
- **停顿时间**（Latency）：GC 停顿的最大时长、平均时长
- **内存占用**（Footprint）：堆大小对应用的影响

这三个指标相互制约，**吞吐量 ↑ 意味着 GC 频率 ↓，每次停顿时间可能更长**。

```
调优三角：
        吞吐量
           /\
          /  \
         /    \
        /──────\
  停顿时间   内存占用
```

## 场景一：高吞吐 Web 服务（用户量大，无严格延迟要求）

**典型场景**：后台管理系统、报表系统、异步任务处理

**GC 选择**：Parallel GC（追求高吞吐）

```bash
java -server \
     -Xms4g -Xmx4g \                  # 堆大小固定，避免运行时调整
     -Xmn2g \                          # Young 代大小（建议为堆的 1/2~1/3）
     -XX:+UseParallelGC \              # Parallel GC（关注吞吐）
     -XX:+UseParallelOldGC \           # 老年代也用并行整理
     -XX:ParallelGCThreads=8 \         # GC 线程数 = CPU 核心数
     -XX:+UnlockExperimentalVMOptions \
     -XX:+UseNUMA \                   # NUMA 架构下启用，对多插槽服务器有效
     -XX:MaxGCPauseMillis=500 \        # 目标停顿（ParallelGC 会尽量满足）
     -XX:+AlwaysPreTouch               # 启动时预分配所有内存，减少运行时 page fault
```

**为什么这样配**：

```
吞吐量优先 → Parallel GC：
  - 应用线程：  95% 运行
  - GC 线程：   5%（Full GC 时 Stop-the-World）
  - 目标吞吐： 99%+

-Xmn2g 设置理由：
  Young = 堆的 50%
  Old   = 堆的 50%
  Young 足够大 → Minor GC 频率降低
  对象在 Young 中经历足够多 Minor GC 才晋升 → Old 压力减小
```

---

## 场景二：低延迟 API 服务（P99 < 50ms 要求）

**典型场景**：REST API、金融交易、实时推荐

**GC 选择**：G1GC 或 ZGC

### G1GC 配置

```bash
java -server \
     -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=50 \          # 目标停顿 50ms（G1 会自动调整）
     -XX:G1HeapRegionSize=4m \          # 4MB Region，平衡粒度
     -XX:InitiatingHeapOccupancyPercent=45 \  # 堆占 45% 时开始并发标记（低于 CMS 默认值 68%）
     -XX:G1ReservePercent=15 \           # 预留 15% 堆空间作为 Survivor，避免晋升失败
     -XX:+UseStringDeduplication \       # 字符串去重（降低内存占用）
     -XX:+AlwaysPreTouch
```

### ZGC 配置（JDK 15+，超低停顿）

```bash
java -server \
     -Xms8g -Xmx8g \
     -XX:+UseZGC \
     -XX:MaxGCPauseMillis=1 \           # 目标停顿 < 1ms（ZGC 保证）
     -XX:+ZGenerational \               # JDK 21+ 的分代 ZGC，减少 GC 频率
     -XX:+AlwaysPreTouch
```

**ZGC vs G1GC 对比**：

| 指标 | G1GC | ZGC |
|------|-------|-----|
| 停顿时间 | < 200ms（可配置） | < 1ms（可配置） |
| 吞吐量 | 略低于 Parallel | 接近 G1 |
| 内存占用 | 低碎片 | 略高（有 colored pointers） |
| JDK 版本 | JDK 8+ | JDK 11+（JDK 15+ 成熟） |
| 适用场景 | 通用，推荐首选 | 超低延迟，要求苛刻 |

---

## 场景三：微服务（容器化 + K8s）

**典型场景**：Docker 容器内运行的 Spring Boot 微服务

```yaml
# K8s deployment 配置示例
resources:
  requests:
    memory: "2Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"       # 内存必须设置 limits，防止 OOMKill
    cpu: "1000m"

# JVM 参数（注意：容器内存限制 ≠ 堆大小）
env:
  - name: JAVA_OPTS
    value: "-XX:+UseContainerSupport"  # JDK 10+，让 JVM 自动感知容器内存限制
```

```bash
# 容器-aware JVM 配置
java -XX:+UseContainerSupport \           # 自动读取容器 cgroup 内存限制
     -XX:MaxRAMPercentage=75.0 \         # 使用容器内存的 75% 作为堆上限（推荐）
     -XX:InitialRAMPercentage=75.0 \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:+UseStringDeduplication \
     -XX:+AlwaysPreTouch
```

> **注意**：`JAVA_OPTS` 设置堆外内存，**不能**用 `-Xmx` 硬编码（容器调度器可能 kill 该进程）。`MaxRAMPercentage` 是最佳实践。

---

## 调优实操流程

### 第一步：获取基准数据

```bash
# 启动时加上以下参数，持续运行 24 小时收集数据
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -Xlog:gc*=debug:file=/data/logs/gc.log:time,level,tags:filecount=10,filesize=50m \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/data/heapdump/ \
     your-app.jar
```

### 第二步：GC 日志分析

```bash
# 使用 gclog 分析工具：gceasy.io（在线）或 gcviewer（本地）
# 下载 gc.log 上传到 https://gceasy.io 获取可视化报告

# 关键指标：
# - Total GC time：总 GC 时间 / 运行时间
# - GC Throughput：（1 - TotalGCTime/TotalTime）× 100%
# - Total pauses：最长停顿时间
```

```
gc.log 示例分析报告：
┌─────────────────────────────────────────────────┐
│  Application Total Time：24h                       │
│  Total GC Time：8.2 min                           │
│  GC Throughput：99.43% ✓ （目标 > 99%）             │
│  Avg Pause：23ms                                   │
│  Max Pause：156ms                                 │
│  Young GC：6,234 次                               │
│  Old GC：3 次                                     │
└─────────────────────────────────────────────────┘
```

### 第三步：瓶颈判断

```bash
# 如果 GC Throughput < 98%，优先考虑：
# 1. 增大堆：-Xms=-Xmx 增大
# 2. 调高 MaxGCPauseMillis（允许更长停顿换更高吞吐）

# 如果 Max Pause > 目标（如 200ms），优先考虑：
# 1. 切换到 G1GC（已有）
# 2. 调低 MaxGCPauseMillis
# 3. 分析 Full GC 原因
```

### 第四步：参数迭代

```
调优参数优先级：
  1. -Xms=-Xmx        （先保证堆大小稳定）
  2. -XX:+UseG1GC      （低延迟首选）
  3. -XX:MaxGCPauseMillis  （设定目标）
  4. -XX:G1HeapRegionSize  （Region 大小）
  5. -XX:InitiatingHeapOccupancyPercent  （标记时机）
  6. -XX:G1ReservePercent    （晋升保护）
```

---

## 常见错误配置

### 错误 1：初始堆和最大堆不一致

```bash
# ❌ 错误：运行时调整堆大小，GC 压力大
-Xms256m -Xmx4g

# ✅ 正确：固定大小
-Xms4g -Xmx4g
```

### 错误 2：堆设置过大

```bash
# ❌ 错误：系统内存 8GB，给堆 7.5GB
# 系统其他进程 + 元空间 + 直接内存 + VM Struct → 可能 OOM

# ✅ 正确：留足够空间给非堆区域
# 建议堆 = 系统内存 * 50%~75%
# 8GB 机器 → -Xmx4g ~ -Xmx6g
```

### 错误 3：禁用 System.gc()

```bash
# ❌ 错误：直接禁用所有显式 GC
-XX:+DisableExplicitGC   # ← 可能导致 NIO direct memory OOM！

# ✅ 正确：不干预 GC，让 JVM 自己管理
```

---

## 调优参数速查表

| 场景 | GC | 关键参数 |
|------|---|---------|
| 高吞吐后台 | ParallelGC | `-Xms=-Xmx`, `-Xmn`, `-XX:+UseParallelOldGC` |
| 低延迟 API | G1GC | `-XX:MaxGCPauseMillis=50`, `-XX:G1ReservePercent=15` |
| 超低延迟 | ZGC | `-XX:+UseZGC`, `-XX:MaxGCPauseMillis=1` |
| 容器微服务 | G1GC + ContainerSupport | `-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage=75` |
| 大内存（> 32GB）| G1GC / ZGC | `-XX:+UseLargePages`, `-XX:G1HeapRegionSize=8m` |

## 总结

- **调优顺序**：先固定堆大小 → 选 GC → 设停顿目标 → 分析日志 → 迭代参数
- **GC Throughput > 99%** 是高吞吐场景的及格线
- **MaxGCPauseMillis** 是调优的杠杆参数，G1 会自动平衡
- **ZGC** 是低延迟场景的最终方案（JDK 21+ 推荐）
- 容器环境用 **MaxRAMPercentage**，不要硬编码 `-Xmx`

下篇将介绍**堆外内存与 DirectByteBuffer**——NIO 高性能通信背后的内存管理机制。
