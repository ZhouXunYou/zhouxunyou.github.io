"""
通用文章爬虫模板

使用方法：
    scrapy crawl generic -a url=https://example.com -a css_select='article .content'

参数：
    url          - 起始 URL（必填）
    css_select   - 文章内容 CSS 选择器（默认 'article'）
    link_select  - 页面内链接 CSS 选择器（默认 'a[href]'）
    max_pages    - 最大翻页数（默认 0，不限制）
"""

from datetime import datetime
import scrapy
from gwzz_spider.items import ArticleItem


class GenericSpider(scrapy.Spider):
    name = "generic"
    allowed_domains = []

    def __init__(self, url="", css_select="article", link_select="a[href]", max_pages="0", *args, **kwargs):
        super().__init__(*args, **kwargs)
        if not url:
            raise ValueError("必须提供 -a url= 参数")
        self.start_urls = [url]
        self.css_select = css_select
        self.link_select = link_select
        self.max_pages = int(max_pages)
        self.page_count = 0

        # 自动提取域名限制
        from urllib.parse import urlparse
        parsed = urlparse(url)
        self.allowed_domains = [parsed.netloc]

    def parse(self, response):
        self.page_count += 1

        # 提取文章内容
        content_parts = response.css(self.css_select).getall()
        if content_parts:
            item = ArticleItem()
            item["title"] = response.css("title::text").get("").strip()
            item["url"] = response.url
            item["author"] = response.css('meta[name="author"]::attr(content)').get("")
            item["publish_time"] = response.css('meta[property="article:published_time"]::attr(content)').get(
                response.css("time::attr(datetime)").get("")
            )
            item["content"] = " ".join(content_parts)
            item["summary"] = response.css('meta[name="description"]::attr(content)').get("")
            item["tags"] = response.css('meta[name="keywords"]::attr(content)').get("")
            item["crawl_time"] = datetime.now().isoformat()
            yield item

        # 跟踪页面内链接
        if self.max_pages == 0 or self.page_count < self.max_pages:
            for link in response.css(f"{self.link_select}::attr(href)").getall():
                yield response.follow(link, callback=self.parse)
