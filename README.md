# Viora

Viora 是一个面向 AI 图像与视频创作的网页版无限画布。它把素材、提示词和生成任务组织成可连接的卡片，让创作过程不再局限于单个输入框，而是成为可以持续扩展、回看和调整的视觉工作流。

项目采用 TypeScript、Canvas 2D、Fastify 和 SQLite 构建，支持 Docker 一键运行。

## 核心能力

- 无限画布：平移、缩放、适应画布、触控拖动与双指缩放
- 创作卡片：标签、图像生成、视频生成和媒体结果节点
- 节点连线：参考素材连接、吸附、生成中流动效果和右击删除
- 图像工作流：文生图、参考图修改、多图输入、尺寸与质量设置
- 视频工作流：多图参考、时长、分辨率、比例与模型选择
- 灵感 Agent：读取选中卡片和上游素材，自动规划并创建一个或多个图像/视频节点
- 项目体系：用户、项目、画布和资产按账号隔离与关联
- 资产管理：上传、粘贴、拖入画布、预览、下载和删除
- 创作广场：首页与广场展示公开图片和视频作品
- 任务队列：图片与视频独立并发，支持排队、进度、失败恢复和结果归档
- 创作点数：免费/付费模型区分、任务冻结、成功扣除、失败退回和充值码兑换
- 双主题：小清新浅色主题与科技感深色主题

## 技术栈

- 前端：TypeScript、Vite、Canvas 2D、原生 DOM/CSS
- 后端：Node.js、Fastify、TypeScript
- 数据：SQLite（`sql.js`）与本地文件资产存储
- 部署：Docker Compose、Nginx
- 模型适配：OpenAI 兼容图像接口、CPA 通用接口、Agnes Video 专用接口

## 快速启动

复制环境变量模板并填写必要配置：

```bash
cp .env.example .env
```

构建并启动：

```bash
sudo docker compose up -d --build
```

访问地址：

- Web：`http://127.0.0.1:4173`
- 健康检查：`http://127.0.0.1:4173/api/health`

查看运行状态：

```bash
sudo docker compose ps
sudo docker compose logs -f api web
```

持久化数据保存在 Docker volume 中。重新创建容器不会删除用户、项目、画布和资产；删除 volume 前请先备份。

## 环境配置

完整配置项见 [`.env.example`](./.env.example)。常用配置包括：

```env
IMAGE_GENERATION_CONCURRENCY=8
VIDEO_GENERATION_CONCURRENCY=2

OPENAI_IMAGE_BASE_URL=
OPENAI_IMAGE_API_KEY=
OPENAI_IMAGE_DEFAULT_MODEL=gpt-image-2

AGNES_VIDEO_BASE_URL=https://apihub.agnes-ai.com
AGNES_VIDEO_API_KEY=
AGNES_VIDEO_API_KEY_2=

REGISTRATION_INVITE_CODE=
GENERATION_PUBLIC_BASE_URL=
```

请勿提交 `.env`。模型密钥、代理地址和管理员密钥只应进入 API 容器，不应发送到浏览器或写入仓库。

## API 文档

完整的接口目录、Token 认证、管理员权限、反馈读取和通知发送示例见 [docs/API.md](./docs/API.md)。

## 模型与任务

当前生成任务会先写入数据库队列，再由后端工作器领取执行：

- 图片任务默认最多并发 8 个
- 视频任务默认最多并发 2 个
- Agnes 支持多密钥轮换和单密钥冷却
- 生成结果成功后自动写入当前项目资产库
- 服务重启时会将中断任务标记为失败，避免节点永久停留在生成中

当前模型展示策略：

- Agnes Video 2.0：免费模型
- Grok Imagine Video 1.5 Preview：付费模型，每次成功生成消耗 2 点

付费任务入队时冻结点数，成功后扣除，失败时自动退回。

## 充值码

普通用户可以在右上角用户菜单的「创作点数」中兑换充值码。

管理员账号可以在同一面板中选择面额和数量，一键生成并复制充值码。充值码只保存哈希值，只能被一个账号兑换一次。

## 项目结构

```text
.
├── api/                 Fastify API、任务队列和模型 Provider
│   └── src/providers/   图像与视频接口适配层
├── public/              品牌与静态资源
├── src/                 画布、卡片、项目、资产和 Agent 前端
├── compose.yaml         Docker Compose 配置
├── Dockerfile           Web 构建与 Nginx 镜像
└── nginx.conf           Web 与 API 反向代理
```

## 当前状态

项目处于持续开发阶段，核心的图像生成、视频生成、Agent 规划、用户项目资产体系和点数机制已经可用。后续重点包括支付接入、管理员后台、任务与点数流水、更多 Provider 适配以及移动端性能优化。

## 安全说明

- 不要把 API Key、访问令牌或代理凭据提交到 Git
- 生产环境应使用 HTTPS，并设置独立的注册邀请码和管理员密钥
- 对外部署前建议限制上传大小、配置备份并审查公开作品内容
- 自定义模型接口目前仍处于预留阶段，正式开放前需要补充密钥加密与权限审计
