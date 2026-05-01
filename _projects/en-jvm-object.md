---
layout: page
title: "Object Creation & Memory Layout"
category: jvm-object
sidebar: true
lang: en
lang_alt: /jvm-object/
permalink: /en/jvm-object/
sort_order: 3
nav:
  prev: /en/jvm-memory/
  next: /en/jvm-gc-algorithms/
---

## Object Creation Process

When the JVM encounters a `new` instruction, object creation goes through the following steps:

```
new instruction
   │
   ▼
① Class loading check ──→ Class not loaded? ──→ Execute class loading
   │ Already loaded
   ▼
② Allocate memory
   │
   ├── Space is contiguous? ──→ Bump the Pointer
   │                           └── Use CAS for thread safety
   │
   └── Space is fragmented? ──→ Free List
                               └── Use CAS or TLAB for thread safety
   │
   ▼
③ Initialize memory to zero
   │
   ▼
④ Set object header (Mark Word + Klass Pointer)
   │
   ▼
⑤ Execute <init> method (constructor)
```

### 1. Class Loading Check

The JVM first checks whether the `new` instruction's parameter can locate a symbolic reference to the class in the constant pool, and whether the class has been loaded, resolved, and initialized. If not loaded, the class loading process must be executed first.

### 2. Memory Allocation

After class loading, the JVM allocates memory in the heap based on the object size. The allocation method depends on whether the heap memory is contiguous:

- **Bump the Pointer**: When heap memory is perfectly contiguous, used and free memory are on each side with a pointer in between. Allocating memory means moving the pointer toward the free side by the object size
- **Free List**: When heap memory is fragmented, the JVM maintains a list recording which memory blocks are available, and finds a large enough space from the list during allocation

The allocation method depends on whether the GC collector has compaction capability:
- Serial, ParNew, G1, ZGC (with compaction) → Bump the Pointer
- CMS (mark-sweep) → Free List

### 3. Concurrent Safety

Object creation is very frequent in the JVM, requiring thread safety:

- **CAS + retry on failure**: Atomic operation for allocation actions
- **TLAB (Thread Local Allocation Buffer)**: Each thread pre-allocates a small private buffer in Eden; threads allocate within their own TLAB, and use CAS to apply for a new TLAB when exhausted

```bash
# TLAB-related parameters
-XX:+UseTLAB              # Enable TLAB (default: on)
-XX:TLABSize=256k         # TLAB size
-XX:+PrintTLAB            # Print TLAB information
```

### 4. Memory Initialization to Zero

After memory allocation, the JVM initializes the allocated memory space to zero (excluding the object header). This ensures that object instance fields can be used without explicit initialization:

```java
// No NPE or undefined behavior occurs
int count;        // Automatically initialized to 0
boolean flag;     // Automatically initialized to false
Object ref;       // Automatically initialized to null
```

### 5. Set Object Header

After zero initialization, the JVM sets the object header information, including:
- Which class the object is an instance of
- How to find the class metadata
- The object's GC age
- Lock state information

### 6. Execute Constructor

From the JVM's perspective, the `<init>` method (constructor) hasn't started yet. From the programmer's perspective, initialization truly begins after the `new` keyword.

## Object Memory Layout

In HotSpot, the object's memory layout is divided into three areas: **Header**, **Instance Data**, and **Padding**.

```
┌─────────────────────────────────────┐
│           Object Header              │
│  ┌────────────────────────────────┐ │
│  │  Mark Word (32/64 bit)        │ │
│  │  - Hash code, GC age, lock    │ │
│  ├────────────────────────────────┤ │
│  │  Klass Pointer (32/64 bit)    │ │
│  │  - Pointer to class metadata  │ │
│  ├────────────────────────────────┤ │
│  │  Array Length (optional)      │ │
│  │  - Only for array objects     │ │
│  └────────────────────────────────┘ │
├─────────────────────────────────────┤
│        Instance Data                 │
│  - Fields inherited from parent      │
│  - Fields defined in this class      │
├─────────────────────────────────────┤
│           Padding                    │
│  - Ensure object size is multiple    │
│    of 8 bytes                        │
└─────────────────────────────────────┘
```

### Mark Word

The Mark Word stores the object's own runtime data, with lengths of 32 bits and 64 bits in 32-bit and 64-bit JVMs respectively. It is key to implementing lightweight locks and biased locking.

**64-bit JVM Mark Word Layout:**

| Storage Content | Flag Bits | State |
|----------------|-----------|-------|
| Object hash code, GC generational age | 01 | Unlocked |
| Pointer to lock record | 00 | Lightweight lock |
| Pointer to heavyweight lock | 10 | Heavyweight lock (mutex) |
| Empty | 11 | GC mark |
| Biased thread ID, biased timestamp, GC generational age | 01 | Biased lock |

### Klass Pointer

The Klass Pointer points to the object's type metadata (InstanceKlass). The JVM uses this pointer to determine which class the object belongs to. With compressed pointers enabled, it occupies 4 bytes; otherwise, 8 bytes.

### Array Length

Only array objects have this field, recording the array length. The JVM can determine the size of regular objects through their metadata, but not arrays.

### Instance Data

Instance data is the actual effective information stored in the object — the various field contents defined in the code, including those inherited from parent classes and defined in the current class.

**Field storage order** is influenced by the `-XX:FieldsAllocationStyle` parameter. Default strategy:
1. First store primitive types (long/double > int/float > short/char > byte/boolean)
2. Then store reference types

Parent class fields appear before child class fields. The CompactFields parameter (enabled by default) inserts smaller fields into gaps between parent class fields.

### Padding

HotSpot requires object size to be a multiple of 8 bytes. The object header is already a multiple of 8 bytes (64-bit JVM with compression enabled), so when instance data is not a multiple of 8, padding is needed.

## Compressed Oops

### Why Compressed Oops Are Needed

In a 64-bit JVM, object references occupy 8 bytes, compared to 4 bytes in 32-bit, increasing memory consumption by approximately 1.5 times. More memory means:
- Increased GC workload
- Reduced cache hit rate
- Increased memory bandwidth pressure

### Compression Principle

Compressed Oops compress 64-bit object references into 32 bits:

```
On store: reference = (actual address - heap base address) >> 3
On use:   actual address = heap base address + (reference << 3)
```

Leveraging the 8-byte alignment property of objects, the lower 3 bits are always 0 and don't need to be stored. Therefore, 32-bit references can address 2^32 × 8 = 32GB of heap space.

### Enabling Conditions

- Enabled by default when heap size < 32GB
- Automatically disabled when heap size ≥ 32GB (32-bit references cannot address the entire heap)
- Can be explicitly enabled via `-XX:+UseCompressedOops` (on by default)
- Combined with `-XX:+UseCompressedClassPointers` to compress Klass Pointer

```bash
# Check compressed pointer status
java -XX:+PrintFlagsFinal -version | grep Compressed
```

### Object Size Calculation

On a 64-bit JVM with compressed pointers enabled:

```java
// A simple object
class Simple {
    int id;         // 4 bytes
}
// Object header: Mark Word(8) + Klass Pointer(4) = 12 bytes
// Instance data: int(4) = 4 bytes
// Padding: 0 bytes (12 + 4 = 16, already aligned)
// Total: 16 bytes

// Object with reference
class WithRef {
    int id;         // 4 bytes
    Object ref;     // 4 bytes (compressed pointer)
}
// Object header: 12 bytes
// Instance data: 4 + 4 = 8 bytes
// Padding: 0 bytes
// Total: 20 → aligned to 24 bytes (4 bytes padding)
```

## Object Access

The JVM operates on specific objects on the heap through reference data on the stack. The reference type in the specification only specifies a reference pointing to an object. There are two mainstream access methods:

### Handle Access

```
reference → ┌──────────────┐
            │  Handle Pool  │
            │ ┌──────────┐ │     ┌────────────────┐
            │ │Instance  ├─┼────→│ Heap Object     │
            │ │data ptr  │ │     │ Instance        │
            │ ├──────────┤ │     └────────────────┘
            │ │Type data ├─┼─┐   ┌────────────────┐
            │ │pointer   │ │ └──→│ Method Area     │
            │ └──────────┘ │     │ Type Data       │
            └──────────────┘     └────────────────┘
```

- Advantage: The reference stores a stable handle address; when objects are moved (during GC), only the instance data pointer in the handle needs to be updated
- Disadvantage: One additional level of indirection overhead

### Direct Pointer Access

```
reference → ┌────────────────┐     ┌────────────────┐
            │ Heap Object     │────→│ Method Area     │
            │ Instance        │     │ Type Data       │
            └────────────────┘     └────────────────┘
```

- Advantage: Fast, one less level of indirection
- Disadvantage: When objects are moved, the reference itself needs to be updated

**HotSpot uses direct pointer access** because object access is extremely frequent, and eliminating one level of indirection is significant. The GC is responsible for updating references when objects are moved.

## Summary

This chapter analyzed object creation and memory layout in the JVM. Understanding the Mark Word structure is the foundation for mastering Java lock mechanisms; understanding compressed oops helps optimize memory usage; understanding object access methods helps understand GC's impact on applications. The next chapter will cover garbage collection algorithms.
