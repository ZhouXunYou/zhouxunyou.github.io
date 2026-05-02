---
layout: page
title: "Go Web Development in Practice"
category: backend-golang-web
sidebar: true
lang: en
lang_alt: /backend-golang-web/
permalink: /en/backend-golang-web/
sort_order: 7
nav:
  prev: /en/backend-go/
  next: /en/backend-microservice/
---

## net/http Standard Library

Go's `net/http` standard library is sufficient for building production-grade web services; no framework is required:

```go
func main() {
    mux := http.NewServeMux()

    // Go 1.22 enhanced routing: supports method matching and path parameters
    mux.HandleFunc("GET /users/{id}", getUser)
    mux.HandleFunc("POST /users", createUser)
    mux.HandleFunc("DELETE /users/{id}", deleteUser)

    server := &http.Server{
        Addr:         ":8080",
        Handler:      mux,
        ReadTimeout:  5 * time.Second,
        WriteTimeout: 10 * time.Second,
        IdleTimeout:  120 * time.Second,
    }
    log.Fatal(server.ListenAndServe())
}

func getUser(w http.ResponseWriter, r *http.Request) {
    id := r.PathValue("id")  // Go 1.22+
    json.NewEncoder(w).Encode(map[string]string{"id": id})
}
```

### Middleware Pattern

```go
// Chain middleware calls
func Chain(h http.Handler, middleware ...func(http.Handler) http.Handler) http.Handler {
    for i := len(middleware) - 1; i >= 0; i-- {
        h = middleware[i](h)
    }
    return h
}

// Logging middleware
func Logging(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()
        next.ServeHTTP(w, r)
        log.Printf("%s %s %v", r.Method, r.URL.Path, time.Since(start))
    })
}

// Auth middleware
func Auth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            http.Error(w, "Unauthorized", http.StatusUnauthorized)
            return
        }
        ctx := context.WithValue(r.Context(), "userID", parseToken(token))
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

## Gin/Echo Frameworks

The standard library is suitable for simple services; frameworks provide convenient features like route grouping, parameter binding, and validation.

### Gin Example

```go
func main() {
    r := gin.Default()  // Logger + Recovery middleware

    // Route grouping
    api := r.Group("/api/v1")
    {
        users := api.Group("/users")
        {
            users.GET("", listUsers)
            users.GET("/:id", getUser)
            users.POST("", createUser)
            users.PUT("/:id", updateUser)
            users.DELETE("/:id", deleteUser)
        }
    }

    r.Run(":8080")
}

type CreateUserReq struct {
    Name  string `json:"name" binding:"required,min=2,max=50"`
    Email string `json:"email" binding:"required,email"`
    Age   int    `json:"age" binding:"omitempty,gte=0,lte=150"`
}

func createUser(c *gin.Context) {
    var req CreateUserReq
    if err := c.ShouldBindJSON(&req); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }
    // Process business logic...
    c.JSON(http.StatusCreated, gin.H{"id": "usr_123", "name": req.Name})
}
```

## Database Interaction

### GORM

GORM is the most popular ORM in the Go ecosystem, providing model definition, associations, migrations, and more:

```go
type User struct {
    ID        uint           `gorm:"primaryKey" json:"id"`
    Name      string         `gorm:"size:100;not null" json:"name"`
    Email     string         `gorm:"uniqueIndex;size:255" json:"email"`
    Orders    []Order        `gorm:"foreignKey:UserID" json:"orders,omitempty"`
    CreatedAt time.Time      `json:"created_at"`
    UpdatedAt time.Time      `json:"updated_at"`
    DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`  // Soft delete
}

func setupDB() *gorm.DB {
    dsn := "user:pass@tcp(localhost:3306)/mydb?charset=utf8mb4&parseTime=True"
    db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
    if err != nil {
        log.Fatal(err)
    }
    db.AutoMigrate(&User{}, &Order{})
    return db
}

// Query example
func getUserWithOrders(db *gorm.DB, id uint) (*User, error) {
    var user User
    err := db.Preload("Orders", "status = ?", "active").
        First(&user, id).Error
    return &user, err
}
```

### sqlx

When you need finer SQL control, sqlx is a better choice:

```go
type User struct {
    ID    int    `db:"id"`
    Name  string `db:"name"`
    Email string `db:"email"`
}

func getUsers(db *sqlx.DB) ([]User, error) {
    users := []User{}
    err := db.Select(&users, "SELECT id, name, email FROM users WHERE status = ?", "active")
    return users, err
}

func getUserByID(db *sqlx.DB, id int) (*User, error) {
    var user User
    err := db.Get(&user, "SELECT id, name, email FROM users WHERE id = ?", id)
    return &user, err
}

// Named parameters
func createUser(db *sqlx.DB, user *User) error {
    _, err := db.NamedExec(
        "INSERT INTO users (name, email) VALUES (:name, :email)",
        user,
    )
    return err
}
```

## Clean Architecture in Practice

Clean Architecture divides an application into concentric layers, with dependencies only flowing from outside to inside:

```mermaid
graph TD
    subgraph "Clean Architecture"
        E["Entities<br/>Business entities & rules<br/>Innermost layer, no dependencies"]
        U["Use Cases<br/>Business use cases/service layer"]
        IA["Interface Adapters<br/>Controllers, gateways, presenters"]
        FW["Frameworks & Drivers<br/>Web, DB, external services"]
    end
    FW --> IA --> U --> E
```

### Go Project Structure

```
project/
├── cmd/
│   └── server/
│       └── main.go          # Entry point
├── internal/
│   ├── domain/              # Entity layer: business models
│   │   ├── user.go
│   │   └── order.go
│   ├── usecase/             # Use case layer: business logic
│   │   ├── user_service.go
│   │   └── order_service.go
│   ├── repository/          # Interface adapter layer: repository interfaces
│   │   └── user_repository.go
│   ├── handler/             # Interface adapter layer: HTTP handlers
│   │   └── user_handler.go
│   └── infrastructure/      # Framework layer: concrete implementations
│       ├── mysql/
│       │   └── user_repo_impl.go
│       └── redis/
│           └── cache.go
├── pkg/                     # Reusable public packages
└── go.mod
```

### Dependency Inversion Implementation

```go
// domain/user.go — Entity layer, no external dependencies
type User struct {
    ID    string
    Name  string
    Email string
}

// repository/user_repository.go — Define interface (needed by use case layer)
type UserRepository interface {
    FindByID(ctx context.Context, id string) (*User, error)
    Save(ctx context.Context, user *User) error
}

// usecase/user_service.go — Use case layer, depends on interface
type UserService struct {
    repo repository.UserRepository
}

func NewUserService(repo repository.UserRepository) *UserService {
    return &UserService{repo: repo}
}

func (s *UserService) GetUser(ctx context.Context, id string) (*User, error) {
    return s.repo.FindByID(ctx, id)
}

// infrastructure/mysql/user_repo_impl.go — Framework layer, implements interface
type mysqlUserRepo struct {
    db *sqlx.DB
}

func NewMysqlUserRepo(db *sqlx.DB) repository.UserRepository {
    return &mysqlUserRepo{db: db}
}
```

## Graceful Shutdown

Production environments must implement graceful shutdown—stop accepting new requests and wait for in-flight requests to complete before exiting:

```go
func main() {
    server := &http.Server{Addr: ":8080", Handler: setupRouter()}

    // Start server
    go func() {
        if err := server.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatalf("Server error: %v", err)
        }
    }()

    // Wait for interrupt signal
    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit
    log.Println("Shutting down server...")

    // Give in-flight requests 15 seconds to complete
    ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
    defer cancel()

    if err := server.Shutdown(ctx); err != nil {
        log.Printf("Server forced to shutdown: %v", err)
    }
    log.Println("Server exited gracefully")
}
```

Graceful shutdown flow:

```mermaid
sequenceDiagram
    participant OS as Operating System
    participant App as Application
    participant Server as HTTP Server

    OS->>App: SIGTERM
    App->>Server: Shutdown(ctx)
    Note over Server: Stop accepting new connections<br/>Wait for in-flight requests to complete
    Server-->>App: All requests completed / Timeout
    App->>App: Close database connections<br/>Flush buffers
    App->>OS: Exit 0
```

The core philosophy of Go web development: standard library first, introduce frameworks as needed; dependency inversion ensures testability; graceful shutdown ensures production stability.
