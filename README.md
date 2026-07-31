# Infinite Canvas

一个用 TypeScript 开始的网页版无限画布实验项目。

当前 MVP 包含：

- Canvas 2D 渲染
- 鼠标/触控拖拽平移
- 以指针为中心的滚轮缩放
- 无限点阵背景和示例卡片
- 可编辑的节点名称、提示词和模型
- Fastify + TypeScript API
- SQLite 画布与任务持久化
- 可轮询的模拟图片/视频生成任务

## 启动

推荐使用 Docker：

```bash
sudo docker compose up -d --build
```

访问 `http://127.0.0.1:4173`，API 健康检查为 `http://127.0.0.1:4173/api/health`。

数据保存在 Docker volume `infinite-canvas_canvas-data` 中。

## 自定义生成接口

默认使用 `mock` Provider。接入自定义图片/视频生成服务时配置：

```bash
GENERATION_PROVIDER=custom-api
CUSTOM_GENERATION_BASE_URL=https://your-api.example.com
CUSTOM_GENERATION_API_KEY=your-secret
CUSTOM_GENERATION_SUBMIT_PATH=/generations
CUSTOM_GENERATION_STATUS_PATH=/generations/{id}
```

提交接口接收统一的 `type`、`prompt`、`model`、`inputUrls`、`parameters` 和 `callbackMetadata`。提交响应需要提供 `id` 或 `taskId`；状态接口支持常见的 `status`、`progress`、`resultUrl/result_url` 字段。密钥只进入 API 容器，不发送到浏览器。

## 下一阶段候选

- 节点端口连线、框选和快捷键
- 图片上传与真实结果预览
- 撤销重做
- 多人协作（WebSocket + CRDT）
- 空间索引和分层渲染优化
