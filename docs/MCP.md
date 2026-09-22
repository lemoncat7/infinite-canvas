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
| `viora_generation_get` | 查询进度、结果、失败原因，默认同步已有结果卡片；`syncCanvas:false` 为只读 |
| `viora_generation_sync` | 修复已有任务与画布的关联，不重新生成、不消耗生成点数 |
| `viora_assets_list` | 分页查询资产及受认证保护的下载路径 |
| `viora_asset_upload` | 上传本地图片内容到指定项目，可选创建画布图片节点 |
| `viora_asset_upload_chunked` | 最大 100 MiB 图片分片上传、查询进度、校验合并及取消未完成上传 |
| `viora_asset_get` | 通过资产 ID 或生成任务 ID 获取文件详情、图片内联预览及原文件下载方式 |

首版不开放删除、清空画布、管理员配置、文本 Agent/漫剧流式工作流、TTS 或任意 URL 代理。MCP 不复制网页 UI，也不新增一套业务数据库。

## 推荐流程

1. 列出/创建项目，查询模型目录；需要生成时先确认用户意图和模型点数消耗。
2. 读取画布 `version`，创建节点前申请 ID 段。
3. 使用 `viora_canvas_apply` 保存节点和引用连线。节点包含 `id/kind/x/y/width/height/title/body/accent`；更新已有节点时应保留读取到的其他属性。
4. 提交生成，传入稳定的 `requestId`。视频会创建独立的结果卡片和引用连线，保留原配置卡片；返回 `resultNodeId` 和 `canvasSync`。
5. 以至少 2 秒的间隔退避查询任务，保持 `syncCanvas:true`（默认值），直到最终状态。最终一次查询会把结果地址、状态和元数据保存到画布，不依赖网页打开。此流程由 MCP 轮询驱动，没有额外后台同步任务；不要在生成完成前停止查询。

视频参考连线统一为“参考图片 → 视频生成卡片 → 视频结果卡片”，保留输入顺序，不再给结果卡片自动添加图片输入线。若生成卡片已有图片连线，提交的 `inputUrls` 必须与连线的数量、图片及顺序一致；缺图、漏传或错序在创建付费任务前报错。无连线时仍允许显式传入素材，并同步补建连线。同项目资产可按需创建参考图卡片，不抓取外部 URL。视频结果卡片不能作为新的生成提交入口。

历史任务参考来源保存在任务的 `input_urls` 中。旧版结果连线须显式调用 `viora_generation_sync(repairReferences:true)` 修复；只迁移带旧版同步标记、匹配该任务输入的自动连线，不重新生成。若当前生成卡片已连接不同素材，返回 `referencesSync: pending`，不覆盖新配置。普通轮询不会恢复用户已删除的连线。`createMissing:true` 可补建缺失的同项目参考图卡片。提交日志记录 requestId、jobId、生成卡片 ID 和实际参考图数量，不记录提示词、签名链接或图片内容。

旧视频卡片可用 `viora_generation_sync` 传入原 `jobId` 修复，不需要重新生成。普通轮询不重建删除的卡片；确需补建时显式指定 `createMissing:true`，且原始节点必须仍存在。已删除的历史创建批次可能仍受幂等保护，此时会返回 `pending`，不会偷偷恢复删除的数据。`viora_canvas_apply` 也会校验任务归属并补齐视频结果节点标记，防止遗漏标记导致刷新后无法预览。

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

### 上传本地图片

调用端先用自己的文件工具读取本地图片，再将原始 Base64（不带 `data:` 前缀）交给 `viora_asset_upload`：

```json
{
  "projectId": "目标项目ID",
  "name": "参考图.png",
  "mimeType": "image/png",
  "data": "本地文件的完整Base64内容",
  "placement": { "x": 0, "y": 0, "width": 280, "height": 280 }
}
```

省略 `placement` 只上传到资产库；传入则同时创建图片节点。返回 `asset.id`、`asset.url`，放置成功还返回 `nodeId`。支持 PNG、JPEG、WebP、GIF、AVIF，复用现有接口校验真实图片内容和项目权限。文件名不是路径；MCP 不读取客户端或服务器的任意本地文件，也不抓取任意 URL。

MCP 请求上限仍为 2 MiB。单次 `viora_asset_upload` 限制原图 **1 MiB**，更大的图片使用下面的分片工具，最大 **100 MiB**。单次上传不消耗生成点数，但**不支持幂等重传**：丢失响应时先查询资产，避免重复上传。上传成功但画布写入失败会返回资产与 `canvasSync: pending`；检查当前画布后用 `viora_canvas_apply` 添加返回的资产 URL，不要重新上传。

### 大图分片上传

`viora_asset_upload_chunked` 的调用顺序：

1. `action: "begin"`：传 `requestId`、`projectId`、`name`、`mimeType`、`size`（原文件字节数）、`sha256`（小写十六进制），可选 `placement`。返回 `uploadId`、分片大小和过期时间。
2. `action: "write"`：传 `uploadId`、从 0 开始的 `index` 和分片原始 Base64 `data`。每片原始数据固定为 1 MiB，最后一片为剩余字节；支持乱序和相同内容重传，不允许同一序号覆盖不同内容。
3. `action: "status"`：传 `uploadId`，查看已收到的分片序号；只补缺失分片。
4. `action: "complete"`：传 `uploadId`，校验完整性和 SHA-256 后复用现有图片上传接口。相同会话的并发或重复完成请求只提交一次，返回缓存结果。
5. 不再需要时调用 `action: "cancel"`，只释放未完成的分片，不删除已入库资产。

临时上传绑定当前 API 凭据；其他账号或轮换后的凭据不能读取/续传旧会话。暂存放在进程内存中，**30 分钟过期、重启不保留**。全局最多预留 128 MiB 未完成上传，每个凭据最多 2 个同时接收的上传；合并入库一次只处理一张，忙时返回 429，稍后用原 `uploadId` 重试。完成结果额外保留 30 分钟。超时或重启后先检查资产库，不能声称跨重启的严格幂等。

如果提交入库时出现不确定错误，会话标为 `uncertain`，不会再次提交，避免重复入库；先检查资产库再决定是否重新上传。生成扣费逻辑完全不参与此流程。

推荐用附带的本地脚本读取和分片，不让模型生成或复述大段 Base64：

```bash
cd api
# 在安全的本地环境中设置 VIORA_MCP_URL 和 VIORA_MCP_TOKEN，勿把 Token 发给模型。
node scripts/mcp-upload-image.mjs <项目ID> /本地路径/参考图.png
```

可选环境变量 `VIORA_UPLOAD_PLACEMENT='{"x":0,"y":0,"width":280,"height":280}'` 控制放入画布。脚本会打印 `requestId`，中断后在同一服务器进程、有效期内，可将该 ID 作为第三个参数并保持文件和配置相同来继续，自动跳过已收到的分片。服务重启或过期后先检查资产库，避免重复上传。脚本只打印进度和资产结果，不打印 Token 或图片 Base64。

### 请求重试

- **画布**：相同批次的网络重试复用 `batchId`。遇到 409 必须读取当前版本、合并冲突，再用新批次提交；不能盲目覆盖。节点是完整记录，不是局部 patch。
- **生成**：同一用户、同一 `requestId`、相同参数只创建一个任务。键落盘，服务重启后仍返回原任务；同一键更换参数返回 409。网页 HTTP `/api/jobs` 也可通过 `Idempotency-Key` 请求头使用相同保护。
- `requestId` 支持 8–128 个英文字母、数字、`_`、`-`，画布 `batchId` 为 8–100 个。不同的主动生成操作必须使用不同请求 ID。
- 创建项目和申请 ID 段不是幂等操作；创建项目丢失响应后先查询项目，避免重复创建。多申请的未使用节点 ID 不影响已有节点。
- 生成成功接收但画布冲突时会返回 `canvasLinked: false`、`canvasSync: pending` 和原任务 ID。这不表示生成失败；使用 `viora_generation_sync` 重试画布同步，缺失结果卡片时显式指定 `createMissing:true`，不要换请求 ID 重新生成。
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
