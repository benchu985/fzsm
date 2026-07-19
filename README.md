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

- **每 10 分钟自动同步最新封面**（GitHub Actions → `/api/cron-sync-index`）
  - 工作流：`.github/workflows/sync-index.yml`
  - 刷新最新 5 页封面（约 250 条范围）并写入 Blob 索引
  - 也可在 Actions 页手动 `workflow_dispatch`
- Vercel Cron 每日 04:00 UTC 兜底一次（Hobby 套餐不支持亚日级 cron）
- 前端打开自动拉 `/api/cover-index`（只读，不触发同步）
- 也可点「同步索引」手动立即刷新
- 以图搜图只比对云端索引，低相似直接丢弃

环境变量：
- `BLOB_READ_WRITE_TOKEN`（已配置）
- 可选 `CRON_SECRET`（若设置，需同步配置 GitHub Secret `CRON_SECRET`）

