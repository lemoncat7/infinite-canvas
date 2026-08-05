# Viora API

Viora 的浏览器入口默认是 `http://127.0.0.1:4173`，所有业务接口统一使用 `/api` 前缀。下文示例中的地址可替换为实际部署域名。

## 认证与权限

接口支持两种认证方式：

- 浏览器会话：登录后由 `flow_session` HttpOnly Cookie 自动认证。
- API Token：请求头使用 `Authorization: Bearer <TOKEN>`。

用户可以在右上角用户菜单生成或刷新个人 API Token，也可以调用：

```http
GET  /api/users/me/api-token
POST /api/users/me/api-token
```

`GET` 只返回是否已生成及脱敏提示；`POST` 返回新的完整 Token。服务端仅保存 Token 哈希，完整 Token 只在生成时返回一次。刷新后旧 Token 立即失效。

权限规则：

- 无有效认证：返回 `401 Unauthorized`。
- 普通用户调用管理员接口：返回 `403 Forbidden`。
- 管理员身份由用户表中的 `is_admin` 决定，不能由 Token 内容指定。
- 可选的服务端自动化可配置 `ADMIN_API_KEY`，并通过 `X-Admin-Key` 请求头认证；不要将该密钥发送到浏览器。

## 管理员接口

### 读取反馈建议

```http
GET /api/admin/feedback
```

查询参数：

| 参数 | 可选值 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `status` | `all`、`open`、`reviewing`、`resolved`、`closed` | `all` | 处理状态 |
| `type` | `all`、`bug`、`suggestion` | `all` | 反馈类型 |
| `limit` | `1`–`500` | `100` | 最大返回数量 |

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" \
  "https://example.com/api/admin/feedback?status=open&type=bug&limit=100"
```

返回值包含反馈内容、状态、用户、项目、联系方式、来源页面和浏览器信息。

### 更新反馈状态

```http
PATCH /api/admin/feedback/:id
Content-Type: application/json
```

请求体：

```json
{"status":"resolved"}
```

状态支持 `open`、`reviewing`、`resolved` 和 `closed`。该接口仅限管理员，用于在确认修复后同步关闭反馈。

### 发送全站通知

```http
POST /api/admin/notifications
Content-Type: application/json
```

请求体：

```json
{
  "title": "漫剧创作支持关联标签",
  "content": "选择已有标签后，可以继续通过对话修改或续写。",
  "type": "update",
  "priority": "normal",
  "autoPopup": false
}
```

字段约束：

- `title`：2–100 个字符。
- `content`：2–3000 个字符。
- `type`：`update`、`fix`、`notice` 或 `maintenance`。
- `priority`：`normal` 或 `important`。
- `autoPopup`：是否允许作为重要通知在当天首次登录时弹出。

通知创建成功后返回 `201`，并通过 SSE 立即通知在线网页刷新通知列表和未读数量。

```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"title":"功能更新","content":"更新内容","type":"update","priority":"normal","autoPopup":false}' \
  "https://example.com/api/admin/notifications"
```

## 用户与认证

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | 公开 | 使用邀请码注册 |
| `POST` | `/api/auth/login` | 公开 | 用户名或邮箱登录 |
| `POST` | `/api/auth/logout` | 登录用户 | 退出当前会话 |
| `GET` | `/api/users/me` | 登录用户 | 当前用户资料与点数 |
| `PATCH` | `/api/users/me` | 登录用户 | 修改昵称 |
| `GET` | `/api/users/me/api-token` | 登录用户 | 查询 Token 状态 |
| `POST` | `/api/users/me/api-token` | 登录用户 | 生成或刷新 Token |
| `POST` | `/api/users/me/credits/redeem` | 登录用户 | 兑换充值码 |
| `POST` | `/api/admin/recharge-codes` | 管理员 | 创建充值码 |

## 反馈与通知

| 方法 | 路径 | 权限 | 用途 |
| --- | --- | --- | --- |
| `POST` | `/api/feedback` | 登录用户 | 提交建议或 Bug |
| `GET` | `/api/notifications` | 登录用户 | 获取最近 100 条通知及已读状态 |
| `GET` | `/api/notifications/stream` | 浏览器会话 | SSE 实时通知同步 |
| `POST` | `/api/notifications/claim-popup` | 登录用户 | 获取当天待弹出的重要通知 |
| `POST` | `/api/notifications/:id/read` | 登录用户 | 标记单条已读 |
| `POST` | `/api/notifications/read-all` | 登录用户 | 全部标记已读 |

## 项目、画布与资产

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET/POST` | `/api/projects` | 项目列表、创建项目 |
| `PATCH/DELETE` | `/api/projects/:projectId` | 重命名、删除项目 |
| `POST` | `/api/projects/:projectId/duplicate` | 复制项目 |
| `GET/PUT` | `/api/projects/:projectId/canvas` | 读取、保存项目画布 |
| `GET` | `/api/projects/:projectId/assets` | 项目资产列表 |
| `POST` | `/api/projects/:projectId/assets` | 上传项目资产 |
| `GET` | `/api/assets` | 当前用户资产列表 |
| `GET` | `/api/assets/:assetId/content/:filename` | 下载原始资产并保留文件名 |
| `GET` | `/api/assets/:assetId/thumbnail` | 获取画布缩略图 |
| `PATCH` | `/api/assets/:assetId/visibility` | 设置广场公开状态 |
| `DELETE` | `/api/assets/:assetId` | 删除资产 |
| `GET` | `/api/showcase` | 获取公开作品 |

项目、画布和资产接口均校验资源所属用户，不能使用其他用户的 ID 越权访问。

## 生成与 Agent

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/generation/capabilities` | 获取模型与参数能力 |
| `POST` | `/api/jobs` | 创建图片或视频任务 |
| `GET` | `/api/jobs/:id` | 查询队列状态、进度和结果 |
| `POST` | `/api/agents/prompt` | 灵感 Agent 规划画布工作流 |
| `POST` | `/api/agents/comic` | 流式生成或修改漫剧方案 |
| `GET/POST/DELETE` | `/api/user-api-models` | 用户自定义模型配置（前端暂未开放） |
| `POST` | `/api/user-api-models/test` | 测试自定义接口连通性 |

生成任务先写入数据库队列；图片与视频采用独立并发。任务和资产接口会校验当前用户及项目归属。

## 公共与诊断接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服务健康检查 |
| `GET` | `/api/generation/capabilities` | 前端能力发现 |
| `GET` | `/api/public/assets/:assetId/content/:filename` | 读取公开作品 |
| `GET` | `/api/public/assets/:assetId/thumbnail` | 读取公开缩略图 |
| `POST` | `/api/client-logs` | 上报前端异常诊断信息 |

## 通用错误

错误响应通常为：

```json
{
  "error": "错误说明"
}
```

常见状态码：

- `400`：参数无效。
- `401`：没有有效会话或 Token。
- `403`：已认证但权限不足。
- `404`：资源不存在或不属于当前用户。
- `409`：当前状态冲突。
- `429`：请求过于频繁或额度不足。
- `500/502/503/504`：服务或上游模型异常。

## 安全建议

- 生产环境必须使用 HTTPS。
- Token、模型密钥和管理员密钥不得提交到 Git。
- 不要在 URL 查询参数中传 Token。
- Token 泄露后应立即在用户菜单刷新。
- 管理员 Token 应只用于可信脚本和管理工具。
