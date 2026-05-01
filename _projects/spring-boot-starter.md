---
layout: repo
title: "spring-boot-starter"
description: "A Spring Boot starter kit with best practices and auto-configuration"
language: "Java"
language_color: "#b07219"
stars: 56
forks: 12
category: java
pinned: true
license: "Apache-2.0"
files:
  - name: "src/"
    type: dir
  - name: "src/main/java/"
    type: dir
  - name: "src/main/resources/"
    type: dir
  - name: "src/test/java/"
    type: dir
  - name: "README.md"
    type: file
  - name: "pom.xml"
    type: file
  - name: "LICENSE"
    type: file
---

# spring-boot-starter

A Spring Boot starter kit with best practices, auto-configuration, and production-ready defaults.

## Features

- Auto-configuration for common Spring Boot components
- Production-ready health checks and metrics
- Pre-configured security settings
- Docker support out of the box
- Structured logging with SLF4J + Logback

## Requirements

- Java 17+
- Maven 3.8+

## Quick Start

```bash
git clone https://github.com/zhouxunyou/spring-boot-starter.git
cd spring-boot-starter
./mvnw spring-boot:run
```

## Configuration

```yaml
# application.yml
server:
  port: 8080

spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    username: ${DB_USER}
    password: ${DB_PASS}

management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
```

## API Example

```java
@RestController
@RequestMapping("/api/v1")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @GetMapping("/users/{id}")
    public ResponseEntity<User> getUser(@PathVariable Long id) {
        return userService.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/users")
    public ResponseEntity<User> createUser(@Valid @RequestBody CreateUserRequest request) {
        User created = userService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }
}
```

## License

Apache-2.0
