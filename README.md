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
