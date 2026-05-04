import json
import os
import re
from datetime import datetime
from itemadapter import ItemAdapter


class JsonPipeline:
    """将结果保存为 JSON 文件"""

    def open_spider(self, spider):
        output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "output")
        os.makedirs(output_dir, exist_ok=True)
        filename = f"{spider.name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        self.file = open(os.path.join(output_dir, filename), "w", encoding="utf-8")
        self.file.write("[\n")
        self.first = True

    def close_spider(self, spider):
        self.file.write("\n]")
        self.file.close()

    def process_item(self, item, spider):
        adapter = ItemAdapter(item)
        if not self.first:
            self.file.write(",\n")
        self.first = False
        line = json.dumps(dict(adapter), ensure_ascii=False, indent=2)
        self.file.write(line)
        return item


class DedupPipeline:
    """基于 URL 去重"""

    def __init__(self):
        self.seen = set()

    def process_item(self, item, spider):
        adapter = ItemAdapter(item)
        url = adapter.get("url")
        if url in self.seen:
            spider.logger.debug(f"Duplicate URL skipped: {url}")
            raise scrapy.exceptions.DropItem(f"Duplicate item: {url}")
        self.seen.add(url)
        return item


class ImageLocalizePipeline:
    """将 content 中的远程图片 URL 替换为本地下载路径"""

    def process_item(self, item, spider):
        adapter = ItemAdapter(item)
        content = adapter.get("content", "")
        images = adapter.get("images", [])

        for img_info in images:
            original_url = img_info.get("url", "")
            local_path = img_info.get("path", "")
            if original_url and local_path:
                # 替换 content 中的远程 URL 为本地相对路径
                local_rel = os.path.join("images", local_path)
                content = content.replace(original_url, local_rel)

        adapter["content"] = content
        return item
