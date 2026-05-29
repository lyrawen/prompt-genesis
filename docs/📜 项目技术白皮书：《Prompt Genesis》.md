# 📜 项目技术白皮书：《Prompt Genesis》

## 🎨 第一部分：最终呈现效果（玩家视角与视觉 Juicing）

当用户打开浏览器，呈现在眼前的是一个没有加载任何外界 `.png` 图片，却极具视觉张力和生存紧迫感的新中式数字像素风（New Chinese Digital Aesthetics）沙盒世界。

### 1. 静态视觉与常驻氛围

- **宣纸画布肌理：** 游戏主舞台（$800 \times 600$ Canvas）不是死板的纯绿，而是带有宣纸质感的淡墨绿（`#8FA989`）。利用确定性伪随机噪点算法，草地上点缀着错落有致的深灰色微小像素墨点。
- **动态青花水域：** 地图边缘包围着深邃的青花水墨蓝（`#2C4A5E`）水域。水岸交界处，纯代码生成的像素波纹正随着正弦波（Sine Wave）缓慢闪烁晃动（Shimmer 动画）。
- **三大国风像素地标：**
  - `[600, 150]` **古松森林**：由深褐色像素树干与层叠的、三角形国风暗绿树冠组合成的挺拔古松。
  - `[160, 360]` **岭南书斋**：勾勒出标志性徽派/岭南“镬耳墙”圆弧线条的灰色建筑剪影，窗户处亮着一粒暖黄色的像素微光。
  - `[400, 540]` **竹榻营地**：一张用浅褐色线条交织成的极简竹编躺椅矩阵。
- **生动的信徒（NPC）：**
  - **阿强**：头戴一顶宽大的像素斗笠，身穿赤褐色短打，原地高频踏步。
  - **阿珍**：身着深蓝色长衫，文质彬彬。
  - **阿衰**：一抹苔绿色身影，身体比其他人矮小 2 像素，全身常驻着一种极其松垮、缓慢舒张的“呼吸”补间动画（Squash & Stretch），尽显摸鱼本质。

### 2. 神谕驱动的核心交互

当玩家点击 **「开始求生」**，60秒倒计时开始无情走字，集体饱食度每 5 秒自动滑落 2%。玩家在底栏输入：

> *“风暴要来了，强壮的赶紧去砍树，聪明的去读书，剩下的那个别摸鱼了去睡觉恢复体力！”*

点击「降下神谕」按钮，按钮立刻进入流光加载态，提示“神明思考中(LLM Reasoning)...”。**2秒后，奇迹发生：**

- **全员异步奔跑：** 没有任何画面卡顿，阿强、阿珍、阿衰三人**同时**调头，在宣纸草地上拉出三条不同的奔跑轨迹，分别奔向森林、书斋与竹榻。
- **戏剧性的头顶气泡（Speak）：**
  - 阿强头顶飙出气泡：`“看俺阿强的厉害！为了部落！”`
  - 阿珍头顶弹出：`“为文明留火种……粗鄙之活莫叫我。”`
  - 阿衰慢吞吞挪动，飘出：`“神明英明，那我继续躺了~”`
- **动作编排与状态（Play Animation）：**
  - 到达位置后，阿强对着古松高频播放挥舞手臂的像素伐木动作（Chop）；
  - 阿珍面前凭空浮现出一个白色的小像素矩形代表翻开的书卷（Read）；
  - 阿衰直接躺平，身体横过来，头顶疯狂向斜上方喷吐 `💤` 像素粒子。
- **数据大快人心（State Impact）：** 顶栏的木材、知识进度条双双跳动暴涨 $+2$，饱食度进度条瞬间从安全的**翠绿色**缩回一截变成**警告橙**（$-10\%$），数值与反馈严丝合缝。

### 3. 终局危机的视觉高潮

- **大洪水粒子（末日感）：** 随着倒计时逼近 0 秒，屏幕四周开始凭空凝聚出密密麻麻、半透明的黑色“水墨墨滴粒子”。最后 10 秒时，粒子变得极大、极快，向中心疯狂晕染坍塌。
- **震撼震屏（Juice）：** 在最后 10 秒内，只要玩家输入神谕，Phaser 镜头就会随着神谕降下触发激烈的**轻微震屏（Camera Shake）**，轰鸣感扑面而来。
- **生死结算：** 60秒到，若资源达标，大模型在后台即兴脑补一段“信徒搭乘赛博方舟惊险生还”的国风赞美诗并弹窗告捷；否则，全屏水墨黑死，弹出失败重来。

## 🛠️ 第二部分：技术方案架构（全栈工业级实现）

为了支撑上述“丝滑、高容错、低延迟感”的 AI 交互，整个系统的底层由一个高内聚、轻量化的全栈解耦架构支撑：

Plaintext

```
 ┌─────────────────────────────────────────────────────────────┐
 │                     Tailwind CSS v4 HUD                     │
 └──────────────────────────────┬──────────────────────────────┘
                                ▼ 状态订阅
 ┌─────────────────────────────────────────────────────────────┐
 │                  src/game/survivalState.ts                  │
 │   - Global State: wood, knowledge, hunger, timeLeft         │
 └──────────────────────────────▲──────────────────────────────┘
                                │ 驱动数值更新
 ┌──────────────────────────────┴─────────────────────────────┐
 │                   src/api/divineCommand.ts                  │
 │   - Client-side Fetch & Runtime Schema Check                │
 └──────────────────────────────▲──────────────────────────────┘
                                │ 异步 POST /api/divine-command
 ┌──────────────────────────────┴─────────────────────────────┐
 │                    server/divineApi.js (Node)               │
 │   - DeepSeek Call (JSON Mode)                               │
 │   - Anti-Hallucination Prompt & Mock Fallback Trigger       │
 └─────────────────────────────────────────────────────────────┘
```

### 1. 行为契约与数据对称（`src/types.ts`）

通过严密的 TypeScript 类型，定义 AI 语义思维与 Phaser 游戏引擎之间的**绝对数据对称**。

TypeScript

```
export type NPCName = '阿强' | '阿珍' | '阿衰';
export type NPCAction = 'WALK_TO' | 'PLAY_ANIMATION' | 'SPEAK' | 'IDLE';
export type AnimationType = 'CHOP' | 'READ' | 'SLEEP' | 'IDLE';

export interface NPCCommand {
  npcName: NPCName;
  action: NPCAction;
  targetX?: number;
  targetY?: number;
  animationType?: AnimationType;
  bubbleText?: string;
}

export interface LLMResponse {
  eventName: string;
  commands: NPCCommand[];
  stateImpact: {
    woodDelta: number;
    knowledgeDelta: number;
    hungerDelta: number;
  };
}
```

### 2. 边缘反幻觉大模型路由（`server/divineApi.js`）

在 Node 端搭建极其强悍的 System Prompt 防线，开启 DeepSeek / OpenAI 的 **JSON Mode**，彻底压制 AI 吐出 Markdown 标签（如 ```json）的冲动，并内置重试与降级机制：

- **核心安全提示词（System Prompt 注入）：**

  > “你是一个 2D 沙盒游戏《Prompt创世纪》的后台神明意志解析引擎。当前场景包含 3 个 NPC：1. 阿强(擅长砍树[600,150]), 2. 阿珍(擅长读书[160,360]), 3. 阿衰(擅长竹榻睡觉[400,540])。请将玩家的模糊神谕合理拆解为这三个 NPC 的行动队列，并科学演算本次行动对全局资源的影响。符合特长则资源暴击，行动必耗饱食度。**你必须且只能输出符合 TypeScript 接口 `LLMResponse` 的纯 JSON 对象。绝对不能包含任何多余的解释、严禁包含任何 Markdown 标记。**”

- **高容错三道防线：**

  1. **服务端 Schema 强校验**：拦截并解析 DeepSeek 的返回。若字段缺失，立刻自动发起至多 2 次重新请求。
  2. **前端二次校验**：如果大模型在网络高并发下超时或欠费，前端 `api/divineCommand.ts` 捕获异常。
  3. **本地 Mock 降级（`mockFallback.js`）**：一旦前两道防线全破，立即启动轻量级本地关键词正则引擎（捕获“砍树/读书/睡”），吐出标准的本地 Mock JSON 结构，**确保游戏主循环绝对不断开，用户体验不降级**。

### 3. 异步 I/O 与 Phaser 同步渲染的解耦（`scenes/GameScene.ts`）

大模型响应通常有 1~2 秒延迟，为防止前端画面卡死，采用**外挂式事件驱动模型**：

- **主循环不挂起：** 玩家点击按钮后，前端仅改变 UI 为“思考中”，Phaser 的 `update()` 帧循环（60 FPS）依然正常跑。小人们在原地平滑地播放由 `proceduralArt.ts` 绘制的呼吸缩放动画。

- **Promise 异步命令队列管理：**

  当 `fetch` 成功拿到 `LLMResponse` 后，不直接生硬地修改小人坐标，而是将 `commands` 数组传入 `executeAICommands()` 函数：

  TypeScript

  ```
  // 核心伪代码：使用 Promise 链串联小人的长路径行为，不阻塞 Phaser
  async executeAICommands(commands: NPCCommand[]) {
    const promises = commands.map(cmd => {
      const npc = this.getNPCByName(cmd.npcName);
      return new Promise<void>((resolve) => {
        if (cmd.action === 'WALK_TO') {
          this.physics.moveTo(npc, cmd.targetX, cmd.targetY, 150);
          // 监听到达目的地事件后 resolve
          this.physics.add.overlap(npc, this.getTargetZone(cmd), () => {
            npc.body.reset(cmd.targetX, cmd.targetY);
            resolve();
          });
        } else {
          resolve();
        }
      }).then(() => {
        // 顺次执行播放动画和弹出气泡
        this.playProceduralAnim(npc, cmd.animationType);
        this.showSpeechBubble(npc, cmd.bubbleText);
      });
    });
    await Promise.all(promises);
  }
  ```

```
### 4. 纯代码程序化视觉架构（`scenes/proceduralArt.ts`）
通过操作 HTML5 Canvas 像素级材质和 Phaser Graphics API，完美绕过图片资产的加载加载延迟与版权问题，实现 **0KB 资产加载**：
*   **确定性噪点算法：** 利用简易的正弦哈希函数在 `(x, y)` 坐标生成固定不散乱的微小灰度值，直接在图层纹理上 `fillStyle` 绘制出水墨风宣纸的星星点点。
*   **程序化几何骨架：**
    *   通过 `graphics.fillRect` 和 `graphics.fillTriangle` 分层堆叠深绿色色块，生成国风水墨古松。
    *   通过 `graphics.beginPath()` 和 `arc` 贝塞尔曲线，现场计算并绘制出岭南镬耳墙那道优美的波浪弧线。
*   **数据驱动的粒子加剧：**
    在 Phaser 粒子发射器中，将发射速率（`frequency`）、重力（`gravityY`）与 `survivalState.timeLeft` 挂钩。倒计时越少，粒子发射越猛烈，无需额外动画序列包，纯靠数学计算拉满末日宿命感。

---

## 🎯 第三部分：总结

这是一个教科书般完美的 **AI-Native 微游戏开发原型**：
1.  它把 LLM 作为了核心的 **Gameplay 机制**，而不仅仅是一个聊天补丁；
2.  它在全栈架构上做到了**多层拦截、反幻觉和离线降级容灾**，具备工业级商业广告（Playable Ads）的极高稳定性；
3.  它在图形学上展现了极客式的**纯代码程序化渲染（Procedural Art）**，将性能与秒开率拉到了极限。

带着这份完美沉淀的方案与实现总结，你现在可以底气十足地向任何看重 AIGC、全栈开发及人机协作的团队发起冲锋了！
```