# Viora

Viora 是一个面向 AI 图像与视频创作的网页版无限画布。它把素材、提示词和生成任务组织成可连接的卡片，让创作过程不再局限于单个输入框，而是成为可以持续扩展、回看和调整的视觉工作流。

项目采用 TypeScript、Canvas 2D、Fastify 和 SQLite 构建，支持 Docker 一键运行。

## 核心能力

- 无限画布：平移、缩放、适应画布、触控拖动与双指缩放
- 创作卡片：标签、图像生成、视频生成和媒体结果节点
- 节点连线：参考素材连接、吸附、生成中流动效果和右击删除
- 图像工作流：文生图、参考图修改、多图输入、尺寸与质量设置
- 视频工作流：多图参考、时长、分辨率、比例与模型选择
- 漫剧工作流：剧情方案、角色/场景/道具资产、分镜规划、连续性校验与画布铺设
- 语音工作流：角色音色配置、TTS 文本节点、试听与音频结果节点
- 灵感 Agent：读取选中卡片和上游素材，自动规划并创建一个或多个图像/视频节点
- 项目体系：用户、项目、画布和资产按账号隔离与关联
- 资产管理：上传、粘贴、拖入画布、预览、下载和删除
- 创作广场：首页与广场展示公开图片和视频作品
- 任务队列：图片与视频独立并发，支持排队、进度、失败恢复和结果归档
- 创作点数：免费/付费模型区分、任务冻结、成功扣除、失败退回和充值码兑换
- 双主题：冷白冷灰浅色主题与石墨黑深色主题，画布、卡片、菜单和对话框共享统一语义色

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

## Kokoro TTS

项目通过内部容器运行 Kokoro ONNX，并提供兼容 OpenAI Speech API 的接口。默认使用标准 ONNX Runtime CPU 后端。

```bash
docker compose up -d tts
```

Intel OpenVINO 实验后端使用独立 Compose 覆盖文件；它会映射 `/dev/dri`，初始化失败时自动回退 CPU：

```bash
docker compose -f compose.yaml -f compose.openvino.yaml up -d --build tts
```

```bash
docker compose exec tts curl http://127.0.0.1:8880/health
docker compose exec tts curl http://127.0.0.1:8880/v1/audio/voices
docker compose exec -T tts curl http://127.0.0.1:8880/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"kokoro","input":"轮到林夜时，整个练武场忽然安静了一瞬。","voice":"zf_xiaoxiao","response_format":"wav","speed":0.95}' \
  --output /tmp/narration.wav
```

TTS 不映射宿主机端口，只允许 Compose 内部网络访问；API 使用 `http://tts:8880` 调用。服务支持 WAV、MP3、Opus、FLAC、AAC、PCM，以及按句生成的 PCM 流式响应。N100 实测默认并发为 2；更多请求继续排队，避免三个以上推理任务争抢内存带宽。

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
├── src/
│   ├── app/             前端启动、状态与全局事件
│   ├── canvas/          画布渲染、相机、交互、选择与连线
│   ├── nodes/           卡片类型、行为和节点服务
│   ├── services/        API、生成任务、资产与项目服务
│   ├── styles/          全局主题令牌与各功能结构样式
│   └── ui/              菜单、编辑器、对话框与漫剧工作台
├── compose.yaml         Docker Compose 配置
├── Dockerfile           Web 构建与 Nginx 镜像
└── nginx.conf           Web 与 API 反向代理
```

## 前端样式约定

主题的唯一入口是 `src/styles/theme.css`。公共界面材料、文字、边框、阴影、强调色和交互状态必须使用其中的 `--ui-*` 语义变量；功能样式文件只负责布局、尺寸和该功能独有的动画，不重复维护主题颜色。

漫剧对话框、画布浮层、菜单、输入区、按钮、状态标签和消息气泡共用同一套语义材料。新增组件时应优先复用现有变量，例如：

- `--ui-floating-raised`：悬浮面板材料
- `--ui-floating-hairline`：玻璃面板细边界
- `--ui-floating-footer-material`：面板底部操作区
- `--ui-message-user-material`：用户消息表面
- `--ui-shadow-control` / `--ui-shadow-input`：控件与输入框阴影

不要新增仅用于转接公共颜色的功能前缀变量，也不要在文件末尾通过高优先级选择器覆盖旧规则。确有功能专属状态时可以保留局部变量，例如动画角度或运行时进度。

修改主题或公共组件后至少执行：

```bash
npm run test:theme
npm run build
```

## 当前状态

项目处于持续开发阶段，核心的图像生成、视频生成、Agent 规划、用户项目资产体系和点数机制已经可用。后续重点包括支付接入、管理员后台、任务与点数流水、更多 Provider 适配以及移动端性能优化。

## 安全说明

- 不要把 API Key、访问令牌或代理凭据提交到 Git
- 生产环境应使用 HTTPS，并设置独立的注册邀请码和管理员密钥
- 对外部署前建议限制上传大小、配置备份并审查公开作品内容
- 自定义模型接口目前仍处于预留阶段，正式开放前需要补充密钥加密与权限审计
