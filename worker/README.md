# gwzz-link-gate

Cloudflare Worker，实现"广告展示后获取链接"功能。前端在广告倒计时结束后调用 API 获取一个未使用的链接，链接一次性消费，用完即标记。

## 部署步骤

### 1. 创建 KV 命名空间

```bash
npx wrangler kv:namespace create "LINKS_KV"
```

将输出的 `id` 填入 `wrangler.toml` 中的 `YOUR_KV_NAMESPACE_ID`。

### 2. 配置 wrangler.toml

- `YOUR_KV_NAMESPACE_ID` — 替换为上一步创建的 KV 命名空间 ID
- `YOUR_ADMIN_TOKEN` — 替换为自定义的管理员密钥

### 3. 安装依赖 & 部署

```bash
cd worker
npm install
npm run deploy
```

## API 文档

所有接口路径以 `/api` 开头，CORS 仅允许 `https://gwzz.xyz` 访问。

### 获取链接

```
GET /api/links/:slug
```

返回一个未使用的链接并标记为已使用。

**响应示例：**

```json
{ "url": "https://example.com/resource", "password": "abc123" }
```

**错误响应：**

- `404` — 暂无可用链接 / 链接已用完

### 添加链接（管理员）

```
POST /api/links
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

**请求体：**

```json
{
  "slug": "my-resource",
  "links": [
    { "url": "https://example.com/1", "password": "pass1" },
    { "url": "https://example.com/2" }
  ]
}
```

**响应：**

```json
{ "success": true, "added": 2 }
```

### 查看链接状态（管理员）

```
GET /api/links/:slug/status
Authorization: Bearer <ADMIN_TOKEN>
```

**响应：**

```json
{
  "slug": "my-resource",
  "total": 5,
  "available": 3,
  "used": 2,
  "links": [...]
}
```

### 清空链接（管理员）

```
DELETE /api/links/:slug
Authorization: Bearer <ADMIN_TOKEN>
```

**响应：**

```json
{ "success": true, "deleted": 5 }
```

## 管理员 curl 示例

### 添加链接

```bash
curl -X POST https://gwzz-link-gate.<your-subdomain>.workers.dev/api/links \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "premium-pack",
    "links": [
      { "url": "https://drive.google.com/file/d/xxx", "password": "abc123" },
      { "url": "https://drive.google.com/file/d/yyy", "password": "def456" },
      { "url": "https://drive.google.com/file/d/zzz" }
    ]
  }'
```

### 查看状态

```bash
curl https://gwzz-link-gate.<your-subdomain>.workers.dev/api/links/premium-pack/status \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 清空链接

```bash
curl -X DELETE https://gwzz-link-gate.<your-subdomain>.workers.dev/api/links/premium-pack \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```
