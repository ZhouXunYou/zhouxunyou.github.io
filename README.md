# 格物致知

基于 Jekyll 4.3 构建的 GitHub 风格个人知识库，部署在 [gwzz.xyz](https://gwzz.xyz)。

## 特性

- **GitHub 风格 UI** — 精确复刻 GitHub 配色与布局（浅色/深色主题切换，防闪烁）
- **中英双语** — 全站 i18n 支持，49 篇中文 + 49 篇英文项目文档
- **知识体系** — 4 大领域（Frontend / Backend / JVM / DevOps），树形分类导航
- **全站搜索** — 基于预构建 JSON 索引的即时搜索
- **响应式** — 4 个断点适配移动端到宽屏

## 技术栈

- Jekyll 4.3 + Minima 2.5（完全重写主题）
- SCSS + CSS 自定义属性实现主题系统
- 纯 Liquid 模板实现 i18n（无插件依赖）
- GitHub Pages 部署，自定义域名 `gwzz.xyz`

## 项目结构

```
├── _config.yml          # 站点配置
├── _data/               # 数据文件
│   ├── categories.yml   # 分类树形结构
│   ├── navigation.yml   # 顶部导航
│   ├── strings.yml      # 英文 i18n 字符串
│   └── strings_zh.yml   # 中文 i18n 字符串
├── _layouts/            # 布局模板
│   ├── default.html     # 基础网格（侧边栏 + 主内容）
│   ├── home.html        # 首页
│   ├── category.html    # 分类概览
│   ├── page.html        # 通用页面（含章节导航）
│   ├── post.html        # 博客文章
│   └── repo.html        # 项目仓库页
├── _includes/           # 可复用组件
│   ├── header.html      # 顶部导航栏
│   ├── sidebar.html     # 树形分类侧边栏
│   ├── i18n.html        # i18n 变量初始化
│   ├── lang-switch.html # 语言切换
│   ├── search-modal.html
│   └── home/            # 首页组件（hero/domains/featured/changelog）
├── _projects/           # 项目文档集合（98 篇，中英各半）
├── _posts/              # 博客文章
├── _sass/               # 样式源文件
│   ├── theme.scss       # 主题变量（CSS 自定义属性）
│   └── minima/          # 组件样式（完全覆盖 Minima 默认）
└── assets/
    ├── js/              # theme-toggle / sidebar / search
    └── images/          # favicon / apple-touch-icon
```

## 知识领域

| 领域 | 子分类 | 篇数 |
|------|--------|------|
| Frontend | Web 基础 / 现代框架 / 工程化实践 / 进阶专题 | 13 |
| Backend | 服务端基础 / 语言与运行时 / 架构设计 / 安全与性能 | 13 |
| JVM | 基础原理 / 垃圾回收 / 监控诊断 / 调优实战 | 10 |
| DevOps | 容器基础 / 容器编排 / CI&CD 流水线 / 基础设施与监控 | 13 |

## 本地开发

需要 Homebrew Ruby 4.0+（非系统自带 Ruby 2.6）：

```bash
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
bundle install
bundle exec jekyll serve
```

## i18n 方案

不依赖 Jekyll 插件，纯 front matter + 数据文件 + Liquid 模板实现：

- 页面通过 `lang` 标识语言，`lang_alt` 指向另一语言版本 URL
- `_data/strings.yml`（英文）和 `_data/strings_zh.yml`（中文）存储 UI 文案
- 布局中引入 `_includes/i18n.html` 获取 `strings` 和 `page_lang` 变量
- 英文页面 URL 统一 `/en/` 前缀，项目文件以 `en-` 前缀命名

## 主题系统

基于 CSS 自定义属性的双主题方案，配色精确匹配 GitHub：

| | 浅色 | 深色 |
|---|---|---|
| 背景 | `#ffffff` | `#0d1117` |
| 文字 | `#1f2328` | `#e6edf3` |
| 链接 | `#0969da` | `#58a6ff` |

- `<head>` 内联脚本从 localStorage 读取 `data-theme`，防止首次加载闪烁
- 基础字号 14px，匹配 GitHub 紧凑布局

## License

MIT
