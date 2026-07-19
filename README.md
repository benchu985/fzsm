# fzsm · 角色市场封面浏览

**线上：https://fzsm.vercel.app/**

## 功能

- 浏览器直连官方 `role_market.php` 列表
- **仅封面浏览**（搜索 / 排序 / 翻页）
- 无登录 / 无注册 / 无详情 / 无下载
- 服务端仅 `health` / `config`，无业务代理，不需要环境变量

## 结构

```
public/          静态前端
api/health.js    健康检查
api/config.js    公开配置
lib/sm.js
vercel.json
```

## 部署

```bash
npx vercel --prod
```

## 云端自动索引

- Vercel Cron 每 10 分钟：`/api/cron-sync-index`
  - 刷新最新页（新图）
  - 继续全库爬取并写入 Blob 索引
- 前端打开自动拉 `/api/cover-index`
  - 空索引/过期时服务端自动补同步
  - **无需手动更新索引**
- 以图搜图只比对云端索引，低相似直接丢弃

环境变量：
- `BLOB_READ_WRITE_TOKEN`（已配置）
- 可选 `CRON_SECRET`
