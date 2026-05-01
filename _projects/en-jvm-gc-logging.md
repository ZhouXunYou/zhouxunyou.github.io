---
layout: page
title: "GC Logging & Analysis"
category: jvm-gc-logging
sidebar: true
lang: en
lang_alt: /jvm-gc-logging/
permalink: /en/jvm-gc-logging/
sort_order: 6
nav:
  prev: /en/jvm-gc-collectors/
  next: /en/jvm-tools/
---

## The Importance of GC Logging

GC logs are the most critical data source for JVM tuning. By analyzing GC logs, you can:

- Confirm whether GC frequency and pause times meet expectations
- Detect memory leaks, frequent Full GCs, and other issues
- Evaluate the effectiveness of different collectors and parameters
- Identify performance bottlenecks

## GC Logging Parameter Configuration

### JDK 8 and Earlier

```bash
-XX:+PrintGCDetails              # Print detailed GC information
-XX:+PrintGCDateStamps           # Print timestamps for GC events
-XX:+PrintGCTimeStamps           # Print relative time since JVM startup
-XX:+PrintGCApplicationStoppedTime  # Print STW pause duration
-XX:+PrintGCApplicationConcurrentTime  # Print application running time
-XX:+PrintHeapAtGC               # Print heap info before and after GC
-Xloggc:/var/log/gc.log          # GC log output file
-XX:+UseGCLogFileRotation        # GC log rotation
-XX:NumberOfGCLogFiles=5         # Number of rotated files
-XX:GCLogFileSize=20M            # Size of each log file
```

### JDK 9+ (Unified Logging Framework -Xlog)

JDK 9 introduced the unified `-Xlog` parameter to replace multiple Print* flags:

```bash
# Basic format
-Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags:filecount=5,filesize=20m

# Parameter explanation
# gc*          — Log tag (gc* means all GC-related logs)
# file=...     — Output to file
# time,uptime  — Output timestamps
# level        — Output log level
# tags         — Output log tags
# filecount    — Number of rotated files
# filesize     — Size of each file

# Common configuration
-Xlog:gc*=info:file=gc.log:time,uptime:filecount=5,filesize=20m

# View only GC pause times
-Xlog:gc+phases=debug

# View JIT compilation information
-Xlog:jit+compilation=info
```

### Key Diagnostic Parameters

```bash
-XX:+HeapDumpOnOutOfMemoryError          # Auto heap dump on OOM
-XX:HeapDumpPath=/var/log/heapdump.hprof  # Dump file path
-XX:ErrorFile=/var/log/hs_err_%p.log      # Fatal error log
```

## Interpreting GC Log Formats

### G1 GC Log Example

```
# Young GC
[2024-01-15T10:30:45.123+0800][2024-01-15T10:30:45.123+0800] GC pause (G1 Evacuation Pause) (young)
  [Eden: 256.0M(256.0M)->0.0B(230.0M) Survivors: 0.0B->26.0M Heap: 256.0M(512.0M)->24.0M(512.0M)]
  [Times: user=0.08 sys=0.01, real=0.02 secs]

# Concurrent marking
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

# Full GC (should be avoided)
[2024-01-15T10:31:00.000+0800] Full GC (Allocation Failure)
  [Eden: 0.0B(0.0B)->0.0B(112.0M) Survivors: 0.0B->0.0B Heap: 512.0M(512.0M)->256.0M(512.0M)]
  [Times: user=1.20 sys=0.05, real=0.35 secs]
```

### Key Metrics Interpretation

| Metric | Meaning | What to Watch |
|--------|---------|---------------|
| GC pause (young) | Young GC pause | Frequency and duration |
| GC pause (mixed) | Mixed GC pause | Number of old generation regions reclaimed |
| Eden: X->Y | Eden space change | Reclaim efficiency |
| Survivors: X->Y | Survivor space change | Ratio of surviving objects |
| Heap: X->Y | Overall heap change | Memory usage trend |
| real=0.02 secs | Actual pause time | Core metric |
| user=0.08 sys=0.01 | CPU time | user/real > CPU cores indicates effective parallelism |

### CMS GC Log Example

```
# Initial mark (STW)
[GC (CMS Initial Mark) [1 CMS-initial-mark: 256M(512M)] 300M(768M), 0.001234 secs]

# Concurrent mark
[CMS-concurrent-mark: 0.123/0.456 secs]

# Remark (STW)
[GC (CMS Final Remark) [Rescan (parallel), 0.005678 secs]
  [weak refs processing, 0.000234 secs]
  [class unloading, 0.001234 secs]
  [scrub symbol table, 0.000456 secs]
  [scrub string table, 0.000123 secs]
  [1 CMS-remark: 256M(512M)] 300M(768M), 0.008901 secs]

# Concurrent sweep
[CMS-concurrent-sweep: 0.234/0.567 secs]

# Concurrent reset
[CMS-concurrent-reset: 0.012/0.034 secs]
```

## GC Log Analysis Tools

### GCViewer

An open-source GC log visualization tool that supports JDK 8's PrintGCDetails format.

```bash
# Download
# https://github.com/chewiebug/GCViewer

# Usage
java -jar gcviewer.jar gc.log
```

Output statistics:
- Total GC count and time
- Average/maximum pause time
- Throughput (percentage of application running time)
- Heap memory usage curve

### GCEasy

An online GC log analysis tool — upload your log and get a detailed report.

Features:
- Supports all collectors including G1/CMS/Parallel/ZGC
- Automatically identifies issues (frequent Full GC, memory leaks, etc.)
- Generates charts and statistics
- Free version has limitations; paid version offers more features

### GCPlot

A distributed GC log analysis platform suitable for large-scale microservice environments.

### JDK Mission Control (JMC)

Used with JFR, provides real-time GC monitoring and historical data analysis.

## Diagnosing Issues from Logs

### Issue 1: Frequent Young GC

**Log signature**: Extremely short intervals between Young GCs (seconds or less), with few objects reclaimed each time

```
[GC pause (young), 0.015 secs]  -- 1 second ago
[GC pause (young), 0.012 secs]  -- now
```

**Possible causes**:
- Young generation too small, objects promoted prematurely
- Large number of temporary objects being created (e.g., log formatting, large string concatenation)
- Frequent TLAB allocation failures

**Solutions**:
- Increase young generation size (`-Xmn`)
- Optimize code to reduce temporary objects
- Use `-XX:+PrintTLAB` to analyze TLAB behavior

### Issue 2: Premature Object Promotion

**Log signature**: High Survivor space utilization, old generation steadily growing after Young GC

```
[Eden: 256.0M->0.0B Survivors: 0.0B->32.0M]  -- Survivor nearly full
[Eden: 224.0M->0.0B Survivors: 32.0M->32.0M] -- Cannot accommodate, promoted to old generation
```

**Possible causes**:
- Survivor space too small
- Promotion age threshold too low
- Sudden traffic spikes increasing object survival rates

**Solutions**:
- Increase Survivor space (`-XX:SurvivorRatio`)
- Increase overall young generation size
- Raise promotion age (`-XX:MaxTenuringThreshold`)

### Issue 3: Frequent Full GC

**Log signature**: Full GC entries appearing frequently, with long pause times

```
[Full GC (Allocation Failure)  512M->256M(512M), 0.350 secs]
[Full GC (Ergonomics)  480M->260M(512M), 0.320 secs]
```

**Possible causes**:
- Memory leak
- Insufficient old generation space
- Insufficient metaspace
- System.gc() being called
- CMS Concurrent Mode Failure

**Troubleshooting steps**:
1. Confirm the Full GC trigger reason (check the reason field in the log)
2. Use `jmap -histo` to view object distribution
3. Use `jmap -dump` to export heap dump for analysis
4. Investigate whether there is a memory leak

### Issue 4: Excessively Long GC Pauses

**Log signature**: Real time far exceeds expectations

```
[GC pause (G1 Evacuation Pause) (young), 0.500 secs]  -- Normally should be < 50ms
```

**Possible causes**:
- Heap too large, too many regions reclaimed per cycle
- High object survival rate, expensive copying
- Disk I/O causing Swap
- Excessive safepoint wait time

**Solutions**:
- Reduce `-XX:MaxGCPauseMillis` target value
- Check for Swap usage (`free -h`)
- Use `-XX:+PrintSafepointStatistics` to inspect safepoints

## GC Log Analysis Best Practices

1. **Always enable GC logging**: Must be enabled in production; disk overhead is minimal
2. **Set up log rotation**: Prevent individual log files from becoming too large
3. **Auto dump on OOM**: `-XX:+HeapDumpOnOutOfMemoryError`
4. **Periodic analysis**: Establish a regular GC log review mechanism
5. **Baseline comparison**: Record a baseline before tuning, compare results after
6. **Focus on real time**: Not user/sys time — real time is the actual pause duration

## Summary

This chapter covered GC log configuration, format interpretation, and analysis methods. GC logs are the most important data source for JVM tuning, and mastering log analysis is key to troubleshooting GC issues. The next chapter will cover JVM performance monitoring tools.
