# GWZZ Spider

基于 Scrapy 的通用爬虫项目。

## 安装

```bash
pip install -r requirements.txt
```

## 使用

### 通用爬虫

```bash
# 基本用法 - 爬取指定页面
scrapy crawl generic -a url=https://example.com

# 指定内容选择器和最大页数
scrapy crawl generic -a url=https://example.com -a css_select='article .content' -a max_pages=10
```

### 参数说明

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| url | 是 | - | 起始 URL |
| css_select | 否 | `article` | 文章内容 CSS 选择器 |
| link_select | 否 | `a[href]` | 页面内链接 CSS 选择器 |
| max_pages | 否 | `0` | 最大爬取页数，0 不限制 |

### 输出

结果保存在 `output/` 目录下，格式为 JSON，文件名包含爬虫名和时间戳。

## 项目结构

```
gwzz_spider/
├── scrapy.cfg
├── requirements.txt
├── output/              # 爬取结果输出目录
├── gwzz_spider/
│   ├── items.py         # 数据模型
│   ├── middlewares.py   # 中间件
│   ├── pipelines.py     # 数据管道（JSON 导出 + URL 去重）
│   ├── settings.py      # 全局配置
│   └── spiders/
│       └── generic.py   # 通用爬虫
```
