---
layout: repo
title: "scala-fp-toolkit"
description: "Functional programming toolkit for Scala with Typelevel stack"
language: "Scala"
language_color: "#c22d40"
stars: 21
forks: 4
category: scala
pinned: true
license: "MIT"
files:
  - name: "src/"
    type: dir
  - name: "src/main/scala/"
    type: dir
  - name: "src/test/scala/"
    type: dir
  - name: "README.md"
    type: file
  - name: "build.sbt"
    type: file
  - name: "project/"
    type: dir
  - name: "LICENSE"
    type: file
---

# scala-fp-toolkit

Functional programming toolkit for Scala built on the Typelevel stack (Cats, Cats Effect, FS2).

## Features

- Tagless final pattern helpers
- Resource management utilities
- Stream processing with FS2 extensions
- Typeclass derivation boilerplate reduction
- HTTP client wrapper with Cats Effect

## Installation

```scala
// build.sbt
libraryDependencies += "com.github.zhouxunyou" %% "fp-toolkit" % "2.0.0"
```

## Usage

### Tagless Final Repository

```scala
trait UserRepository[F[_]] {
  def findById(id: UserId): F[Option[User]]
  def save(user: User): F[User]
}

object UserRepository {
  def impl[F[_]: MonadCancelThrow](repo: DoobieRepository): UserRepository[F] =
    new UserRepository[F] {
      def findById(id: UserId): F[Option[User]] =
        repo.query[User].option(id.value)

      def save(user: User): F[User] =
        repo.update(user).as(user)
    }
}
```

### FS2 Stream Processing

```scala
val pipeline: Stream[IO, AggregatedResult] =
  Stream.emits(events)
    .through(decode[Event])
    .through(filterValid)
    .through(groupByWindow(1.minute))
    .through(aggregate)
    .through(persistResults)
```

## License

MIT
