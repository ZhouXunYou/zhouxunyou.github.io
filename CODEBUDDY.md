# CODEBUDDY.md

本文件为 CodeBuddy Code 在此仓库中工作时提供指导。

## 项目概述

基于 Jekyll 4.3 + Minima 2.5 主题构建的 GitHub 风格个人主页（完全重写主题）。部署在 GitHub Pages，地址为 `gwzz.xyz`。功能特性：深色/浅色主题切换、顶部分类导航、树形结构侧边栏、仓库卡片、活动时间轴、GitHub 风格的 Markdown 渲染。

## 命令

```bash
# 需要 Homebrew Ruby 4.0+（不是系统自带的 Ruby 2.6）
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"

# 安装依赖
bundle install

# 本地开发服务器
bundle exec jekyll serve

# 生产环境构建
bundle exec jekyll build
```

## CI/CD

- **GitHub Actions** (`.github/workflows/ci.yml`)：每次 push 到 main 和 PR 时自动运行
  - Jekyll 构建验证
  - 链接健康检查（lychee）
  - Lighthouse 性能监控
- **Lighthouse CI** (`lighthouserc.json`)：性能/无障碍/最佳实践/SEO 评分监控
- **链接检查**：使用 lychee，排除列表在 `.lycheeignore`

## 架构

### 布局结构

- **顶部导航栏**（`_includes/header.html`）：固定头部，包含分类标签页（Frontend/Backend/DevOps/About），数据来源于 `_data/navigation.yml`
- **左侧侧边栏**（`_includes/sidebar.html`）：个人资料信息 + 树形结构分类导航。显示与当前页面 `page.category` 匹配的分类；概览页面显示所有分类
- **主内容区**：通过布局模板渲染（`home`/`post`/`page`/`repo`）

### 关键目录

- **`_layouts/`**：`default.html`（网格布局：侧边栏+主内容）、`home.html`（置顶仓库/时间轴）、`post.html`（Issue 风格）、`page.html`、`repo.html`（文件列表+README）
- **`_includes/`**：`header.html`、`footer.html`、`sidebar.html`、`repo-card.html`、`timeline.html`、`theme-toggle.html`、`social-links.html`
- **`_sass/`**：`theme.scss`（用于浅色/深色主题的 CSS 自定义属性）、`minima/`（所有组件样式完全覆盖 Minima 默认样式）
- **`_data/`**：`categories.yml`（侧边栏树形结构）、`repos.yml`（仓库列表）、`navigation.yml`（顶部导航）、`timeline.yml`（活动时间轴数据）
- **`_projects/`**：Jekyll 集合，用于项目页面，每个 .md 文件代表一个项目（front matter 为元数据，内容为 README）
- **`assets/js/`**：`theme-toggle.js`（通过 localStorage 持久化深色/浅色主题）、`sidebar.js`（树形展开/折叠状态）

### 主题系统

- `_sass/theme.scss` 中的 CSS 自定义属性，通过 `<html>` 上的 `[data-theme="light/dark"]` 来区分
- `_includes/head.html` 中的内联脚本在渲染前从 localStorage 读取 `data-theme`（防止闪烁）
- GitHub 精确配色方案（浅色：`#ffffff` 背景，`#1f2328` 文字，`#0969da` 链接；深色：`#0d1117` 背景，`#e6edf3` 文字，`#58a6ff` 链接）
- 基础字号 14px（非 16px），以匹配 GitHub 的紧凑布局

### 页面-分类关联

页面在 front matter 中声明 `category: frontend`。侧边栏和顶部导航使用此属性来高亮当前分类并显示相关的子分类。

### 响应式断点

- 移动端（≤544px）：单列布局，汉堡菜单，侧边栏隐藏
- 平板（545-768px）：单列布局，汉堡菜单
- 桌面端（769px+）：双列网格布局，侧边栏可见
- 宽屏（≥1012px）：最大宽度 1280px

## 重要说明

- Ruby 4.0+ 需要在 Gemfile 中显式添加 `gem "logger"`、`gem "csv"`、`gem "base64"`（不再是默认 gems）
- Jekyll 4.3.3 对 Ruby 4.0 的兼容性有限；可能需要额外添加 gem
- `_site/` 目录被 gitignore 忽略；通过 GitHub Pages 从 `main` 分支构建部署
- CNAME 配置了自定义域名 `gwzz.xyz`

## CodeBuddy Added Memories
- 必须使用中文
