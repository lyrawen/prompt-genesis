import Phaser from 'phaser'
import type { AnimationType, LLMResponse, MapMutation, NPCCommand, NPCName, WorldEvent } from '../types'
import { playChop, playPageFlip, startSnore, stopSnore } from '../audio/soundManager'
import { MAP_LANDMARKS } from '../types'
import { INITIAL_TIME } from '../game/survivalState'
import {
  buildIslandTexture,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  drawBambooBedLandmark,
  drawCampfire,
  drawLibraryLandmark,
  drawPineLandmark,
  drawWoodpile,
  getWaterEdgeTiles,
  registerCharacterTextures,
  resetMutationCount,
  roleTextureKey,
  TILE,
  type NPCRole,
} from './proceduralArt'

/** Visual + physics bundle for one believer NPC. */
interface NPCRecord {
  name: NPCName
  role: NPCRole
  body: Phaser.Physics.Arcade.Image
  label: Phaser.GameObjects.Text
  readProp: Phaser.GameObjects.Rectangle | null
}

interface SecretDesire {
  npc: NPCName
  desireAction: AnimationType
  desireText: string
  hintDot: Phaser.GameObjects.Arc | null
  fulfilled: boolean
}

const WALK_SPEED = 120

/**
 * GameScene — procedural 新中式像素沙盒 + LLM command executor.
 *
 * All visuals are code-generated (zero external assets).
 * Async LLM I/O stays outside `update()`; motion via Physics / Tweens.
 */
export class GameScene extends Phaser.Scene {
  private npcs = new Map<NPCName, NPCRecord>()
  private commandQueue: Promise<void> = Promise.resolve()

  private waterEdgeGfx!: Phaser.GameObjects.Graphics
  private waterEdgeTiles: ReturnType<typeof getWaterEdgeTiles> = []
  /** Extra graphics layer for map mutations (campfire, woodpile, etc.). */
  private mutationGfx!: Phaser.GameObjects.Graphics
  /** Track applied mutations to prevent duplicates. */
  private appliedMutations: string[] = []
  /** 0: clear (>50s) | 1: early | 2: mid | 3: climax (<10s) — init -1 forces first apply */
  private floodPhase = -1
  private floodEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null

  private timeLeft = INITIAL_TIME
  private survivalActive = false
  private slackerResistance = 0
  /** Per-round secret desires — hints for the player. */
  private desires: SecretDesire[] = []

  /** Proactive behaviour timers (ms) — NPCs act on their own when timer hits 0. */
  private proactiveTimers: Map<NPCName, number> = new Map()
  private proactiveCooldowns: Map<NPCName, number> = new Map()
  /** True while a proactive action is running (player commands should interrupt). */
  private proactiveRunning = false

  constructor() {
    super({ key: 'GameScene' })
  }

  create(): void {
    this.buildProceduralWorld()
    this.spawnNPC('阿强', 'strongman', 160, 300)
    this.spawnNPC('阿珍', 'scholar', 400, 300)
    this.spawnNPC('阿衰', 'slacker', 640, 300)
    this.drawProceduralLandmarks()
    this.setupFloodSystem()
    this.generateSecretDesires()
    this.initProactiveTimers()
  }

  /** Initialise random proactive timers for each NPC. */
  private initProactiveTimers(): void {
    this.proactiveTimers.set('阿强', Phaser.Math.Between(8000, 15000))
    this.proactiveTimers.set('阿珍', Phaser.Math.Between(10000, 18000))
    this.proactiveTimers.set('阿衰', Phaser.Math.Between(5000, 10000))
    this.proactiveCooldowns.set('阿强', 0)
    this.proactiveCooldowns.set('阿珍', 0)
    this.proactiveCooldowns.set('阿衰', 0)
  }

  /** Generate random secret desires for each NPC this round. */
  private generateSecretDesires(): void {
    this.desires = []
    const candidates: { npc: NPCName; role: NPCRole; chance: number; action: AnimationType; text: string }[] = [
      { npc: '阿衰', role: 'slacker', chance: 0.3, action: 'SLEEP', text: '(打哈欠)' },
      { npc: '阿强', role: 'strongman', chance: 0.2, action: 'CHOP', text: '(盯着古松林)' },
      { npc: '阿珍', role: 'scholar', chance: 0.2, action: 'READ', text: '(摸着书卷)' },
    ]
    for (const c of candidates) {
      if (Math.random() < c.chance) {
        const npc = this.npcs.get(c.npc)
        if (!npc) continue
        const hintDot = this.add.circle(npc.body.x - 18, npc.body.y - 28, 3, 0xfbbf24).setDepth(12)
        this.desires.push({ npc: c.npc, desireAction: c.action, desireText: c.text, hintDot, fulfilled: false })
      }
    }
  }

  /* ── Proactive NPC Behaviours ────────────────────────── */

  private updateProactiveBehaviours(delta: number): void {
    for (const [name, npc] of this.npcs) {
      const remaining = (this.proactiveTimers.get(name) ?? 0) - delta
      this.proactiveTimers.set(name, remaining)

      if (remaining > 0) continue
      if (this.proactiveRunning) continue

      // Check cooldown: don't trigger again too soon
      const cd = this.proactiveCooldowns.get(name) ?? 0
      if (cd > 0) { this.proactiveCooldowns.set(name, cd - delta); continue }

      // Check NPC is idle (not walking, not animating)
      const body = npc.body.body as Phaser.Physics.Arcade.Body
      if (body.speed > 5) continue

      this.triggerProactiveAction(name, npc)
    }
  }

  private triggerProactiveAction(name: NPCName, npc: NPCRecord): void {
    this.proactiveRunning = true

    const actions: Record<string, { anim: AnimationType; targetX: number; targetY: number; text: string; impact: { w: number; k: number; h: number } }> = {
      '阿强': { anim: 'CHOP', targetX: 600, targetY: 150, text: '闲不住，砍点柴…', impact: { w: 1, k: 0, h: -2 } },
      '阿珍': { anim: 'READ', targetX: 160, targetY: 360, text: '趁有空翻几页书。', impact: { w: 0, k: 1, h: -1 } },
      '阿衰': { anim: 'SLEEP', targetX: 400, targetY: 540, text: '偷偷眯一会儿…', impact: { w: 0, k: 0, h: 3 } },
    }

    const a = actions[name]
    if (!a) { this.proactiveRunning = false; return }

    // Speak intention first
    this.showSpeechBubble(npc, a.text)

    // Walk to target
    this.cmdWalkTo(npc, a.targetX, a.targetY).then(() => {
      // Play animation
      return this.cmdPlayAnimation(npc, a.anim)
    }).then(() => {
      // Apply impact via registry
      const prev = this.registry.get('proactiveImpact') ?? { wood: 0, knowledge: 0, hunger: 0 }
      this.registry.set('proactiveImpact', {
        wood: (prev as any).wood + a.impact.w,
        knowledge: (prev as any).knowledge + a.impact.k,
        hunger: (prev as any).hunger + a.impact.h,
      })

      // Reset timer & short cooldown so they don't re-trigger immediately
      this.proactiveTimers.set(name, Phaser.Math.Between(12000, 25000))
      this.proactiveCooldowns.set(name, 5000)
      this.proactiveRunning = false
    })
  }

  /** Check if a command fulfills any secret desire. */
  private checkDesireFulfillment(npcName: NPCName, animationType?: AnimationType): void {
    for (const d of this.desires) {
      if (d.fulfilled || d.npc !== npcName) continue
      if (animationType === d.desireAction) {
        d.fulfilled = true
        if (d.hintDot) {
          d.hintDot.setFillStyle(0x22c55e) // green = fulfilled
          this.tweens.add({ targets: d.hintDot, alpha: 0, duration: 1000, delay: 500 })
        }
      }
    }
    this.syncDesireStats()
  }

  /** How many desires are fulfilled (for achievement check). */
  /** Sync desire stats to registry for main.ts achievement check. */
  private syncDesireStats(): void {
    this.registry.set('desireStats', {
      total: this.desires.length,
      fulfilled: this.desires.filter(d => d.fulfilled).length,
    })
  }

  getFulfilledDesireCount(): number {
    return this.desires.filter(d => d.fulfilled).length
  }

  getTotalDesireCount(): number {
    return this.desires.length
  }

  update(_time: number, delta: number): void {
    this.animateWaterEdges()
    this.syncCustomNames()
    this.handleBulletTime()
    if (this.survivalActive && !this.registry.get('bulletTime')) {
      this.updateProactiveBehaviours(delta)
      this.updateSocialDynamics()
    }
  }

  /** Emotional contagion: 阿衰's negativity slows 阿强 down when nearby. */
  private updateSocialDynamics(): void {
    const slackerResistance = this.slackerResistance
    if (slackerResistance <= 70) {
      this.registry.set('socialContagion', false)
      return
    }

    const qiang = this.npcs.get('阿强')
    const shuai = this.npcs.get('阿衰')
    if (!qiang || !shuai) return

    const dist = Phaser.Math.Distance.Between(qiang.body.x, qiang.body.y, shuai.body.x, shuai.body.y)
    this.registry.set('socialContagion', dist < 90)
  }

  private wasBulletTime = false

  private handleBulletTime(): void {
    const bt = !!this.registry.get('bulletTime')
    if (bt === this.wasBulletTime) return
    this.wasBulletTime = bt

    if (bt) {
      // Freeze: pause physics, particles, camera
      this.physics.world.pause()
      if (this.floodEmitter) {
        this.floodEmitter.pause()
        // Store current particle config to restore later
      }
      // Blue tint overlay
      this.cameras.main.setAlpha(0.92)
    } else {
      // Unfreeze
      this.physics.world.resume()
      if (this.floodEmitter) this.floodEmitter.resume()
      this.cameras.main.setAlpha(1)
    }
  }

  /** Check registry for custom NPC names and update labels. */
  private syncCustomNames(): void {
    for (const n of ['阿强', '阿珍', '阿衰'] as NPCName[]) {
      const custom = this.registry.get(`npcName_${n}`) as string | undefined
      if (custom && custom !== n) {
        const npc = this.npcs.get(n)
        if (npc && npc.label.text !== custom) npc.label.setText(custom)
      }
    }
  }

  /** Sync survival clock — also drives flood phase transitions (NOT in update loop). */
  updateSurvivalPressure(timeLeft: number, active: boolean, slackerResistance = 0): void {
    this.timeLeft = timeLeft
    this.survivalActive = active
    this.slackerResistance = slackerResistance
    this.registry.set('timeLeft', timeLeft)
    this.checkFloodPhaseTransition()
  }

  /** Called when player casts a divine command — crisis camera shake.
   *  Last 10 seconds: intense shake for tactical stress. */
  onDivineCommandCast(): void {
    if (this.survivalActive && this.timeLeft <= 10 && this.timeLeft > 0) {
      this.cameras.main.shake(300, 0.012)
    }
  }

  /** Apply a map mutation (campfire, woodpile, etc.) */
  applyMapMutation(mutation: MapMutation): void {
    const key = `${mutation.type}-${mutation.target}`
    if (this.appliedMutations.includes(key)) return
    this.appliedMutations.push(key)
    console.info('[MapMutation]', mutation.type, mutation.target, mutation.description)

    const descriptions: Record<string, string> = {
      BUILD: '🔥 篝火在营地附近燃起',
      GROW_TREE: '🌱 一棵新树在草地生长',
      CHOP_TREE: '🪓 古松林传来树木倒下的声响',
      BURN: '🔥 火焰吞没了一片林地',
    }
    const desc = descriptions[mutation.type] ?? '🏗️ 世界发生了变化'
    this.registry.set('worldMutation', { type: mutation.type, description: desc })

    switch (mutation.type) {
      case 'BUILD':
        drawCampfire(this.mutationGfx)
        break
      case 'GROW_TREE':
        drawPineLandmark(this.mutationGfx, 80 + this.appliedMutations.length * 20, 420)
        break
      case 'CHOP_TREE':
        this.mutationGfx.fillStyle(0x4a3528, 0.4)
        this.mutationGfx.fillRect(580, 140, 40, 40)
        break
      case 'BURN':
        this.mutationGfx.fillStyle(0x2a1a10, 0.6)
        this.mutationGfx.fillRect(580, 140, 50, 50)
        break
      default:
        drawWoodpile(this.mutationGfx)
        break
    }
  }

  executeAICommands(response: LLMResponse): void {
    console.info('[Prompt Genesis] event:', response.eventName, response.commands)
    this.onDivineCommandCast()

    if (response.mapMutation) {
      this.applyMapMutation(response.mapMutation)
    }

    // Player command resets proactive timers
    this.proactiveTimers.set('阿强', Phaser.Math.Between(12000, 25000))
    this.proactiveTimers.set('阿珍', Phaser.Math.Between(12000, 25000))
    this.proactiveTimers.set('阿衰', Phaser.Math.Between(12000, 25000))
    this.proactiveCooldowns.set('阿衰', 8000) // Extra cooldown so 阿衰 doesn't wander off right after being told to work

    this.commandQueue = this.commandQueue
      .then(() => this.runCommandBatch(response.commands))
      .catch((err) => { console.error('[CommandQueue] batch failed, resetting queue', err); this.proactiveRunning = false })

    // Fire world event if present
    if (response.worldEvent) {
      this.onWorldEvent(response.worldEvent)
    }
  }

  /** Handle a narrative world event — visual + camera FX. */
  onWorldEvent(event: WorldEvent): void {
    console.info('[Prompt Genesis] world event:', event.type, event.narrative)

    switch (event.type) {
      case 'STORM':
        this.cameras.main.flash(400, 80, 80, 100, true)
        this.cameras.main.shake(300, 0.006)
        break
      case 'FLOOD_SURGE':
        this.cameras.main.shake(500, 0.008)
        break
      case 'SUPPLY_CACHE':
      case 'FIND_SUPPLIES':
        this.cameras.main.flash(300, 255, 255, 200, true)
        break
      case 'RAIN':
        this.cameras.main.shake(200, 0.003)
        break
      case 'MOONLIGHT':
        this.cameras.main.flash(600, 200, 220, 255, true)
        break
      case 'DROUGHT':
      case 'WILD_BOAR':
        this.cameras.main.shake(250, 0.005)
        this.cameras.main.flash(300, 150, 50, 50, true)
        break
    }
  }

  /** Show mood emoji above NPC — matches personality system. */
  showNPCMood(npc: NPCRecord, animationType?: string): void {
    const moodMap: Record<string, string> = {
      strongman_CHOP: '💪',
      strongman_READ: '😩',
      strongman_SLEEP: '😤',
      scholar_READ: '🧠',
      scholar_CHOP: '😩',
      scholar_SLEEP: '😑',
      slacker_SLEEP: '😌',
      slacker_CHOP: '😅',
      slacker_READ: '😵',
    }

    const key = `${npc.role}_${animationType ?? 'IDLE'}`
    const emoji = moodMap[key]
    if (!emoji) return

    const moodText = this.add
      .text(npc.body.x + 18, npc.body.y - 44, emoji, {
        fontSize: '14px',
      })
      .setOrigin(0.5)
      .setDepth(11)

    this.tweens.add({
      targets: moodText,
      alpha: 0,
      y: moodText.y - 18,
      duration: 1600,
      ease: 'Sine.easeOut',
      onComplete: () => moodText.destroy(),
    })
  }

  showSpeechBubble(npc: NPCRecord, text: string): void {
    const bubble = this.add
      .text(npc.body.x, npc.body.y - 44, text, {
        fontFamily: '"Segoe UI", sans-serif',
        fontSize: '12px',
        color: '#2c4a5e',
        backgroundColor: '#F5F2EBee',
        padding: { x: 8, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(10)

    // Follow the NPC while walking
    const sync = (): void => {
      if (bubble.active) {
        bubble.setPosition(npc.body.x, npc.body.y - 44)
      }
    }
    this.events.on('update', sync)

    this.tweens.add({
      targets: bubble,
      y: bubble.y - 10,
      duration: 300,
      ease: 'Sine.easeOut',
    })

    this.time.delayedCall(3000, () => {
      this.events.off('update', sync)
      bubble.destroy()
    })
  }

  // ---------------------------------------------------------------------------
  // Procedural world
  // ---------------------------------------------------------------------------

  private buildProceduralWorld(): void {
    registerCharacterTextures(this)
    buildIslandTexture(this)

    this.add
      .image(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 'island-base')
      .setDepth(-3)

    this.waterEdgeTiles = getWaterEdgeTiles()
    this.waterEdgeGfx = this.add.graphics().setDepth(-1)
    this.mutationGfx = this.add.graphics().setDepth(0)
    resetMutationCount()
    this.appliedMutations = []
  }

  private animateWaterEdges(): void {
    const wave = 0.35 + Math.sin(this.time.now / 480) * 0.2
    this.waterEdgeGfx.clear()

    for (const tile of this.waterEdgeTiles) {
      this.waterEdgeGfx.lineStyle(2, 0x3d6278, wave)
      this.waterEdgeGfx.strokeRect(tile.x + 1, tile.y + 1, TILE - 2, TILE - 2)

      this.waterEdgeGfx.fillStyle(0x4a7a94, wave * 0.35)
      this.waterEdgeGfx.fillRect(tile.x + TILE / 2 - 2, tile.y + 4, 4, 2)
    }
  }

  private drawProceduralLandmarks(): void {
    const g = this.add.graphics().setDepth(0)
    const { forest, library, camp } = MAP_LANDMARKS

    drawPineLandmark(g, forest.x, forest.y + 8)
    drawLibraryLandmark(g, library.x, library.y - 8)
    drawBambooBedLandmark(g, camp.x, camp.y - 12)

    for (const lm of [forest, library, camp]) {
      this.add
        .text(lm.x, lm.y + 28, lm.label, {
          fontFamily: '"Segoe UI", sans-serif',
          fontSize: '11px',
          color: '#f5f0e6',
          stroke: '#2c4a5e',
          strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setDepth(1)
        .setAlpha(0.85)
    }
  }

  // ---------------------------------------------------------------------------
  // Flood ink storm — State Change Guard + createCanvas texture + emitZone
  // ---------------------------------------------------------------------------

  private ensureInkDropTexture(): void {
    const key = 'inkDrop'
    if (this.textures.exists(key)) this.textures.remove(key)

    const canvasTex = this.textures.createCanvas(key, 8, 8)
    if (!canvasTex) {
      console.error('[Flood System] createCanvas failed for inkDrop')
      return
    }

    const ctx = canvasTex.context
    ctx.clearRect(0, 0, 8, 8)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 8, 8)
    canvasTex.refresh()
  }

  private setupFloodSystem(): void {
    this.ensureInkDropTexture()

    if (!this.textures.exists('inkDrop')) {
      console.error('[Flood System] inkDrop texture missing — aborting emitter')
      return
    }

    this.registry.set('timeLeft', INITIAL_TIME)

    // Spawn band across full canvas width, slightly above the viewport
    const rainBand = new Phaser.Geom.Rectangle(0, -20, CANVAS_WIDTH, 30)

    this.floodEmitter = this.add.particles(0, 0, 'inkDrop', {
      frame: '__BASE',
      lifespan: { min: 2500, max: 6000 },
      angle: { min: 88, max: 92 },
      speed: { min: 30, max: 70 },
      gravityY: 100,
      scale: { start: 0.8, end: 1.4 },
      alpha: { start: 0.85, end: 0.15 },
      tint: 0x1a1a2e,
      frequency: 1000,
      quantity: 1,
      maxParticles: 2000,
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: true,
    })

    this.floodEmitter.addEmitZone({
      type: 'random',
      source: rainBand,
    } as Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig)

    this.floodEmitter
      .setDepth(2000)
      .setScrollFactor(0)
      .setVisible(true)

    this.children.bringToTop(this.floodEmitter)

    // Force initial phase apply + sanity burst so ink is visible immediately
    this.floodPhase = -1
    this.checkFloodPhaseTransition()
    this.floodEmitter.explode(20)

    console.log('[Flood System] Emitter ready — inkDrop texture + emitZone active')
  }

  private resolveFloodPhase(timeLeft: number): number {
    if (timeLeft <= 10) return 3
    if (timeLeft <= 30) return 2
    if (timeLeft <= 50) return 1
    return 0
  }

  /** Only touch emitter ops when phase threshold crossed — never every frame. */
  private checkFloodPhaseTransition(): void {
    if (!this.floodEmitter) return

    const timeLeft =
      this.registry.get('timeLeft') !== undefined
        ? (this.registry.get('timeLeft') as number)
        : this.timeLeft

    const targetPhase = this.resolveFloodPhase(timeLeft)
    if (this.floodPhase === targetPhase) return

    this.floodPhase = targetPhase
    this.applyFloodPhase(targetPhase)
  }

  /** Reconfigure emitter once per phase — no updateConfig (preserves emitZone). */
  private applyFloodPhase(phase: number): void {
    const em = this.floodEmitter
    if (!em) return

    switch (phase) {
      case 0:
        em.setFrequency(1000, 1)
        em.speed = { min: 30, max: 70 }
        em.gravityY = 80
        break
      case 1:
        em.setFrequency(300, 1)
        em.speed = { min: 60, max: 140 }
        em.gravityY = 120
        break
      case 2:
        em.setFrequency(100, 1)
        em.speed = { min: 120, max: 220 }
        em.gravityY = 220
        break
      case 3:
        em.setFrequency(30, 3)
        em.speed = { min: 200, max: 450 }
        em.gravityY = 450
        em.explode(30)
        break
    }

    if (!em.on) em.start()

    console.log(
      `[Flood System] Phase → ${phase} | freq=${phase === 0 ? 1000 : phase === 1 ? 300 : phase === 2 ? 100 : 30}ms | alive=${em.getAliveParticleCount()}`,
    )
  }

  // ---------------------------------------------------------------------------
  // NPCs
  // ---------------------------------------------------------------------------

  private spawnNPC(name: NPCName, role: NPCRole, x: number, y: number): void {
    const body = this.physics.add
      .image(x, y, roleTextureKey(role))
      .setDepth(4)

    const physicsBody = body.body as Phaser.Physics.Arcade.Body
    physicsBody.setSize(24, 28)
    physicsBody.setOffset(6, 6)
    physicsBody.setCollideWorldBounds(true)

    const label = this.add
      .text(x, y - 26, name, {
        fontFamily: '"Segoe UI", sans-serif',
        fontSize: '13px',
        color: '#f5f0e6',
        stroke: '#2c4a5e',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(6)

    const readProp =
      role === 'scholar'
        ? this.add
            .rectangle(x + 14, y + 2, 8, 12, 0xf5f0e6, 1)
            .setStrokeStyle(1, 0x2c4a5e)
            .setDepth(5)
            .setVisible(false)
        : null

    if (role === 'slacker') {
      this.tweens.add({
        targets: body,
        scaleY: 0.92,
        scaleX: 1.04,
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      })
    }

    this.npcs.set(name, { name, role, body, label, readProp })
  }

  private syncNPCVisuals(npc: NPCRecord): void {
    npc.label.setPosition(npc.body.x, npc.body.y - 26)
    if (npc.readProp) {
      npc.readProp.setPosition(npc.body.x + 14, npc.body.y + 2)
    }
  }

  // ---------------------------------------------------------------------------
  // Command pipeline
  // ---------------------------------------------------------------------------

  /** Group by NPC and run each NPC's sequence in parallel — "三人同时调头" */
  private async runCommandBatch(commands: NPCCommand[]): Promise<void> {
    const byNPC = new Map<NPCName, NPCCommand[]>()
    for (const cmd of commands) {
      const list = byNPC.get(cmd.npcName) ?? []
      list.push(cmd)
      byNPC.set(cmd.npcName, list)
    }

    await Promise.all(
      Array.from(byNPC.values()).map(seq => this.runNPCSquence(seq)),
    )
  }

  private async runNPCSquence(commands: NPCCommand[]): Promise<void> {
    for (const cmd of commands) {
      await this.executeSingleCommand(cmd)
    }
  }

  private executeSingleCommand(command: NPCCommand): Promise<void> {
    const npc = this.npcs.get(command.npcName)
    if (!npc) {
      console.warn(`[Prompt Genesis] Unknown NPC: ${command.npcName}`)
      return Promise.resolve()
    }

    switch (command.action) {
      case 'WALK_TO':
        return this.cmdWalkTo(npc, command.targetX ?? npc.body.x, command.targetY ?? npc.body.y)
      case 'SPEAK':
        return this.cmdSpeak(npc, command.bubbleText ?? '……')
      case 'PLAY_ANIMATION':
        return this.cmdPlayAnimation(npc, command.animationType ?? 'IDLE')
      case 'IDLE':
        return this.cmdIdle(npc)
      default:
        return Promise.resolve()
    }
  }

  private cmdWalkTo(npc: NPCRecord, targetX: number, targetY: number): Promise<void> {
    const WALK_TIMEOUT_MS = 10_000
    // 阿衰 walks slower when resistance is high
    let speed = npc.name === '阿衰' ? WALK_SPEED * (1 - this.slackerResistance * 0.004) : WALK_SPEED
    // Relationship boost: friends walk faster, rivals walk slower
    const rel = this.registry.get('relationships') as Record<string, number> | undefined
    if (rel) {
      for (const [key, val] of Object.entries(rel)) {
        if (key.includes(npc.name) && val > 50) speed *= 1.15
        else if (key.includes(npc.name) && val < -30) speed *= 0.85
      }
    }

    return new Promise((resolve) => {
      const body = npc.body.body as Phaser.Physics.Arcade.Body
      this.physics.moveTo(npc.body, targetX, targetY, speed)

      const arrived = (): void => {
        body.setVelocity(0, 0)
        npc.body.setPosition(targetX, targetY)
        this.syncNPCVisuals(npc)
      }

      const timeout = this.time.delayedCall(WALK_TIMEOUT_MS, () => {
        this.events.off('update', checkArrival)
        arrived()
        resolve()
      })

      const checkArrival = (): void => {
        const dist = Phaser.Math.Distance.Between(npc.body.x, npc.body.y, targetX, targetY)
        this.syncNPCVisuals(npc)

        if (dist < 6) {
          timeout.remove()
          this.events.off('update', checkArrival)
          arrived()
          resolve()
        }
      }

      this.events.on('update', checkArrival)
    })
  }

  private cmdSpeak(npc: NPCRecord, text: string): Promise<void> {
    this.showSpeechBubble(npc, text)
    return this.delay(400)
  }

  private cmdPlayAnimation(npc: NPCRecord, animationType: AnimationType): Promise<void> {
    // Show mood emoji based on personality + activity match
    this.showNPCMood(npc, animationType)
    // Check if this animation fulfills a secret desire
    this.checkDesireFulfillment(npc.name, animationType)

    return new Promise((resolve) => {
      const type = animationType.toUpperCase() as AnimationType

      if (type === 'SLEEP') {
        startSnore()
        this.tweens.add({
          targets: npc.body,
          scaleY: 0.45,
          y: npc.body.y + 12,
          duration: 600,
          ease: 'Bounce.easeOut',
          onUpdate: () => this.syncNPCVisuals(npc),
          onComplete: () => {
            stopSnore()
            resolve()
          },
        })
        return
      }

      if (type === 'CHOP') {
        let strikes = 0
        const chop = (): void => {
          playChop()
          this.tweens.add({
            targets: npc.body,
            angle: strikes % 2 === 0 ? -22 : 22,
            duration: 110,
            yoyo: true,
            onComplete: () => {
              strikes += 1
              if (strikes < 4) chop()
              else {
                npc.body.setAngle(0)
                resolve()
              }
            },
          })
        }
        chop()
        return
      }

      if (type === 'READ') {
        stopSnore()
        playPageFlip()
        npc.readProp?.setVisible(true)
        this.tweens.add({
          targets: npc.body,
          y: npc.body.y - 12,
          duration: 600,
          yoyo: true,
          repeat: 2,
          ease: 'Sine.easeInOut',
          onRepeat: () => playPageFlip(),
          onUpdate: () => this.syncNPCVisuals(npc),
          onComplete: () => {
            npc.readProp?.setVisible(false)
            resolve()
          },
        })
        return
      }

      stopSnore()
      this.tweens.add({
        targets: npc.body,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 200,
        yoyo: true,
        onComplete: () => resolve(),
      })
    })
  }

  private cmdIdle(npc: NPCRecord): Promise<void> {
    stopSnore()
    const body = npc.body.body as Phaser.Physics.Arcade.Body
    body.setVelocity(0, 0)
    npc.readProp?.setVisible(false)
    return Promise.resolve()
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, () => resolve())
    })
  }
}

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  parent: 'game-container',
  backgroundColor: '#F5F2EB',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scene: [GameScene],
}
