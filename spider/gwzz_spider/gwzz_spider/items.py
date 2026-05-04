import scrapy


class ArticleItem(scrapy.Item):
    """通用文章/页面爬取 Item"""
    title = scrapy.Field()
    url = scrapy.Field()
    author = scrapy.Field()
    publish_time = scrapy.Field()
    content = scrapy.Field()
    summary = scrapy.Field()
    tags = scrapy.Field()
    crawl_time = scrapy.Field()
