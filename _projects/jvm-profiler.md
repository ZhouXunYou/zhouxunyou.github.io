---
layout: repo
title: "jvm-profiler"
description: "Lightweight JVM profiling tool with flame graph generation"
language: "Java"
language_color: "#b07219"
stars: 28
forks: 7
category: jvm-performance
pinned: true
license: "Apache-2.0"
files:
  - name: "src/"
    type: dir
  - name: "src/main/java/"
    type: dir
  - name: "src/main/resources/"
    type: dir
  - name: "README.md"
    type: file
  - name: "pom.xml"
    type: file
  - name: "LICENSE"
    type: file
---

# jvm-profiler

A lightweight JVM profiling tool with async stack sampling and flame graph generation.

## Features

- Async stack sampling with minimal overhead (< 2%)
- Flame graph SVG generation
- CPU, Allocation, and Lock profiling modes
- Java Agent and CLI interfaces
- JDK Flight Recorder (JFR) integration

## Quick Start

### As Java Agent

```bash
java -javaagent:jvm-profiler.jar=mode=cpu,output=flame.html -jar your-app.jar
```

### CLI Mode

```bash
# Profile a running JVM process
java -jar jvm-profiler.jar --pid 12345 --mode cpu --duration 30s --output flame.html

# Allocation profiling
java -jar jvm-profiler.jar --pid 12345 --mode alloc --output alloc.svg
```

## Programmatic API

```java
ProfilerConfig config = ProfilerConfig.builder()
    .mode(ProfilerMode.CPU)
    .duration(Duration.ofSeconds(30))
    .samplingInterval(Duration.ofMillis(10))
    .outputFormat(OutputFormat.FLAME_GRAPH)
    .build();

Profiler profiler = ProfilerFactory.create(config);
ProfilerResult result = profiler.run();

result.save(Paths.get("profile.html"));
```

## Supported JVM Versions

- JDK 11 (LTS)
- JDK 17 (LTS)
- JDK 21 (LTS)

## License

Apache-2.0
