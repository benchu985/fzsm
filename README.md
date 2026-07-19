# fzsm · 角色市场封面浏览

**线上：https://fzsm.vercel.app/**

## 功能

- 浏览器直连官方 `role_market.php` 列表
- **仅封面浏览**（搜索 / 排序 / 翻页）
- 无登录 / 无注册 / 无详情 / 无下载
- 页面刷新时自动读取 Vercel Blob 云端索引
- 用户访问时自动比较市场总数与云端索引数，按差量在后台补齐最新封面
- 以图搜图使用 aHash、dHash 与亮度轮廓特征进行本地比对
- 支持一次上传多张图片；缩略图显示在搜索区下方，点击可查看该图片对应的识图结果

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

- 页面打开或刷新时并行读取 `/api/cover-index` 与市场列表，并比较云端索引数和当前角色总数。
- 数量一致时跳过同步；有缺口时按差量自动选择最新 1–4 页，将封面作为 `seedItems` 在后台提交。
- 前端不提供同步按钮，索引检查不会阻塞角色浏览或搜图操作。
- 服务端负责解析 WebP/透明封面、生成 aHash/dHash/亮度轮廓特征，并写入 Vercel Blob。
- Vercel Cron 每天 `04:00 UTC` 尝试同步最新 5 页；服务端列表请求可能受到 Cloudflare 限制，因此访问触发的浏览器 seed 是主要更新方式。
- 以图搜图在浏览器本地比对云端特征索引，低结构相似候选会被提前过滤。

环境变量：
- `BLOB_READ_WRITE_TOKEN`（已配置）
- 可选 `CRON_SECRET`
