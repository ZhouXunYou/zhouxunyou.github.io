---
layout: page
title: "JVM 性能监控工具"
category: jvm-tools
sidebar: true
lang: zh
lang_alt: /en/jvm-tools/
sort_order: 7
nav:
  prev: /jvm-gc-logging/
  next: /jvm-diagnostics/
---

## 命令行工具

JDK 自带了一系列命令行工具，位于 `$JAVA_HOME/bin/` 下，是 JVM 监控和诊断的第一道防线。

### jps — 查看 Java 进程

```bash
# 列出所有 Java 进程
jps

# 输出完整主类名
jps -l

# 输出 JVM 参数
jps -v

# 输出 main 方法参数
jps -m
```

```
12345 org.example.MyApp
12346 sun.tools.jps.Jps
```

### jstat — 监控 GC 统计

jstat 是监控 GC 最常用的命令行工具，可以持续观察内存和 GC 情况。

```bash
# 查看 GC 概要（每 1 秒刷新，共 10 次）
jstat -gc <pid> 1000 10

# 查看 GC 概要（含各代百分比）
jstat -gcutil <pid> 1000 10

# 查看新生代 GC 统计
jstat -gcnew <pid>

# 查看老年代 GC 统计
jstat -gcold <pid>

# 查看 GC 原因
jstat -gccause <pid>
```

**jstat -gc 输出字段说明：**

| 列名 | 含义 |
|------|------|
| S0C/S1C | Survivor 0/1 容量（KB） |
| S0U/S1U | Survivor 0/1 已使用（KB） |
| EC/EU | Eden 容量/已使用（KB） |
| OC/OU | 老年代 容量/已使用（KB） |
| MC/MU | 元空间 容量/已使用（KB） |
| YGC/FGC | Young GC / Full GC 次数 |
| YGCT/FGCT | Young GC / Full GC 总时间（秒） |
| GCT | GC 总时间（秒） |

```bash
# 实用示例：计算 GC 停顿占比
jstat -gcutil <pid> 1000 5
# 观察 YGCT 和 FGCT 的增量，除以采样间隔即为 GC 停顿占比
```

### jinfo — 查看/修改 JVM 参数

```bash
# 查看所有 JVM 参数
jinfo <pid>

# 查看某个参数
jinfo -flag MaxHeapSize <pid>
jinfo -flag UseG1GC <pid>

# 动态修改参数（仅限可修改的 flag）
jinfo -flag +PrintGCDetails <pid>
jinfo -flag -PrintGCDetails <pid>

# 查看系统属性
jinfo -sysprops <pid>
```

### jmap — 内存映射与堆 dump

```bash
# 查看堆内存概要
jmap -heap <pid>

# 查看对象统计（按类分组，按占用排序）
jmap -histo <pid> | head -20

# 只看存活对象（会触发 Full GC）
jmap -histo:live <pid> | head -20

# 导出堆 dump
jmap -dump:format=b,file=heap.hprof <pid>

# 导出存活对象的堆 dump（会触发 Full GC）
jmap -dump:live,format=b,file=heap.hprof <pid>

# 查看等待 finalize 的对象
jmap -finalizerinfo <pid>
```

**jmap -histo 输出示例：**

```
 num     #instances         #bytes  class name
   1:       1234567      123456789  [B (byte数组)
   2:        567890       45678901  java.lang.String
   3:        345678       23456789  java.util.HashMap$Node
   4:        234567       12345678  java.lang.Object
```

> **注意**：jmap 在 JDK 9+ 中部分功能被 `jcmd` 替代。生产环境中 `jmap -histo:live` 会触发 Full GC，谨慎使用。

### jstack — 线程堆栈 dump

```bash
# 打印线程堆栈
jstack <pid>

# 强制打印（进程无响应时）
jstack -F <pid>

# 打印锁信息
jstack -l <pid>

# 输出到文件
jstack <pid> > thread_dump.txt
```

**线程状态解读：**

| 状态 | 含义 |
|------|------|
| RUNNABLE | 运行中或等待 CPU |
| BLOCKED | 等待获取监视器锁 |
| WAITING | 无限期等待（Object.wait/Join/LockSupport.park） |
| TIMED_WAITING | 有时限等待（sleep/wait(timeout)/parkNanos） |
| TERMINATED | 已退出 |

**死锁检测**：jstack 会在输出末尾报告检测到的死锁。

### jcmd — 多功能命令

jcmd 是 JDK 7+ 引入的统一命令行工具，整合了 jps、jinfo、jmap、jstack 的部分功能：

```bash
# 列出 Java 进程
jcmd

# 查看进程支持的所有命令
jcmd <pid> help

# 线程堆栈（替代 jstack）
jcmd <pid> Thread.print

# 堆信息（替代 jmap -heap）
jcmd <pid> GC.heap_info

# 对象统计（替代 jmap -histo）
jcmd <pid> GC.class_histogram

# 堆 dump（替代 jmap -dump）
jcmd <pid> GC.heap_dump filename=heap.hprof

# 查看 JVM 参数
jcmd <pid> VM.flags
jcmd <pid> VM.command_line

# 查看 JVM 系统属性
jcmd <pid> VM.system_properties

# JFR 相关
jcmd <pid> JFR.start
jcmd <pid> JFR.dump filename=recording.jfr
jcmd <pid> JFR.stop
```

## 图形化工具

### VisualVM

VisualVM 是 JDK 自带（JDK 6-8）或独立下载（JDK 9+）的全功能监控工具。

**核心功能**：
- **Overview**：进程基本信息、JVM 参数、系统属性
- **Monitor**：CPU/内存/类/线程的实时图表
- **Threads**：线程状态可视化，检测死锁
- **Sampler**：CPU/内存采样分析
- **Profiler**：CPU/内存性能分析（更精确但开销更大）
- **Heap Dump**：堆 dump 分析，查找内存泄漏

```bash
# 启动 VisualVM
jvisualvm

# 或下载独立版本
# https://visualvm.github.io/
```

**插件推荐**：
- Visual GC：可视化 GC 活动
- BTrace Workbench：动态追踪

### JConsole

JDK 自带的轻量级监控工具，基于 JMX：

```bash
jconsole <pid>
```

**功能**：
- 内存使用趋势图（各内存池）
- 线程数量和状态
- 类加载数量
- MBean 操作
- 死锁检测

## Java Flight Recorder (JFR)

JFR 是 JVM 内置的低开销事件采集框架，从 JDK 11 开始免费开放。

### 核心概念

- **事件（Event）**：JVM 内部发生的动作记录，包含时间戳、线程、堆栈等信息
- **Recording**：事件采集会话，可配置持续时间和事件类型
- **开销极低**：通常 < 2% 的性能影响，适合生产环境持续使用

### 使用方式

```bash
# 启动时开启 JFR
java -XX:StartFlightRecording=duration=60s,filename=app.jfr ...

# 使用 jcmd 控制
jcmd <pid> JFR.start name=profiling duration=60s filename=app.jfr
jcmd <pid> JFR.dump name=profiling filename=dump.jfr
jcmd <pid> JFR.stop name=profiling

# 延迟启动 + 持续记录
jcmd <pid> JFR.start name=continuous settings=profile maxsize=100m maxage=1h
```

### JFR 事件类型

| 类别 | 事件示例 |
|------|---------|
| GC | GC Pause、GC Phase、Heap Summary |
| 编译 | JIT Compilation、Method Inline |
| 线程 | Thread Start/End、Thread Sleep、Thread Park |
| 锁 | Java Monitor Wait、Java Monitor Blocked |
| 内存 | Object Allocation in new TLAB、Object Allocation outside TLAB |
| IO | File Read/Write、Socket Read/Write |
| 异常 | Exception Throw、Error Throw |

## Java Mission Control (JMC)

JMC 是 JFR 的分析工具，提供丰富的可视化界面：

```bash
# 下载
# https://www.oracle.com/java/technologies/jdk-mission-control.html

# 打开 JFR 录制文件
jmc app.jfr
```

**核心功能**：
- **GC 分析**：停顿时间分布、各代使用曲线
- **内存分析**：对象分配热点、TLAB 分配
- **线程分析**：阻塞热点、锁竞争
- **方法分析**：CPU 热点方法、编译事件
- **IO 分析**：文件/网络 IO 热点

## Arthas

Arthas 是阿里巴巴开源的 Java 诊断工具，适合在线排查问题，无需重启应用。

```bash
# 安装并启动
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 或直接附加到进程
java -jar arthas-boot.jar <pid>
```

### 常用命令

```bash
# 查看仪表盘（CPU/内存/线程/GC 实时数据）
dashboard

# 查看线程信息
thread                  # 所有线程
thread -n 3             # CPU 占用最高的 3 个线程
thread -b               # 查找死锁

# 反编译类
jad com.example.MyClass

# 监控方法调用
monitor com.example.MyService process -c 10

# 方法执行耗时
trace com.example.MyService process

# 观察方法参数和返回值
watch com.example.MyService process "{params,returnObj}" -x 2

# 查看类信息
sc -d com.example.MyClass

# 查看方法调用路径
stack com.example.MyService process

# 热更新代码
retransform /tmp/MyClass.java

# 查看当前 JVM 信息
jvm

# 查看 GC 信息
memory

# 导出堆 dump
heapdump /tmp/heap.hprof
```

## Prometheus + Grafana 监控 JVM

生产环境推荐使用 Prometheus + Grafana 进行持续监控。

### 暴露 JVM 指标

```bash
# 方式 1：JMX Exporter（推荐）
java -javaagent:jmx_prometheus_javaagent.jar=8080:config.jar -jar app.jar

# 方式 2：Micrometer（Spring Boot 应用）
# 添加依赖 + 配置
management.endpoints.web.exposure.include=prometheus
management.metrics.export.prometheus.enabled=true
```

### 关键监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| `jvm_memory_used_bytes` | 内存使用量 | > 85% |
| `jvm_gc_pause_seconds` | GC 停顿时间 | P99 > 500ms |
| `jvm_gc_memory_promoted_bytes_total` | 晋升到老年代的对象量 | 持续增长 |
| `jvm_threads_current` | 当前线程数 | > 500 |
| `jvm_classes_loaded` | 已加载类数量 | 异常增长 |
| `process_cpu_usage` | 进程 CPU 使用率 | > 80% |

### Grafana Dashboard

推荐导入现成的 Dashboard：
- JVM (Micrometer) - Dashboard ID: 4701
- JMX Exporter - Dashboard ID: 11526

## 工具选择指南

| 场景 | 推荐工具 | 理由 |
|------|---------|------|
| 快速查看 GC 状态 | jstat | 轻量、无需额外安装 |
| 查看对象分布 | jmap -histo | 快速定位大对象 |
| 内存泄漏排查 | jmap -dump + MAT | 完整堆分析 |
| 线程问题排查 | jstack / Arthas thread | 查看线程状态和死锁 |
| 在线方法追踪 | Arthas trace/watch | 无需重启，实时追踪 |
| 深度性能分析 | JFR + JMC | 低开销，事件丰富 |
| 生产持续监控 | Prometheus + Grafana | 实时告警，历史数据 |

## 小结

本章介绍了从命令行到图形化的各种 JVM 监控工具。命令行工具（jstat/jmap/jstack/jcmd）适合快速排查；JFR + JMC 适合深度性能分析；Arthas 适合在线诊断无需重启；Prometheus + Grafana 适合生产持续监控。下一章将学习如何运用这些工具进行诊断和故障排查。
