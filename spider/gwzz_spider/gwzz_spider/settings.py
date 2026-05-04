# Scrapy settings for gwzz_spider project

BOT_NAME = "gwzz_spider"

SPIDER_MODULES = ["gwzz_spider.spiders"]
NEWSPIDER_MODULE = "gwzz_spider.spiders"

# User-Agent
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

# Obey robots.txt rules
ROBOTSTXT_OBEY = True

# Concurrent requests
CONCURRENT_REQUESTS = 8
CONCURRENT_REQUESTS_PER_DOMAIN = 4

# Download delay (seconds)
DOWNLOAD_DELAY = 1
RANDOMIZE_DOWNLOAD_DELAY = True

# Default request headers
DEFAULT_REQUEST_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# Enable pipelines
ITEM_PIPELINES = {
    "gwzz_spider.pipelines.DedupPipeline": 100,
    "gwzz_spider.pipelines.JsonPipeline": 300,
}

# AutoThrottle
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 2
AUTOTHROTTLE_MAX_DELAY = 30
AUTOTHROTTLE_TARGET_CONCURRENCY = 2.0

# Retry
RETRY_ENABLED = True
RETRY_TIMES = 3
RETRY_HTTP_CODES = [500, 502, 503, 504, 408, 429]

# Timeout
DOWNLOAD_TIMEOUT = 30

# HTTP Cache (development)
# HTTPCACHE_ENABLED = True
# HTTPCACHE_EXPIRATION_SECS = 86400
# HTTPCACHE_DIR = "httpcache"

# Logging
LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"

# Feed export encoding
FEED_EXPORT_ENCODING = "utf-8"

# Request fingerprinter
REQUEST_FINGERPRINTER_IMPLEMENTATION = "2.7"
TWISTED_REACTOR = "twisted.internet.asyncioreactor.AsyncioSelectorReactor"
