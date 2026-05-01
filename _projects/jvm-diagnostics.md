---
layout: page
title: "诊断与故障排查"
category: jvm-diagnostics
sidebar: true
lang: zh
lang_alt: /en/jvm-diagnostics/
sort_order: 8
nav:
  prev: /jvm-tools/
  next: /jvm-parameters/
---

## 故障排查方法论

JVM 故障排查遵循「监控 → 定位 → 分析 → 解决 → 验证」的循环：

```
发现异常（监控告警/用户反馈）
    │
    ▼
定位问题（工具排查）
    │
    ▼
分析原因（日志/dump 分析）
    │
    ▼
实施修复（参数调整/代码修复）
    │
    ▼
验证效果（对比基线）
```

## CPU 飙高排查

### 排查步骤

```
1. top 找到 CPU 占用高的 Java 进程
2. top -Hp <pid> 找到占用高的线程
3. printf '%x\n' <tid> 转换为十六进制
4. jstack <pid> | grep <hex_tid> 查看线程堆栈
5. 分析热点方法
```

### 详细操作

```bash
# 1. 找到 Java 进程
top -c
# PID  USER   %CPU  %MEM  COMMAND
# 12345 app    98.2  15.3  java -jar app.jar

# 2. 找到高 CPU 线程
top -Hp 12345
# PID    USER   %CPU  COMMAND
# 12350  app    95.1  java -jar app.jar

# 3. 线程 ID 转十六进制
printf '%x\n' 12350
# 303e

# 4. 查看线程堆栈
jstack 12345 | grep -A 30 "0x303e"
```

### 常见原因

| 原因 | 堆栈特征 | 解决方案 |
|------|---------|---------|
| 死循环 | 方法堆栈反复调用同一方法 | 修复代码逻辑 |
| 正则回溯 | `java.util.regex.Pattern` | 使用占有量词或固化分组 |
| 频繁 GC | `VM Thread` 或 GC 线程 CPU 高 | 增大堆/优化 GC |
| 加密运算 | `sun.security.*` | 使用缓存/异步 |
| 序列化 | `java.io.ObjectOutputStream` | 优化序列化策略 |

### Arthas 快捷排查

```bash
# 直接找出 CPU 占用最高的 3 个线程
thread -n 3

# 查看特定线程堆栈
thread <thread-id>

# 追踪方法耗时
trace com.example.Service method
```

## 内存泄漏排查

### 排查步骤

```
1. 确认内存持续增长（jstat/jmap/JFR）
2. 导出堆 dump（jmap -dump 或 -XX:+HeapDumpOnOutOfMemoryError）
3. 使用 MAT 分析 dump
4. 找到泄漏对象和 GC Roots 引用链
5. 修复代码
```

### 使用 MAT 分析堆 dump

MAT（Memory Analyzer Tool）是 Eclipse 提供的堆分析工具。

**1. Leak Suspects Report**

打开 dump 后，MAT 自动生成泄漏嫌疑报告，指出可能的泄漏点：

```
Problem Suspect 1:
  The class java.util.concurrent.ConcurrentHashMap$Node occupies 256 MB (50%) of the heap.
  The class is loaded by org.apache.catalina.loader.WebappClassLoader.
  Keywords: java.util.concurrent.ConcurrentHashMap$Node

Problem Suspect 2:
  Thread main keeps local variables with total size 128 MB (25%).
```

**2. Dominator Tree**

查看对象支配树，按 Retained Size（保留大小）排序：

```
Class                                    | Shallow Heap | Retained Heap
─────────────────────────────────────────|──────────────|──────────────
java.util.concurrent.ConcurrentHashMap   |        48 B  |      256 MB
  └─ java.util.concurrent.ConcurrentHashMap$Node[] | 1 MB |  255 MB
       └─ [0] ConcurrentHashMap$Node      |       32 B  |     10 MB
            └─ value: byte[10485760]      |   10 MB     |     10 MB
       └─ [1] ConcurrentHashMap$Node      |       32 B  |     20 MB
       └─ ...
```

- **Shallow Size**：对象自身占用的内存
- **Retained Size**：对象被回收后可释放的总内存（包括其支配的所有对象）

**3. GC Roots 引用链**

右键对象 → Path To GC Roots → exclude weak/soft references：

```
Thread main
  └─ local variable: ConcurrentHashMap
       └─ [47] ConcurrentHashMap$Node
            └─ value: byte[10485760]   ← 泄漏对象
```

### 常见内存泄漏场景

| 场景 | 原因 | 检测方法 |
|------|------|---------|
| 集合类未清理 | Map/List 持续添加不删除 | MAT 找到集合引用链 |
| ThreadLocal 泄漏 | 线程池复用导致 ThreadLocal 不释放 | 检查 ThreadLocalMap |
| 监听器未注销 | 注册后未取消注册 | 搜索 addListener/removeListener |
| 资源未关闭 | 连接/流未 close() | Finalizer 队列中有相关对象 |
| 缓存无淘汰 | 自实现缓存无大小限制 | 检查缓存相关对象数量 |
| 内部类引用 | 非静态内部类持有外部类引用 | MAT 查看外部类引用 |

### ThreadLocal 泄漏示例

```java
// 错误：线程池中 ThreadLocal 不清理
ExecutorService pool = Executors.newFixedThreadPool(10);
pool.execute(() -> {
    threadLocal.set(largeObject);
    // 忘记 remove！线程被复用，largeObject 无法回收
});

// 正确：finally 中清理
pool.execute(() -> {
    try {
        threadLocal.set(largeObject);
        // 业务逻辑
    } finally {
        threadLocal.remove();  // 必须清理
    }
});
```

## OOM 故障处理

### OOM 类型与排查路径

| OOM 信息 | 区域 | 排查方向 |
|---------|------|---------|
| `Java heap space` | 堆 | 内存泄漏或堆不够 |
| `Metaspace` | 元空间 | 类加载过多（动态代理/CGLIB） |
| `GC overhead limit exceeded` | 堆 | GC 回收效果差（98% 时间在 GC，回收不到 2%） |
| `Direct buffer memory` | 直接内存 | NIO 堆外内存溢出 |
| `Unable to create new native thread` | 系统内存 | 线程数过多 |
| `Requested array size exceeds VM limit` | 堆 | 申请数组过大 |

### 堆 OOM 排查流程

```
OOM: Java heap space
    │
    ├── 突发 OOM？
    │   ├── 是 → 检查是否有大批量数据加载
    │   │        → 增大 -Xmx
    │   └── 否（缓慢增长）→ 内存泄漏
    │
    ▼
导出堆 dump 分析
    │
    ├── 对象数量异常 → 检查创建该对象的代码
    │
    ├── 集合类过大 → 检查集合操作逻辑
    │
    └── Class/ClassLoader 过多 → 检查动态类生成
```

### 元空间 OOM 排查

```bash
# 查看已加载类数量
jcmd <pid> GC.class_stats | head -20

# 查看类直方图
jcmd <pid> GC.class_histogram | head -30

# 常见原因
# 1. CGLIB/Spring AOP 大量生成代理类
# 2. JSP 频繁重新编译
# 3. Groovy/Scala 脚本反复编译
# 4. ClassLoader 泄漏（Web 应用热部署）

# 解决方案
# - 增大元空间：-XX:MaxMetaspaceSize=512m
# - 排查类泄漏：-XX:+TraceClassLoading -XX:+TraceClassUnloading
```

## 线程死锁排查

### 检测死锁

```bash
# 方式 1：jstack 自动检测
jstack <pid>
# 输出末尾会报告：
# Found one Java-level deadlock:
# =============================
# "Thread-1":
#   waiting to lock monitor... (a java.lang.Object),
#   which is held by "Thread-0"
# "Thread-0":
#   waiting to lock monitor... (a java.lang.Object),
#   which is held by "Thread-1"

# 方式 2：Arthas
thread -b

# 方式 3：JMX
jconsole → 线程 → 检测死锁
```

### 死锁类型

**1. 经典死锁（两个线程互相等待）**

```java
// Thread 1
synchronized(lockA) {
    synchronized(lockB) { /* ... */ }
}

// Thread 2
synchronized(lockB) {
    synchronized(lockA) { /* ... */ }
}
```

**2. 活锁（线程不断重试但无法成功）**

```java
while (true) {
    if (tryLock()) {
        // 操作失败释放锁，立即重试
        unlock();
    }
}
```

**3. 数据库死锁**

```sql
-- 查看死锁
SHOW ENGINE INNODB STATUS;
```

### 预防死锁

- 固定加锁顺序
- 使用 `tryLock(timeout)` 替代 `lock()`
- 缩小锁的粒度
- 使用并发工具类替代显式加锁

## 类加载冲突排查

### 常见错误

| 错误 | 原因 |
|------|------|
| `ClassNotFoundException` | 类在 classpath 上找不到 |
| `NoClassDefFoundError` | 编译时存在但运行时找不到 |
| `ClassCastException` | 同名类被不同 ClassLoader 加载 |
| `LinkageError` | 类版本不一致 |

### 排查方法

```bash
# 查看类加载来源
jcmd <pid> VM.system_properties | grep java.class.path

# 使用 Arthas 查找类
sc -d com.example.MyClass
# classLoaderHash  classLoaderName  加载来源

# 查找所有 ClassLoader
classloader -t

# 查看某个类从哪个 jar 加载
classloader -c <hash> -r com/example/MyClass.class
```

### Maven 依赖冲突

```bash
# 查看依赖树
mvn dependency:tree -Dverbose | grep conflicting-lib

# 排除冲突依赖
<exclusion>
    <groupId>com.example</groupId>
    <artifactId>conflicting-lib</artifactId>
</exclusion>
```

## 应急处理流程

### 应用无响应

```bash
# 1. 检查进程是否存活
ps aux | grep java

# 2. 检查 CPU 使用
top -Hp <pid>

# 3. 导出线程 dump（连续 3 次，间隔 5 秒）
jstack <pid> > dump1.txt
sleep 5
jstack <pid> > dump2.txt
sleep 5
jstack <pid> > dump3.txt

# 4. 导出堆 dump（可选，有风险）
jcmd <pid> GC.heap_dump filename=emergency_dump.hprof

# 5. 如果无法 jstack，使用强制模式
jstack -F <pid> > forced_dump.txt

# 6. 如果完全无响应，生成 core dump
gcore <pid>
```

### 频繁 Full GC 应急

```bash
# 1. 确认 Full GC 频率
jstat -gcutil <pid> 1000 10

# 2. 导出堆直方图
jcmd <pid> GC.class_histogram > histo.txt

# 3. 如果确认是内存泄漏，导出 dump
jcmd <pid> GC.heap_dump filename=fullgc_dump.hprof

# 4. 临时缓解：增大堆 + 切换收集器
# 修改启动参数后重启
java -Xmx4g -XX:+UseG1GC -jar app.jar
```

## 小结

本章介绍了 JVM 常见故障的排查方法：CPU 飙高用 top+jstack 定位热点线程；内存泄漏用 MAT 分析堆 dump；OOM 按类型排查不同区域；死锁用 jstack 或 Arthas 检测。掌握这些排查方法，能在生产环境中快速定位和解决 JVM 问题。下一章将系统梳理 JVM 调优参数。
