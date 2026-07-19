# fzsm · 角色市场封面浏览

**线上：https://fzsm.vercel.app/**

## 功能

- 浏览器直连官方 `role_market.php` 列表
- **仅封面浏览**（搜索 / 排序 / 翻页）
- 无登录 / 无注册 / 无详情 / 无下载
- 页面刷新时自动读取 Vercel Blob 云端索引
- 「同步索引」由浏览器拉取最新角色，再交给服务端生成封面特征并写入 Blob
- 以图搜图使用 aHash、dHash 与亮度轮廓特征进行本地比对

## 结构

```
public/          静态前端
api/health.js    健康检查
api/config.js    公开配置
api/cover-index.js       云端索引读取与浏览器 seed 同步
api/cron-sync-index.js   每日最新页同步任务
lib/cover-index-server.js 封面特征提取与 Blob 读写
lib/sm.js                公开配置
vercel.json
```

## 部署

```bash
npx vercel --prod
```

## 云端索引

- 页面打开或刷新时自动读取 `/api/cover-index`，该请求只读取索引，不触发扫描。
- 点击「同步索引」后，浏览器直连市场列表获取最新 2 页，将角色封面作为 `seedItems` 提交给服务端。
- 服务端负责解析 WebP/透明封面、生成 aHash/dHash/亮度轮廓特征，并写入 Vercel Blob。
- Vercel Cron 每天 `04:00 UTC` 尝试同步最新 5 页；服务端列表请求可能受到 Cloudflare 限制，因此浏览器 seed 同步是主要更新方式。
- 以图搜图在浏览器本地比对云端特征索引，低结构相似候选会被提前过滤。

环境变量：
- `BLOB_READ_WRITE_TOKEN`（已配置）
- 可选 `CRON_SECRET`
