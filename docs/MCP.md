# Viora MCP

Viora / infinite-canvas 内置 MCP 服务，与网页共用用户、项目、模型目录、资产库和生成队列。不需要额外启动进程或开放端口。

## 连接

- 传输：**Streamable HTTP**，无状态模式。
- 经网页入口访问：`https://你的域名/api/mcp`；本地网页默认 `http://127.0.0.1:4173/api/mcp`。
- 直连 API 服务时没有 `/api` 前缀：`http://127.0.0.1:3000/mcp`。
- 请求头：`Authorization: Bearer <个人 API Token>`。
- 在右上角用户菜单生成个人 API Token，完整值只显示一次。刷新 Token 后旧值立即失效。

支持 HTTP MCP 的客户端可以按其配置格式填写，例如：

```json
{
  "mcpServers": {
    "viora": {
      "type": "http",
      "url": "https://你的域名/api/mcp",
      "headers": {
        "Authorization": "Bearer <个人 API Token>"
      }
    }
  }
}
```

`type` / `headers` 的字段名称以所用客户端为准。这里不是 stdio 服务，也不是旧版 `/sse` 服务；只有 POST 接收协议消息，GET/DELETE 返回 405 是无状态传输的正常行为。官方 MCP SDK 客户端已做连接测试。

浏览器 Cookie 和 `X-Admin-Key` **不能**用于 MCP。Token 只允许访问该用户自己的数据；管理员的 Token 也不会获得额外的管理工具。

## 首版工具

| 工具 | 用途 |
| --- | --- |
| `viora_projects_list` | 分页列出自己的项目 |
| `viora_project_create` | 创建空项目 |
| `viora_models_list` | 模型、默认模型、能力与点数价格，不含服务商密钥 |
| `viora_canvas_read` | 读取版本、相机、分页节点及连线 |
| `viora_canvas_allocate_ids` | 为新节点分配不会碰撞的 ID 段 |
| `viora_canvas_apply` | 按版本批量新增/更新完整节点和引用连线 |
| `viora_generation_submit` | 提交异步图片/视频生成，立即返回任务 ID |
| `viora_generation_get` | 查询进度、结果、失败原因 |
| `viora_assets_list` | 分页查询资产及受认证保护的下载路径 |
| `viora_asset_get` | 通过资产 ID 或生成任务 ID 获取文件详情、图片内联预览及原文件下载方式 |

首版不开放删除、清空画布、管理员配置、文本 Agent/漫剧流式工作流、TTS 或任意 URL 代理。MCP 不复制网页 UI，也不新增一套业务数据库。

## 推荐流程

1. 列出/创建项目，查询模型目录；需要生成时先确认用户意图和模型点数消耗。
2. 读取画布 `version`，创建节点前申请 ID 段。
3. 使用 `viora_canvas_apply` 保存节点和引用连线。节点包含 `id/kind/x/y/width/height/title/body/accent`；更新已有节点时应保留读取到的其他属性。
4. 提交生成，传入稳定的 `requestId`。工具会检查节点与生成类型，并尝试把返回的 `jobId` 写回画布。
5. 以至少 2 秒的间隔退避查询任务。`succeeded` 后使用 `result_url`，不重复提交生成。

生成完成后可以直接调用 `viora_asset_get`，例如 `{"jobId":"生成返回的任务ID"}`；也可使用 `{"assetId":"资产ID"}`。两种 ID 只传一个。图片默认返回标准 MCP `image` 内容块（最长边 640px 的缩略图，不是原图），客户端是否展示由其 MCP 渲染支持决定。加 `"preview":false` 可关闭预览。图片和视频均返回 **15 分钟有效、不需要 Authorization 请求头的 `download.url`**，以及标准 MCP `resource_link`，不是长期 API Token。图片预览失败时仍提供原文件下载信息。

需要发送附件时，伙伴应使用本地下载／Shell 工具，将该 URL 的原文件保存到**当前会话工作目录**（使用 `suggestedFilename`，避免覆盖同名文件），确认下载成功后，把真实本地路径交给附件发送工具。远程 MCP 服务不能直接写客户端磁盘；只有 MCP、没有本地文件工具的客户端，仍需手动下载或增加客户端文件接收能力。不要虚构 `sandbox:` 地址或本地路径；链接过期后重新调用 `viora_asset_get`，不必重新生成图片或视频。

简单节点示例：

```json
{
  "projectId": "从项目列表获取",
  "baseVersion": 1,
  "batchId": "agent-create-node-0001",
  "nodes": [{
    "id": 1,
    "kind": "image",
    "x": 0, "y": 0, "width": 280, "height": 280,
    "title": "产品草图", "body": "产品草图描述", "accent": "#808080"
  }],
  "links": []
}
```

实际 ID 必须来自 `allocate_ids`，版本必须来自当前画布。数组分页返回 `total` 与 `nextOffset`；节点和连线分别判断是否还有下一页。

## 重试与并发

- **画布**：相同批次的网络重试复用 `batchId`。遇到 409 必须读取当前版本、合并冲突，再用新批次提交；不能盲目覆盖。节点是完整记录，不是局部 patch。
- **生成**：同一用户、同一 `requestId`、相同参数只创建一个任务。键落盘，服务重启后仍返回原任务；同一键更换参数返回 409。网页 HTTP `/api/jobs` 也可通过 `Idempotency-Key` 请求头使用相同保护。
- `requestId` 支持 8–128 个英文字母、数字、`_`、`-`，画布 `batchId` 为 8–100 个。不同的主动生成操作必须使用不同请求 ID。
- 创建项目和申请 ID 段不是幂等操作；创建项目丢失响应后先查询项目，避免重复创建。多申请的未使用节点 ID 不影响已有节点。
- 生成成功接收但画布冲突时会返回 `canvasLinked: false` 和原任务 ID。这不表示生成失败；读取画布后挂接该 `jobId`，不要换请求 ID 重新生成。
- 服务重启时仍在执行的旧任务维持原有行为：标记失败、释放预留点数，不自动重复调用可能已经收费的上游。确需重新生成时确认原任务结果并使用新请求 ID。幂等保护约束本服务任务提交，不承诺上游网络故障下的“恰好一次”计费。
- 生成工具断开连接不取消已接收的任务。重新连接后查询任务即可。

## 资产与安全

原有 `/api/assets/<id>/content/<filename>` 仍要求 Authorization。新链接使用 `/api/asset-downloads/<id>?ticket=...`：凭证只允许读取该用户的这一个文件，15 分钟后失效；文件删除、账号删除或个人 Token 轮换也会使旧链接失效。支持 Range 下载和重试，不是一次性消耗链接。资产的公开状态不会改变，但**持有短时链接的人在有效期内可以下载该文件**，因此不要把链接发到公共渠道；优先下载后发送附件。

链接签名密钥 `asset-download.key` 保存在数据目录（权限 600），需要随数据库一起备份；重启不会无故使未过期链接失效。API 和内置 Nginx 对短时下载路由禁用请求访问日志。若还有外部反向代理／网关，也应避免记录这一地址的查询参数。

有 HTTPS、端口转发或多层代理时，建议设置 `MCP_PUBLIC_BASE_URL=https://你的域名:端口` 为用户可访问的**网页站点根地址**（不要包含 `/api/mcp`）。未设置时优先使用 `GENERATION_PUBLIC_BASE_URL`，再根据 MCP 请求的协议和 Host 推导。直连 API 端口时也应配置网页入口，避免拿到不可访问的 `/api` 地址。Compose 已透传此配置。

默认拒绝带 `Origin` 的浏览器跨域请求。确有可信浏览器客户端时，配置 `MCP_ALLOWED_ORIGINS` 为精确 Origin 的逗号分隔白名单（例如 `https://agent.example.com`）；这不启用通用 CORS。可用 `MCP_ALLOWED_HOSTS` 限制精确 Host（含非默认端口），反向代理应保留原 Host。原有 Nginx `/api/` 转发已兼容，无需另开公网端口。

不要向不可信 Agent 分发自己的 Token。生产环境使用 HTTPS。MCP 单请求正文限制 2 MiB，不转发 Cookie、全局管理密钥或模型服务商凭据。

## 验证

```bash
cd api
npm ci
npm run test:mcp
npm run test:architecture
```

端到端测试使用临时数据库、临时模型配置和本机假上游，不调用真实付费模型，不读取或修改正在使用的数据目录。
