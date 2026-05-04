"""
DDKK.COM 文章爬虫

爬取 ddkk.com 的教程文章标题和内容，自动过滤开发工具激活类文章。

使用方法：
    # 爬取全站教程
    scrapy crawl ddkk

    # 只爬取特定分类
    scrapy crawl ddkk -a category=java/concurrency/2

    # 限制爬取文章数量
    scrapy crawl ddkk -a max_articles=50
"""

from datetime import datetime
from urllib.parse import urljoin
import scrapy
from gwzz_spider.items import ArticleItem

BASE_URL = "https://ddkk.com"

# 过滤关键词：开发工具激活相关
FILTER_KEYWORDS = ["pojie", "jihuo", "激活", "破解", "破解版"]

# 导航链接（非文章页）需要排除
NAV_PATHS = ["/zhuanlan/newtiku/", "/zhuanlan/share/"]


def should_filter(url, title=""):
    """判断是否应过滤该文章"""
    text = f"{url} {title}".lower()
    return any(kw in text for kw in FILTER_KEYWORDS)


def is_article_link(href):
    """判断是否是文章详情链接（/zhuanlan/xxx/yyy/n.html 格式）"""
    if "/zhuanlan/" not in href or not href.endswith(".html"):
        return False
    if any(nav in href for nav in NAV_PATHS):
        return False
    if href.endswith("/index.html"):
        return False
    return True


class DdkkSpider(scrapy.Spider):
    name = "ddkk"
    allowed_domains = ["ddkk.com"]
    start_urls = [BASE_URL]

    custom_settings = {
        "DOWNLOAD_TIMEOUT": 20,
        "ROBOTSTXT_OBEY": False,
        "DEPTH_LIMIT": 3,
    }

    def __init__(self, category="", max_articles="0", *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.max_articles = int(max_articles)
        self.article_count = 0

        if category:
            self.start_urls = [f"{BASE_URL}/category/{category}/index.html"]

    def parse(self, response):
        """首页/分类页：提取教程系列入口"""
        for link in response.css('a[href*="/category/"]'):
            href = link.attrib.get("href", "")
            title = link.css("h3::text").get("") or link.css("::text").get("")

            if should_filter(href, title):
                self.logger.info(f"跳过激活类: {title.strip()}")
                continue

            full_url = urljoin(BASE_URL, href)
            yield scrapy.Request(full_url, callback=self.parse_series)

    def parse_series(self, response):
        """教程系列页：提取文章链接"""
        for link in response.css('a[href*="/zhuanlan/"]'):
            href = link.attrib.get("href", "")
            title = link.css("::text").get("").strip()

            if not is_article_link(href):
                continue
            if should_filter(href, title):
                self.logger.info(f"跳过激活类文章: {title}")
                continue

            full_url = urljoin(BASE_URL, href)
            yield scrapy.Request(full_url, callback=self.parse_article)

    def parse_article(self, response):
        """文章详情页：提取标题和正文内容"""
        if self.max_articles > 0 and self.article_count >= self.max_articles:
            self.logger.info(f"已达到最大文章数 {self.max_articles}，停止爬取")
            return

        title = response.css("h1::text").get("").strip()
        if not title:
            return

        # 提取正文：从 .article-content 容器中提取
        article_content = response.css(".article-content")
        if not article_content:
            article_content = response

        content_parts = []
        for el in article_content.css("h2, h3, p, pre, ul, ol, table, img"):
            tag = el.root.tag
            if tag in ("h2", "h3"):
                prefix = "##" if tag == "h2" else "###"
                text = el.css("::text").getall()
                if text:
                    content_parts.append(f"\n{prefix} {''.join(text).strip()}\n")
            elif tag == "img":
                src = el.attrib.get("src", "")
                alt = el.attrib.get("alt", "")
                if src:
                    full_src = urljoin(BASE_URL, src)
                    content_parts.append(f"![{alt}]({full_src})")
            elif tag == "p":
                text = el.css("::text").getall()
                if text:
                    line = "".join(text).strip()
                    if line:
                        content_parts.append(line)
            elif tag == "pre":
                code = el.css("::text").getall()
                if code:
                    content_parts.append(f"\n```\n{''.join(code)}\n```\n")
            elif tag in ("ul", "ol"):
                for li in el.css("li"):
                    text = li.css("::text").getall()
                    if text:
                        content_parts.append(f"- {''.join(text).strip()}")
            elif tag == "table":
                rows = []
                for tr in el.css("tr"):
                    cells = [td.css("::text").get("").strip() for td in tr.css("td, th")]
                    rows.append(" | ".join(cells))
                if rows:
                    content_parts.append("\n" + "\n".join(rows) + "\n")

        content = "\n\n".join(p for p in content_parts if p)
        if not content:
            return

        # 提取元信息
        category = response.css('a[href*="/category/"]::text').get("").strip()
        keywords = response.css('meta[name="keywords"]::attr(content)').get("")
        description = response.css('meta[name="description"]::attr(content)').get("")

        item = ArticleItem()
        item["title"] = title
        item["url"] = response.url
        item["author"] = ""
        item["publish_time"] = ""
        item["content"] = content
        item["summary"] = description
        item["tags"] = f"{keywords}, {category}".strip(", ")
        item["crawl_time"] = datetime.now().isoformat()

        # 收集图片 URL 供 ImagesPipeline 下载
        image_urls = []
        for img in article_content.css("img"):
            src = img.attrib.get("src", "")
            if src:
                image_urls.append(urljoin(BASE_URL, src))
        item["image_urls"] = image_urls
        item["images"] = []

        self.article_count += 1
        self.logger.info(f"爬取文章 [{self.article_count}]: {title}")
        yield item
