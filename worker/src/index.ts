import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  LINKS_KV: KVNamespace
  ADMIN_TOKEN: string
  SITE_DOMAIN: string
}

const app = new Hono<{ Bindings: Bindings }>()

// CORS - 允许站点域名访问
app.use('/api/*', async (c, next) => {
  await next()
  c.header('Access-Control-Allow-Origin', `https://${c.env.SITE_DOMAIN}`)
  c.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
})

app.options('/api/*', (c) => c.text('', 204))

// GET /api/links/:slug - 获取某个资源的链接
// 前端在广告倒计时结束后调用此接口
// 返回一个未使用的链接，并在 KV 中标记为已使用
app.get('/api/links/:slug', async (c) => {
  const slug = c.req.param('slug')
  const kv = c.env.LINKS_KV

  // 获取该 slug 下的所有链接
  const list = await kv.list({ prefix: `link:${slug}:` })

  if (list.keys.length === 0) {
    return c.json({ error: '暂无可用链接' }, 404)
  }

  // 找到第一个未使用的链接（从 value JSON 中读取状态，不依赖 metadata）
  for (const key of list.keys) {
    const data = await kv.get<{ url: string; password: string | null; used: boolean; usedAt: string | null }>(key.name, 'json')
    if (data && !data.used) {
      // 标记为已使用 - 将状态存在 value 本身中
      await kv.put(key.name, JSON.stringify({
        ...data,
        used: true,
        usedAt: new Date().toISOString()
      }))
      return c.json({
        url: data.url,
        password: data.password || null
      })
    }
  }

  return c.json({ error: '链接已用完' }, 404)
})

// POST /api/links - 管理员添加链接
// 需要 Authorization: Bearer <token>
// Body: { slug: string, links: [{ url: string, password?: string }] }
app.post('/api/links', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ error: '未授权' }, 401)
  }

  const body = await c.req.json()
  const { slug, links } = body

  if (!slug || !links || !Array.isArray(links)) {
    return c.json({ error: '参数错误' }, 400)
  }

  const kv = c.env.LINKS_KV
  let added = 0

  for (const link of links) {
    const id = crypto.randomUUID()
    const key = `link:${slug}:${id}`
    await kv.put(key, JSON.stringify({
      url: link.url,
      password: link.password || null,
      used: false,
      usedAt: null
    }))
    added++
  }

  return c.json({ success: true, added })
})

// GET /api/links/:slug/status - 管理员查看链接状态
app.get('/api/links/:slug/status', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ error: '未授权' }, 401)
  }

  const slug = c.req.param('slug')
  const kv = c.env.LINKS_KV
  const list = await kv.list({ prefix: `link:${slug}:` })

  const links = []
  let available = 0
  let used = 0

  for (const key of list.keys) {
    const data = await kv.get<{ url: string; password: string | null; used: boolean; usedAt: string | null }>(key.name, 'json')
    const isUsed = data?.used ?? false
    if (isUsed) used++
    else available++
    links.push({
      id: key.name,
      url: data?.url,
      password: data?.password,
      used: isUsed,
      usedAt: data?.usedAt || null
    })
  }

  return c.json({ slug, total: list.keys.length, available, used, links })
})

// DELETE /api/links/:slug - 管理员清空某 slug 的所有链接
app.delete('/api/links/:slug', async (c) => {
  const auth = c.req.header('Authorization')
  if (!auth || auth !== `Bearer ${c.env.ADMIN_TOKEN}`) {
    return c.json({ error: '未授权' }, 401)
  }

  const slug = c.req.param('slug')
  const kv = c.env.LINKS_KV
  const list = await kv.list({ prefix: `link:${slug}:` })

  for (const key of list.keys) {
    await kv.delete(key.name)
  }

  return c.json({ success: true, deleted: list.keys.length })
})

export default app
