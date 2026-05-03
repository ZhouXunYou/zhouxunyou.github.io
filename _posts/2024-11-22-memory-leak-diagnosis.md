---
layout: post
title: "内存泄漏排查实战：用 MAT 和 async-profiler 定位生产问题"
date: 2024-11-22
categories: [jvm]
author: Zhou Xunyou
lang: zh
---

内存泄漏是 Java 生产环境的常见问题。本文通过一个真实案例，展示如何用 **MAT（Memory Analyzer Tool）** 和 **async-profiler** 定位并解决内存泄漏。

## 什么是内存泄漏？

内存泄漏 = **对象应该被回收但实际没有被回收**，导致可用内存越来越少，最终触发 OOM。

```
正常回收：                              内存泄漏：
  GC Roots                                  GC Roots
     ↓                                        ↓
  A → B → C  → D（引用链正常）           A → B → C → D（存在隐藏引用）
  C 不再被外部引用                       C 仍被一个 HashMap 持有引用
  C 可被回收                             C 无法被回收 → 泄漏
```

### 常见的泄漏场景

| 场景 | 原因 | 典型代码 |
|------|------|---------|
| 静态集合持有对象 | 集合只增不减 | `static Map cache = new HashMap()` |
| 监听器未注销 | 观察者模式中 listener 未移除 | `addListener(listener)` 后无 `removeListener` |
| ThreadLocal 未清理 | 线程池复用导致值对象无法释放 | `threadLocal.set(obj)` 后无 `remove()` |
| 数据库连接/Stream 未关闭 | 资源未 finally 释放 | `ResultSet`/`Stream` 用完未 close |
| 动态类加载 | ClassLoader 持有元数据 | CGLIB/JVM TI 动态生成大量类 |

## 案例：Spring Boot 应用内存持续增长

### 症状

应用启动后内存从 500MB 逐渐增长到 OOM（约 2GB），GC 后内存不回落：

```
heap after GC：
  2024-11-20 10:00  used=480M, gc.time=23ms
  2024-11-20 10:05  used=620M, gc.time=31ms    ← 持续上升
  2024-11-20 10:10  used=890M, gc.time=45ms    ← 上升更快
  ...（大约 6 小时后 OOM）
```

### Step 1：Heap Dump 获取

**方式一：运行时自动 dump（推荐）**

```bash
# OOM 时自动生成 heap dump
java -XX:+HeapDumpOnOutOfMemoryError \
     -XX:HeapDumpPath=/data/heapdump/ \
     -Xms2g -Xmx2g your-app.jar
```

**方式二：手动 jmap（需要 JDK 工具）**

```bash
# 获取 live heap dump（会触发 Full GC + STW）
jmap -dump:live,format=b,file=heap-20241120-1015.hprof <pid>

# 无 Full GC 的 dump（所有对象，包括即将被回收的）
jmap -dump:format=b,file=heap-all.hprof <pid>
```

### Step 2：MAT 分析泄漏嫌疑

用 MAT（Eclipse Memory Analyzer）打开 `.hprof` 文件：

```
1. Leak Suspects Report → 自动分析泄漏嫌疑人
2. Dominator Tree → 按对象 retained heap 排序
3. Histogram → 按类名统计对象数量
4. OQL → SQL 风格查询对象
```

**关键视图解读：**

```
# 视图 1：Leak Suspects（自动报告）
┌──────────────────────────────────────────────────┐
│  Leak Suspect #1                                  │
│  The class "com.example.CacheManager"             │
│  occupies 847MB (42%) of 2GB heap                 │
│  └── java.util.HashMap$Node[8192] × 1           │
│       └── key: String (class name)               │
│       └── value: Object[] (cached result)        │
│                                                      │
│  Reason: Cache never eviction → growing forever    │
└──────────────────────────────────────────────────┘

# 视图 2：Dominator Tree（Retained Heap 排序）
Class Name                     │ Shallow Heap │ Retained Heap
──────────────────────────────┼──────────────┼──────────────
char[] (String内部字符数组)    │    1.2MB     │    520MB      ← 大字符串
byte[][]                      │      890KB    │    310MB      ← 缓存数据
HashMap$Node[]                │      200KB    │    280MB      ← CacheManager.cache
LinkedHashMap$Entry          │      150KB    │    195MB      ← Session 管理
```

### Step 3：GC Roots 追踪引用链

在 MAT 中对着可疑对象右键 → **Path to GC Roots** → **excludes weak refs**：

```
查找引用链：
CacheManager.cache (HashMap)
  ↓ (key)
String "user:12345:profile"
  ↓ (value)
CachedUserProfile[]
  ↓ (reference)
UserService.userCache (static)

GC Roots：
  ↑ Thread Stack: main() → ApplicationContext → userService → ...
```

### Step 4：async-profiler 补充分析

在 MAT 之外，用 async-profiler 做 Allocation 分析（看谁在疯狂分配内存）：

```bash
# 采样 30 秒的内存分配
./async-profiler.sh profiler -d 30 \
    -e alloc \
    -f allocation-profile.html \
    <pid>

# 生成火焰图
./async-profiler.sh flames -d 30 \
    -e alloc \
    <pid> > flames.svg
```

```
Allocation 火焰图（SVG）片段：

┌─────────────────────────────────────────────┐
│  ██                                      │
│  ██ ██  ██████████                        │
│  ██ ██ ██ ████████ ████  ████████████    │  ← CacheManager.store() 分配最多
│  ██ ██ ██ ████████ ████  ████████████    │
│  ██ ██ ██ ████████ ████  ████████████    │
│  ██ ██ ██ ████████ ████  ████████████    │
│  ██ ██ ██ ████████ ████  ████████████    │
└─────────────────────────────────────────────┘
  main() → CacheManager.store() → CacheManager.rebuild()
```

### 定位到的根因

```
问题代码（简化）：

@Service
public class CacheManager {
    private static Map<String, Object> cache = new HashMap<>();

    public void store(String key, Object value) {
        // 不断往 HashMap 塞数据，从不清理
        cache.put(key, value);
    }
}
```

**引用链**：`CacheManager.cache`（static HashMap）→ 持有所有缓存对象 → 无法被 GC

### Step 5：修复方案

**方案 A：添加 LRU  eviction（最小改动）**

```java
@Service
public class CacheManager {
    // 使用 LinkedHashMap 实现 LRU，maxEntries = 10000
    private static final int MAX_ENTRIES = 10000;
    private static Map<String, Object> cache =
        new LinkedHashMap<String, Object>(MAX_ENTRIES, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry eldest) {
                return size() > MAX_ENTRIES;
            }
        };

    public void store(String key, Object value) {
        synchronized (cache) {
            cache.put(key, value);
        }
    }
}
```

**方案 B：Caffeine（推荐，性能更好）**

```java
@Service
public class CacheManager {
    private static Cache<String, Object> cache = Caffeine.newBuilder()
        .maximumSize(10_000)              // 最多 10000 条
        .expireAfterWrite(Duration.ofMinutes(30))  // 写入 30 分钟后过期
        .expireAfterAccess(Duration.ofMinutes(10)) // 10 分钟无访问则过期
        .recordStats()                    // 开启统计
        .build();

    public void store(String key, Object value) {
        cache.put(key, value);
    }

    // 监控缓存命中率
    public void logStats() {
        CacheStats stats = cache.stats();
        log.info("hitRate={}, evictions={}",
            stats.hitRate(), stats.evictionCount());
    }
}
```

### 修复后验证

```bash
# 重启后观察内存
jstat -gc <pid> 1000

# 修复后结果：
# heap 稳定在 500MB~800MB，GC 后回落，内存不再持续增长
```

## ThreadLocal 泄漏排查（另一个常见场景）

```java
// 典型泄漏代码
public class UserInterceptor extends HandlerInterceptorAdapter {
    private static final ThreadLocal<User> currentUser = new ThreadLocal<>();

    public boolean preHandle(HttpRequest request, ...) {
        currentUser.set(parseUser(request));  // ← 设置了但未清理
        return true;
    }
    // ❌ 缺少 afterCompletion() 中的 currentUser.remove()
}
```

**async-profiler 快速定位**：

```bash
# 找出 ThreadLocal.set() 调用最多的栈
./async-profiler.sh profiler -e ClassLoad \
    -f classload.html \
    -I '*ThreadLocal*' \
    <pid>
```

**修复**：

```java
@Override
public void afterCompletion(HttpRequest request, ...) {
    currentUser.remove();  // ← 无论成功失败都必须清理
}
```

## 排查工具一览

| 工具 | 用途 | 特点 |
|------|------|------|
| **MAT (Memory Analyzer)** | Heap Dump 分析 | Eclipse 插件，支持 Leak Suspect、Dominator Tree |
| **async-profiler** | CPU/Allocation 采样 | 无需修改代码，生产安全，生成火焰图 |
| **jmap + jhat** | Heap Dump + 快速分析 | JDK 内置，jhat 简易但功能有限 |
| **Java Mission Control (JMC)** | 实时 JMX 监控 | JDK 内置，记录 Flight Recording |
| **VisualVM** | 本地连接分析 | JDK 内置，轻量级 |

## 总结

- **Heap Dump 是关键**：OOM 时自动 dump，OOM 前手动 dump
- **MAT + GC Roots 追踪**是定位泄漏引用链最有效的方法
- **async-profiler** 无侵入，适合生产环境采样
- 修复方案首选**引入成熟缓存库**（Caffeine、Guava Cache）而非手写 eviction

下篇将介绍**JVM 性能调优实战**——结合具体业务场景的参数配置案例。
