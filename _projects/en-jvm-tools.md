---
layout: page
title: "JVM Performance Monitoring Tools"
category: jvm-tools
sidebar: true
lang: en
lang_alt: /jvm-tools/
permalink: /en/jvm-tools/
sort_order: 7
nav:
  prev: /en/jvm-gc-logging/
  next: /en/jvm-diagnostics/
---

## Command-Line Tools

The JDK ships with a suite of command-line tools located in `$JAVA_HOME/bin/`, serving as the first line of defense for JVM monitoring and diagnostics.

### jps — List Java Processes

```bash
# List all Java processes
jps

# Output full main class name
jps -l

# Output JVM arguments
jps -v

# Output main method arguments
jps -m
```

```
12345 org.example.MyApp
12346 sun.tools.jps.Jps
```

### jstat — Monitor GC Statistics

jstat is the most commonly used command-line tool for monitoring GC, providing continuous observation of memory and GC behavior.

```bash
# View GC summary (refresh every 1 second, 10 times)
jstat -gc <pid> 1000 10

# View GC summary (with percentage for each generation)
jstat -gcutil <pid> 1000 10

# View young generation GC statistics
jstat -gcnew <pid>

# View old generation GC statistics
jstat -gcold <pid>

# View GC causes
jstat -gccause <pid>
```

**jstat -gc output field reference:**

| Column | Meaning |
|--------|---------|
| S0C/S1C | Survivor 0/1 capacity (KB) |
| S0U/S1U | Survivor 0/1 used (KB) |
| EC/EU | Eden capacity/used (KB) |
| OC/OU | Old generation capacity/used (KB) |
| MC/MU | Metaspace capacity/used (KB) |
| YGC/FGC | Young GC / Full GC count |
| YGCT/FGCT | Young GC / Full GC total time (seconds) |
| GCT | Total GC time (seconds) |

```bash
# Practical example: calculate GC pause percentage
jstat -gcutil <pid> 1000 5
# Observe the increment in YGCT and FGCT, divide by the sampling interval to get GC pause percentage
```

### jinfo — View/Modify JVM Parameters

```bash
# View all JVM parameters
jinfo <pid>

# View a specific parameter
jinfo -flag MaxHeapSize <pid>
jinfo -flag UseG1GC <pid>

# Dynamically modify parameters (only for writeable flags)
jinfo -flag +PrintGCDetails <pid>
jinfo -flag -PrintGCDetails <pid>

# View system properties
jinfo -sysprops <pid>
```

### jmap — Memory Mapping and Heap Dumps

```bash
# View heap memory summary
jmap -heap <pid>

# View object statistics (grouped by class, sorted by size)
jmap -histo <pid> | head -20

# View only live objects (triggers Full GC)
jmap -histo:live <pid> | head -20

# Export heap dump
jmap -dump:format=b,file=heap.hprof <pid>

# Export heap dump of live objects only (triggers Full GC)
jmap -dump:live,format=b,file=heap.hprof <pid>

# View objects waiting for finalization
jmap -finalizerinfo <pid>
```

**jmap -histo output example:**

```
 num     #instances         #bytes  class name
   1:       1234567      123456789  [B (byte arrays)
   2:        567890       45678901  java.lang.String
   3:        345678       23456789  java.util.HashMap$Node
   4:        234567       12345678  java.lang.Object
```

> **Note**: Some jmap functionality is replaced by `jcmd` in JDK 9+. In production environments, `jmap -histo:live` triggers Full GC — use with caution.

### jstack — Thread Stack Dump

```bash
# Print thread stacks
jstack <pid>

# Force print (when process is unresponsive)
jstack -F <pid>

# Print lock information
jstack -l <pid>

# Output to file
jstack <pid> > thread_dump.txt
```

**Thread state reference:**

| State | Meaning |
|-------|---------|
| RUNNABLE | Running or waiting for CPU |
| BLOCKED | Waiting to acquire a monitor lock |
| WAITING | Waiting indefinitely (Object.wait/Join/LockSupport.park) |
| TIMED_WAITING | Waiting with timeout (sleep/wait(timeout)/parkNanos) |
| TERMINATED | Has exited |

**Deadlock detection**: jstack reports detected deadlocks at the end of its output.

### jcmd — Multi-Function Command

jcmd is a unified command-line tool introduced in JDK 7+, consolidating functionality from jps, jinfo, jmap, and jstack:

```bash
# List Java processes
jcmd

# View all commands supported by a process
jcmd <pid> help

# Thread stack (replaces jstack)
jcmd <pid> Thread.print

# Heap info (replaces jmap -heap)
jcmd <pid> GC.heap_info

# Object statistics (replaces jmap -histo)
jcmd <pid> GC.class_histogram

# Heap dump (replaces jmap -dump)
jcmd <pid> GC.heap_dump filename=heap.hprof

# View JVM parameters
jcmd <pid> VM.flags
jcmd <pid> VM.command_line

# View JVM system properties
jcmd <pid> VM.system_properties

# JFR-related commands
jcmd <pid> JFR.start
jcmd <pid> JFR.dump filename=recording.jfr
jcmd <pid> JFR.stop
```

## Graphical Tools

### VisualVM

VisualVM is a full-featured monitoring tool bundled with JDK 6-8 or available as a standalone download for JDK 9+.

**Core features**:
- **Overview**: Process basic info, JVM parameters, system properties
- **Monitor**: Real-time charts for CPU/memory/classes/threads
- **Threads**: Thread state visualization, deadlock detection
- **Sampler**: CPU/memory sampling analysis
- **Profiler**: CPU/memory profiling (more accurate but higher overhead)
- **Heap Dump**: Heap dump analysis, memory leak detection

```bash
# Launch VisualVM
jvisualvm

# Or download the standalone version
# https://visualvm.github.io/
```

**Recommended plugins**:
- Visual GC: Visualize GC activity
- BTrace Workbench: Dynamic tracing

### JConsole

A lightweight monitoring tool bundled with the JDK, based on JMX:

```bash
jconsole <pid>
```

**Features**:
- Memory usage trend charts (per memory pool)
- Thread count and states
- Class loading count
- MBean operations
- Deadlock detection

## Java Flight Recorder (JFR)

JFR is a built-in low-overhead event collection framework in the JVM, freely available since JDK 11.

### Core Concepts

- **Event**: Records of actions occurring within the JVM, containing timestamps, threads, stack traces, etc.
- **Recording**: An event collection session, configurable with duration and event types
- **Extremely low overhead**: Typically < 2% performance impact, suitable for continuous production use

### Usage

```bash
# Enable JFR at startup
java -XX:StartFlightRecording=duration=60s,filename=app.jfr ...

# Control via jcmd
jcmd <pid> JFR.start name=profiling duration=60s filename=app.jfr
jcmd <pid> JFR.dump name=profiling filename=dump.jfr
jcmd <pid> JFR.stop name=profiling

# Delayed start + continuous recording
jcmd <pid> JFR.start name=continuous settings=profile maxsize=100m maxage=1h
```

### JFR Event Types

| Category | Event Examples |
|----------|---------------|
| GC | GC Pause, GC Phase, Heap Summary |
| Compilation | JIT Compilation, Method Inline |
| Threads | Thread Start/End, Thread Sleep, Thread Park |
| Locks | Java Monitor Wait, Java Monitor Blocked |
| Memory | Object Allocation in new TLAB, Object Allocation outside TLAB |
| IO | File Read/Write, Socket Read/Write |
| Exceptions | Exception Throw, Error Throw |

## Java Mission Control (JMC)

JMC is the analysis tool for JFR, providing a rich visual interface:

```bash
# Download
# https://www.oracle.com/java/technologies/jdk-mission-control.html

# Open a JFR recording file
jmc app.jfr
```

**Core features**:
- **GC analysis**: Pause time distribution, per-generation usage curves
- **Memory analysis**: Object allocation hotspots, TLAB allocation
- **Thread analysis**: Blocking hotspots, lock contention
- **Method analysis**: CPU hot methods, compilation events
- **IO analysis**: File/network IO hotspots

## Arthas

Arthas is an open-source Java diagnostic tool from Alibaba, designed for online troubleshooting without restarting the application.

```bash
# Install and launch
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# Or attach directly to a process
java -jar arthas-boot.jar <pid>
```

### Common Commands

```bash
# View dashboard (CPU/memory/threads/GC real-time data)
dashboard

# View thread information
thread                  # All threads
thread -n 3             # Top 3 threads by CPU usage
thread -b               # Find deadlocks

# Decompile a class
jad com.example.MyClass

# Monitor method invocations
monitor com.example.MyService process -c 10

# Trace method execution time
trace com.example.MyService process

# Observe method parameters and return values
watch com.example.MyService process "{params,returnObj}" -x 2

# View class information
sc -d com.example.MyClass

# View method call path
stack com.example.MyService process

# Hot-swap code
retransform /tmp/MyClass.java

# View current JVM information
jvm

# View GC information
memory

# Export heap dump
heapdump /tmp/heap.hprof
```

## Prometheus + Grafana for JVM Monitoring

For production environments, Prometheus + Grafana is recommended for continuous monitoring.

### Exposing JVM Metrics

```bash
# Option 1: JMX Exporter (recommended)
java -javaagent:jmx_prometheus_javaagent.jar=8080:config.jar -jar app.jar

# Option 2: Micrometer (Spring Boot applications)
# Add dependency + configuration
management.endpoints.web.exposure.include=prometheus
management.metrics.export.prometheus.enabled=true
```

### Key Monitoring Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `jvm_memory_used_bytes` | Memory usage | > 85% |
| `jvm_gc_pause_seconds` | GC pause time | P99 > 500ms |
| `jvm_gc_memory_promoted_bytes_total` | Objects promoted to old generation | Steady growth |
| `jvm_threads_current` | Current thread count | > 500 |
| `jvm_classes_loaded` | Loaded class count | Abnormal growth |
| `process_cpu_usage` | Process CPU usage | > 80% |

### Grafana Dashboard

Recommended pre-built dashboards to import:
- JVM (Micrometer) - Dashboard ID: 4701
- JMX Exporter - Dashboard ID: 11526

## Tool Selection Guide

| Scenario | Recommended Tool | Reason |
|----------|-----------------|--------|
| Quick GC status check | jstat | Lightweight, no additional installation needed |
| View object distribution | jmap -histo | Quickly locate large objects |
| Memory leak investigation | jmap -dump + MAT | Complete heap analysis |
| Thread issue investigation | jstack / Arthas thread | View thread states and deadlocks |
| Online method tracing | Arthas trace/watch | No restart needed, real-time tracing |
| Deep performance analysis | JFR + JMC | Low overhead, rich events |
| Production continuous monitoring | Prometheus + Grafana | Real-time alerts, historical data |

## Summary

This chapter covered various JVM monitoring tools, from command-line to graphical interfaces. Command-line tools (jstat/jmap/jstack/jcmd) are suited for quick troubleshooting; JFR + JMC for deep performance analysis; Arthas for online diagnostics without restarting; and Prometheus + Grafana for continuous production monitoring. The next chapter will cover how to use these tools for diagnostics and troubleshooting.
