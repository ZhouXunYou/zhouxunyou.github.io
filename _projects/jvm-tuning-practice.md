---
layout: page
title: "综合调优实战案例"
category: jvm-tuning-practice
sidebar: true
lang: zh
lang_alt: /en/jvm-tuning-practice/
sort_order: 10
nav:
  prev: /jvm-parameters/
  next:
---

## 调优方法论

JVM 调优不是盲目调参数，而是遵循科学的方法论：

### 调优原则

1. **先优化代码，再调优 JVM**：大多数性能问题源于代码而非 JVM 配置
2. **有数据才调优**：基于 GC 日志和监控数据，而非猜测
3. **每次只调一个参数**：避免多变量无法确定因果关系
4. **调优前建立基线**：记录优化前的指标作为对比
5. **验证调优效果**：用真实负载测试，而非空载

### 调优流程

```
1. 明确目标（吞吐量？延迟？内存占用？）
2. 建立基线（采集当前指标）
3. 分析瓶颈（GC 日志/监控/线程 dump）
4. 制定方案（参数调整/代码优化）
5. 实施验证（A/B 测试/灰度发布）
6. 效果对比（与基线对比）
```

## 案例 1：Spring Boot Web 服务 GC 调优

### 背景

一个 Spring Boot 电商后端服务，4C8G 容器，JDK 17，G1GC。

### 问题

- 接口 P99 延迟 > 500ms，偶尔出现 > 2s 的毛刺
- Young GC 频率约 3 秒一次
- 偶发 Full GC 导致服务暂停

### 分析

```bash
# 1. 查看 GC 日志
# Young GC 停顿时间
[GC pause (G1 Evacuation Pause) (young), 0.045 secs]  # 45ms，可接受
[GC pause (G1 Evacuation Pause) (young), 0.080 secs]  # 80ms，偏高

# Full GC
[Full GC (Allocation Failure)  4096M->2800M(4096M), 1.200 secs]  # 1.2秒！

# 2. jstat 分析
jstat -gcutil <pid> 1000 10
# O（老年代使用率）持续在 75-85%，触发并发标记频繁
# FGC 次数每小时 2-3 次
```

### 诊断

- **根因**：堆大小 4G 偏小，老年代使用率高，Mixed GC 回收速度跟不上分配速度，退化为 Full GC
- **辅助原因**：大对象（订单列表 JSON 序列化）直接分配在 Humongous Region，触发提前 GC

### 优化方案

```bash
# 调整前
java -Xms4g -Xmx4g -XX:+UseG1GC -jar app.jar

# 调整后
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \          # 降低目标停顿（200→100）
     -XX:G1HeapRegionSize=8m \           # 增大 Region（避免大对象变 Humongous）
     -XX:InitiatingHeapOccupancyPercent=40 \  # 提前触发并发标记（45→40）
     -XX:G1MixedGCCountTarget=12 \       # 增加 Mixed GC 次数（8→12）
     -XX:G1MixedGCLiveThresholdPercent=80 \  # 更积极回收（85→80）
     -XX:SurvivorRatio=6 \               # 增大 Survivor（8→6）
     -Xlog:gc*:file=/var/log/gc.log:time,uptime:filecount=5,filesize=20m \
     -jar app.jar
```

### 代码优化

```java
// 优化前：大对象序列化
String json = objectMapper.writeValueAsString(orders);  // 订单量大时产生大字符串

// 优化后：流式写入
objectMapper.writeValue(outputStream, orders);

// 优化前：无限制的缓存
Map<String, Order> cache = new HashMap<>();

// 优化后：限制缓存大小
Cache<String, Order> cache = Caffeine.newBuilder()
    .maximumSize(10000)
    .expireAfterWrite(Duration.ofMinutes(30))
    .build();
```

### 效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| P99 延迟 | 520ms | 85ms |
| Young GC 停顿 | 45-80ms | 20-35ms |
| Full GC 频率 | 2-3 次/小时 | 0 |
| 老年代使用率 | 75-85% | 50-65% |

## 案例 2：Spark 作业堆外内存调优

### 背景

一个 Spark ETL 作业，处理 500GB 数据，JDK 11，运行在 YARN 上，Executor 内存 8G。

### 问题

- 作业运行一段时间后 OOM：`java.lang.OutOfMemoryError: Direct buffer memory`
- shuffle 阶段 GC 停顿严重

### 分析

```bash
# Executor 日志
ERROR Executor: Exception in task 123.0 in stage 45
java.lang.OutOfMemoryError: Direct buffer memory
    at java.nio.Bits.reserveMemory(Bits.java:175)

# GC 日志：Old GC 停顿长
[GC pause (G1 Evacuation Pause) (mixed), 0.800 secs]
```

### 诊断

- **根因 1**：Spark 网络传输使用 Netty，大量使用堆外 DirectByteBuffer，超过 `-XX:MaxDirectMemorySize`
- **根因 2**：堆内缓存对象过多，Mixed GC 回收效率低

### 优化方案

```bash
# 调整前
--conf spark.executor.memory=8g
--conf spark.executor.memoryOverhead=2g

# 调整后
--conf spark.executor.memory=6g                # 减小堆内存
--conf spark.executor.memoryOverhead=4g         # 增大堆外内存（2→4G）
--conf spark.executor.extraJavaOptions="-XX:+UseG1GC -XX:MaxDirectMemorySize=3g -XX:MaxGCPauseMillis=100"
--conf spark.memory.fraction=0.6               # 减小执行/存储内存比例（0.6→0.5）
--conf spark.memory.storageFraction=0.3        # 减小存储内存比例
--conf spark.sql.shuffle.partitions=400        # 增加 shuffle 分区数

# 代码优化：减少广播变量大小
# 优化前
broadcast(bigLookupTable)  // 2GB 查找表
# 优化后
broadcast(filteredLookupTable)  // 过滤后 200MB
```

### 效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| OOM 频率 | 每次运行必现 | 消除 |
| 作业耗时 | 3.5 小时 | 2.1 小时 |
| GC 总耗时 | 45 分钟 | 18 分钟 |

## 案例 3：容器化微服务 JVM 限制与调优

### 背景

Kubernetes 集群中运行 50+ 微服务，容器限制 2C4G，JDK 17。

### 问题

- 多个服务 OOMKilled（容器被 Kill，非 Java OOM）
- GC 日志显示堆使用率仅 60%
- 容器实际内存使用接近 limit

### 分析

```bash
# 查看容器内存使用
kubectl top pod <pod-name>
# NAME         CPU    MEMORY
# my-service   800m   3900Mi  （limit 4Gi，已用 95%）

# Java 进程内存分布（Native Memory Tracking）
jcmd <pid> VM.native_memory summary

# 发现：
# - Java Heap:     2.0G（-Xmx2g）
# - Class:          0.5G（元空间）
# - Thread:         0.6G（300线程 × 2M/Xss）
# - Internal:       0.3G（Direct ByteBuffer）
# - Code:           0.2G（JIT 代码缓存）
# - GC:             0.2G（GC 数据结构）
# 总计:            3.8G → 接近 4G limit
```

### 诊断

- **根因**：JVM 堆外内存 + Native 内存 + 容器 overhead 超过了容器 limit
- `-Xmx2g` 只限制了堆，堆外内存不受控制
- 线程栈 `Xss` 默认 1M，300 线程 = 300M

### 优化方案

```bash
# 调整前
java -Xmx2g -jar app.jar

# 调整后 — 使用容器感知参数
java -XX:+UseContainerSupport \
     -XX:MaxRAMPercentage=50.0 \       # 堆 = 50% × 4G = 2G
     -XX:InitialRAMPercentage=50.0 \
     -XX:MaxMetaspaceSize=256m \        # 限制元空间
     -XX:MaxDirectMemorySize=256m \     # 限制直接内存
     -XX:ReservedCodeCacheSize=128m \   # 减小代码缓存
     -Xss512k \                         # 减小线程栈（1M→512K）
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/tmp/heapdump.hprof \
     -Xlog:gc*:file=/tmp/gc.log:time:filecount=3,filesize=10m \
     -jar app.jar
```

### Kubernetes 配置

```yaml
resources:
  requests:
    memory: "3Gi"
    cpu: "1.5"
  limits:
    memory: "4Gi"
    cpu: "2"

# 增加容器内存余量
# JVM 堆 2G + 堆外 ~1.5G + OS ~0.5G = 4G
```

### 效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| OOMKilled | 每周 3-5 次 | 0 |
| 容器内存使用 | 3.9G/4G | 3.0G/4G |
| GC P99 停顿 | 120ms | 45ms |

## 全链路调优实战

### 场景

一个在线教育平台，用户反馈视频加载慢，接口 P99 > 3s。

### Step 1：监控定位

```bash
# Prometheus 告警
# - API 服务 P99 > 3s
# - GC 停顿 P99 > 500ms

# Grafana Dashboard
# - 堆使用率持续在 85%
# - Young GC 频率 2 秒一次
# - 老年代持续增长
```

### Step 2：分析 GC 日志

```bash
# 上传 GC 日志到 GCEasy
# 分析结果：
# - Throughput: 92%（目标 > 98%）
# - Avg Young GC pause: 65ms
# - Max Young GC pause: 320ms
# - Full GC: 5 times in 2 hours
# - Object promotion rate: 200MB/s
```

### Step 3：线程分析

```bash
# jstack 发现大量 BLOCKED 线程
"pool-3-thread-15" #45 prio=5 os_prio=0 tid=0x... nid=0x... waiting for monitor entry
   java.lang.Thread.State: BLOCKED (on object monitor)
    at com.example.VideoService.getVideoInfo(VideoService.java:123)
    - waiting to lock <0x...> (a java.lang.Object)
    at com.example.VideoService.process(VideoService.java:89)
```

### Step 4：代码定位

```java
// 问题代码：同步锁 + 缓存无淘汰
public class VideoService {
    private Map<String, VideoInfo> cache = new HashMap<>();

    public synchronized VideoInfo getVideoInfo(String id) {
        VideoInfo info = cache.get(id);
        if (info == null) {
            info = loadFromDB(id);  // DB 查询慢
            cache.put(id, info);     // 缓存无限增长
        }
        return info;
    }
}
```

### Step 5：优化实施

```java
// 优化后：异步加载 + 限制缓存
public class VideoService {
    private Cache<String, VideoInfo> cache = Caffeine.newBuilder()
        .maximumSize(50000)
        .expireAfterWrite(Duration.ofMinutes(30))
        .refreshAfterWrite(Duration.ofMinutes(10))
        .buildAsync(this::loadFromDB);  // 异步刷新

    public CompletableFuture<VideoInfo> getVideoInfo(String id) {
        return cache.get(id);
    }
}
```

```bash
# JVM 参数调整
# 增大堆 + 优化 G1
java -Xms4g -Xmx4g \
     -XX:+UseG1GC \
     -XX:MaxGCPauseMillis=100 \
     -XX:G1HeapRegionSize=8m \
     -XX:InitiatingHeapOccupancyPercent=40 \
     -jar app.jar
```

### Step 6：验证效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| API P99 延迟 | 3200ms | 180ms |
| GC 吞吐量 | 92% | 99.2% |
| Full GC | 5 次/2小时 | 0 |
| 线程 BLOCKED | 30+ | 0 |

## 调优最佳实践总结

1. **始终开启 GC 日志和 HeapDump**，这是调优和故障排查的基础
2. **-Xms = -Xmx**，避免堆动态扩缩容的抖动
3. **容器环境使用 `-XX:MaxRAMPercentage`** 代替固定 `-Xmx`
4. **先优化代码再调 JVM**，代码问题无法通过参数解决
5. **避免显式 System.gc()**，使用 `-XX:+DisableExplicitGC` 禁止
6. **选择合适的收集器**：延迟敏感用 G1/ZGC，吞吐优先用 Parallel
7. **关注堆外内存**：Native Memory Tracking 帮助排查
8. **逐步调优**：每次只改一个参数，对比基线验证效果
9. **灰度发布**：调优参数先在部分实例验证
10. **持续监控**：调优不是一次性工作，需要持续关注指标变化

## 小结

本章通过四个实战案例展示了 JVM 调优的全过程：从监控发现问题，到分析 GC 日志和线程 dump 定位根因，再到制定和实施优化方案，最后验证效果。调优的核心不是记住参数，而是掌握「监控→定位→分析→优化→验证」的方法论。
