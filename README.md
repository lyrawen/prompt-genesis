# Prompt Genesis — 神谕沙盒

> **AI-Native 2D 像素风生存微游戏** | 用自然语言驱动 NPC，在 60 秒洪水中求生

## 快速开始

```bash
npm install
npm run dev        # 启动开发服务器（前端 + API）
# 或
npm run dev:server # 单独启动后端 API（端口 3001）
```

浏览器打开 `http://localhost:5173`。

> 首次运行需要 `DEEPSEEK_API_KEY`，在项目根目录创建 `.env` 文件：
> ```env
> DEEPSEEK_API_KEY=sk-your_key_here
> ```
> 不设置密钥也能玩，会自动降级为离线模式。

## 玩法

输入自然语言"神谕"指挥三名 NPC 在 60 秒内收集资源：

- **阿强 👊** — 力量型，擅长砍树
- **阿珍 🧠** — 学者型，擅长读书
- **阿衰 😌** — 恢复型，擅长睡觉恢复饱食度

```
让阿强去砍树，阿珍去读书，阿衰睡觉恢复体力
```

## 核心功能

| 模块 | 说明 |
|------|------|
| 🎮 核心循环 | 60 秒倒计时，木材/知识/饱食度三种资源，**Bullet Time 时空暂停** |
| 🧠 LLM 驱动 | DeepSeek API + JSON Mode，品质评分 / 连锁事件 / 多轮记忆 |
| 🎨 视觉 | 程序化像素艺术（零外部资产），4 阶段洪水粒子系统 |
| 🔊 音效 | Web Audio API 全代码合成（10 类音效） |
| 🌍 世界 | 8 种环境事件、动态地图变化、跨局世界演进 |
| 🏆 留存 | 8 项成就、自适应难度、3 种挑战模式、自由模式 |
| 🎤 交互 | 语音输入（Web Speech API）、LLM 推理可视化 |
| 🛡️ 容错 | 反幻觉防护（双重校验）、三级容错（API → 超时 → 离线 Mock）|

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Phaser 3.90 + TypeScript 6.0 + Vite 8 |
| 样式 | Tailwind CSS v4 + 玄夜玉青流沙主题 |
| 后端 | Express 5 / Vercel Serverless |
| AI | DeepSeek Chat API |
| 音效 | Web Audio API（零外部资产）|
| 测试 | Vitest 4（70 用例）|

## 在线演示

[prompt-genesis-eight.vercel.app](https://prompt-genesis-eight.vercel.app)

## 项目结构

```
src/
├── main.ts              — 游戏主循环、HUD、成就系统
├── types.ts             — 全部 TypeScript 类型定义
├── api/divineCommand.ts — LLM 响应获取 & 反幻觉解析
├── audio/soundManager.ts— Web Audio API 音效引擎
├── game/survivalState.ts— 游戏状态机、难度、挑战配置
├── scenes/
│   ├── GameScene.ts     — Phaser 场景（NPC/粒子/主动行为/地图变化）
│   └── proceduralArt.ts — 程序化像素艺术生成
server/
├── divineApi.js         — Express API 路由
└── mockFallback.js      — 离线关键词路由降级
api/
├── index.js             — Vercel Serverless 函数
└── _shared.js           — 共享逻辑
```

## 部署

```bash
npm run build    # 构建前端
npx vercel --prod  # 部署到 Vercel
```

需要设置环境变量 `DEEPSEEK_API_KEY`。

## 许可

MIT
