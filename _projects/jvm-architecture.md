---
layout: page
title: "JVM 架构概览"
category: jvm-architecture
sidebar: true
lang: zh
lang_alt: /en/jvm-architecture/
sort_order: 1
nav:
  prev:
  next: /jvm-memory/
---

## JVM 整体架构

Java 虚拟机（JVM）是运行 Java 字节码的虚拟机实例。HotSpot JVM 的整体架构由三个主要子系统构成：

- **类加载器子系统（Class Loader Subsystem）**：负责从磁盘或网络加载 class 文件，并完成链接和初始化
- **运行时数据区（Runtime Data Areas）**：JVM 在执行期间管理的内存区域，包括堆、栈、方法区等
- **执行引擎（Execution Engine）**：负责执行字节码，包含解释器、JIT 编译器和垃圾收集器

```
┌─────────────────────────────────────────────────┐
│                  Class Loader                    │
│  Loading → Linking (Verify/Prepare/Resolve)      │
│             → Initialization                     │
├─────────────────────────────────────────────────┤
│              Runtime Data Areas                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │ Heap │ │Method│ │  PC  │ │  VM  │ │Native│  │
│  │      │ │ Area │ │ Reg  │ │Stack │ │Stack │  │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │
├─────────────────────────────────────────────────┤
│              Execution Engine                    │
│  Interpreter │ JIT Compiler │ GC                 │
└─────────────────────────────────────────────────┘
```

## 类加载机制

### 双亲委派模型

JVM 采用双亲委派（Parents Delegation）模型进行类加载：

1. **Bootstrap ClassLoader**：加载 `<JAVA_HOME>/lib` 目录下的核心类库（如 `rt.jar`）
2. **Extension ClassLoader**：加载 `<JAVA_HOME>/lib/ext` 目录下的扩展类库
3. **Application ClassLoader**：加载用户类路径（classpath）上的类

当收到类加载请求时，类加载器会先将请求委派给父加载器处理。只有当父加载器无法完成加载时，才由自己尝试加载。这保证了核心类库的安全性和唯一性。

### 打破双亲委派

以下场景需要打破双亲委派模型：

- **SPI 机制**：如 JDBC，核心类 `java.sql.Driver` 由 Bootstrap 加载，但实现类在 classpath 上。通过线程上下文类加载器（Thread Context ClassLoader）解决
- **Tomcat 类加载**：每个 Web 应用有独立的 WebAppClassLoader，优先加载应用自己的类，实现应用间隔离
- **OSGi 模块化**：网状类加载结构，每个 Bundle 有独立的类加载器

### 自定义 ClassLoader

继承 `java.lang.ClassLoader` 并重写 `findClass()` 方法可实现自定义类加载器，典型应用场景：

- 从网络、数据库或加密文件加载类
- 实现类的热替换（Hot Swap）
- 实现应用隔离

```java
public class CustomClassLoader extends ClassLoader {
    private byte[] loadClassData(String name) {
        // 从自定义来源加载类字节码
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        byte[] data = loadClassData(name);
        return defineClass(name, data, 0, data.length);
    }
}
```

## JIT 编译器

### 解释执行 vs 编译执行

JVM 最初采用解释执行（Interpreter）逐条解释字节码，速度较慢。JIT（Just-In-Time）编译器在运行时将热点代码编译为本地机器码，显著提升执行速度。

### 分层编译（Tiered Compilation）

HotSpot 从 Java 7 开始支持分层编译，共 5 个编译层级：

| 层级 | 编译器 | 说明 |
|------|--------|------|
| 0 | 解释器 | 解释执行，收集 profiling 信息 |
| 1 | C1 | 简单编译，不做 profiling |
| 2 | C1 | 编译并收集有限 profiling |
| 3 | C1 | 编译并收集完整 profiling |
| 4 | C2 | 完全优化编译 |

默认策略：代码先由解释器执行（层级 0），当调用次数超过阈值时，由 C1 编译（层级 3），收集足够的 profiling 后再由 C2 编译（层级 4）。

### 热点探测

JIT 编译基于**方法调用计数器**和**回边计数器**判断热点代码：

- **方法调用计数器**：统计方法被调用的次数，超过阈值触发 JIT 编译
- **回边计数器**：统计循环回边的次数，超过阈值触发 OSR（栈上替换）编译

相关参数：
- `-XX:CompileThreshold`：方法调用阈值（C1 默认 1500，C2 默认 10000）
- `-XX:-TieredCompilation`：关闭分层编译
- `-XX:+PrintCompilation`：打印 JIT 编译日志

## JVM 规范与实现

### JVM 规范

《Java 虚拟机规范》定义了：

- class 文件格式
- 数据类型和值
- 运行时数据区
- 栈帧结构
- 指令集
- 类加载和链接过程

规范不限制具体实现方式，只规定了外部行为。

### 主流实现

| 实现 | 特点 |
|------|------|
| **HotSpot** | Oracle/OpenJDK 默认 JVM，最广泛使用，包含 C1/C2 编译器 |
| **OpenJ9** | IBM 贡献给 Eclipse，启动快、内存占用小 |
| **GraalVM** | 支持多语言（Java/JS/Python/Ruby），Truffle 框架，Native Image |
| **Zing** | Azul Systems，基于 C4 算法实现无停顿 GC |
| **Dragonwell** | 阿里巴巴，基于 OpenJDK，针对电商场景优化 |

## 小结

本章概述了 JVM 的整体架构。理解类加载机制、JIT 编译原理和不同 JVM 实现的特点，是深入学习 JVM 调优的基础。下一章将详细介绍 JVM 的内存模型和运行时数据区。
