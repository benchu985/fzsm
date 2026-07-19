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

## 封面索引（以图搜图加速）

1. 选择页范围后点 **更新索引**：提取封面特征并保存
2. 默认保存在浏览器 **IndexedDB**（下次打开仍可用，搜图不再重新下图）
3. 若 Vercel 配置了 `BLOB_READ_WRITE_TOKEN`，索引会同步到 **Vercel Blob** 云端共享
4. **以图搜图** 只在索引里做高相似比对：低相似 aHash 直接丢弃

```bash
# 可选：在 Vercel 项目启用 Blob 并写入环境变量
vercel env add BLOB_READ_WRITE_TOKEN
```
