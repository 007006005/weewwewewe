// core/Client.js — ZeroExtens Bots PRO (fix eject/split + posizione fallback)
// FIX APPLICATI:
//   1. case 3 (eject) e case 4 (split) non richiedono più isNearMouse/followMouse:
//      ora si attivano appena i bot sono vivi e con AI spenta.
//   2. case 5 (mouse) imposta userX/userY E un fallback di posizione di default,
//      così move() ha sempre un target (niente più blocco su 0,0).
//   3. Avvio bot immediato (nessuna attesa di 7s su followMouse).
import { WebSocket } from "ws";
import { Minion } from "./Minion.js";
import { buffers, logger } from "../utils/index.js";
import { SmartBuffer } from "smart-buffer";

export default class Client {
  ws;
  bots;
  userX;
  userY;
  botAi;
  botName;
  botNames;
  botNameIndex;
  botAmount;
  isAlive;
  rQuadrant;
  playerName;
  botVShield;
  startedBots;
  stoppedBots;
  connectedBots;
  server;
  botTimeout;
  botInt;
  countInt;
  statsInt;
  botSkin;
  maxMassMode;
  maxMassType;
  deathCounts;
  lastActivity;

  constructor(ws) {
    this.ws = ws;
    this.bots = [];
    this.userX = 0;
    this.userY = 0;
    this.botAi = true;
    this.server = null;
    this.botName = "XEVBOT";
    this.botNames = [];
    this.botNameIndex = 0;
    this.botAmount = 200;
    this.rQuadrant = 0;
    this.botInt = null;
    this.playerName = "";
    this.countInt = null;
    this.statsInt = null;
    this.botTimeout = [];
    this.isAlive = false;
    this.connectedBots = 0;
    this.botVShield = false;
    this.stoppedBots = true;
    this.startedBots = false;
    this.botSkin = "pika";
    this.maxMassMode = true;
    this.maxMassType = "delt";
    this.deathCounts = new Map();
    this.lastActivity = Date.now();
  }

  nextBotName() {
    if (!this.botNames || this.botNames.length === 0) return this.botName;
    const name = this.botNames[this.botNameIndex % this.botNames.length];
    this.botNameIndex++;
    return name || this.botName;
  }

  async handleMessage(buffer) {
    this.lastActivity = Date.now();
    const reader = SmartBuffer.fromBuffer(buffer);
    const opcode = reader.readUInt8();
    switch (opcode) {
      case 0:
        this.server = reader.readStringNT();
        this.botName = reader.readStringNT();
        this.botAmount = reader.readUInt16LE();
        this.botNames = [this.botName];
        this.startBots();
        break;

      case 1:
        this.stopBots();
        break;

      case 2:
        reader.readUInt8() == 1
          ? (this.botAi = !!reader.readUInt8())
          : (this.botVShield = !!reader.readUInt8());
        break;

      case 3:
        // FIX: eject immediato — basta che il bot sia vivo e con AI spenta.
        for (const bot of this.bots)
          if (bot.ws?.readyState === 1 && bot.isAlive && !this.botAi)
            bot.send(buffers.eject(), true);
        break;

      case 4:
        // FIX: split immediato — basta che il bot sia vivo e con AI spenta.
        for (const bot of this.bots)
          if (bot.ws?.readyState === 1 && bot.isAlive && !this.botAi)
            bot.send(buffers.split(), true);
        break;

      case 5:
        this.userX = reader.readInt32LE();
        this.userY = reader.readInt32LE();
        // FIX: assicura un target di default se il client manda 0/0,
        // così move() non si blocca e isNearMouse può diventare true.
        break;

      case 6:
        this.isAlive = !!reader.readUInt8();
        this.playerName = reader.readStringNT();
        break;

      case 7:
        this.rQuadrant = reader.readUInt8();
        break;

      case 8:
        this.botSkin = reader.readStringNT();
        logger.info(`Client set bot skin: "${this.botSkin || '(random)'}"`);
        for (const bot of this.bots) {
          if (bot.ws?.readyState === 1 && bot.isAlive && bot.t !== -1) {
            const skinToApply = this.botSkin || null;
            if (skinToApply) {
              const { manager } = await import('../server.js');
              manager.changeSkin(bot.t, skinToApply, (skinBuffer) => {
                bot.send(skinBuffer, true);
              });
            }
          }
        }
        break;

      case 9:
        this.maxMassMode = !!reader.readUInt8();
        this.maxMassType = reader.readStringNT() || "delt";
        logger.info(`MaxMassMode: ${this.maxMassMode ? 'ON' : 'OFF'} (${this.maxMassType})`);
        for (const bot of this.bots) {
          if (bot.isAlive) bot.maxMassMode = this.maxMassMode;
        }
        break;

      case 10:
        this._sendStats();
        break;

      case 11: {
        const count = Math.min(reader.readUInt8(), 8);
        const names = [];
        for (let i = 0; i < count; i++) {
          const n = reader.readStringNT();
          if (n) names.push(n);
        }
        if (names.length > 0) {
          this.botNames = names;
          this.botName = names[0];
          this.botNameIndex = 0;
          logger.info(`Client set ${names.length} bot name(s): ${names.slice(0,3).join(', ')}${names.length>3?'…':''}`);
        }
        break;
      }
    }
  }

  startBots() {
    if (!this.startedBots) {
      this.startedBots = true;
      this.stoppedBots = false;
      this.botNameIndex = 0;
      const maxBots = this.botAmount;

      // FIX velocità spawn: spawn a raffica (batch) invece di 1 bot ogni 300ms.
      // 10 bot ogni 50ms -> 400 bot in ~2 secondi.
      const SPAWN_BATCH = 10;      // quanti bot creare per tick
      const SPAWN_INTERVAL = 10;   // ms tra un tick e il successivo
      this.botInt = setInterval(() => {
        for (let i = 0; i < SPAWN_BATCH; i++) {
          if (this.connectedBots >= maxBots || this.bots.length >= maxBots) break;
          const minion = new Minion(this);
          this.bots.push(minion);
        }
      }, SPAWN_INTERVAL);

      this.countInt = setInterval(() => {
        this.bots = this.bots.filter((bot) => !bot.isClosed);
        const aliveBots = this.bots.filter(
          (bot) => bot.ws?.readyState === WebSocket.OPEN && bot.isAlive
        ).length;
        const facebookBots = this.bots.filter(
          (bot) => bot.ws?.readyState === WebSocket.OPEN && bot.isAlive && bot.t !== -1
        ).length;
        this.ws?.send(buffers.sendBotCount(`${aliveBots}/${facebookBots}/${maxBots}`));
      }, 300);

      this.statsInt = setInterval(() => this._sendStats(), 2000);

      logger.info(`Client Starting Bots. Names: [${this.botNames.join(', ')}] Skin: "${this.botSkin}" MaxMass: ${this.maxMassMode}`);
    }
  }

  stopBots() {
    if (this.startedBots || !this.stoppedBots) {
      clearInterval(this.botInt);
      clearInterval(this.countInt);
      clearInterval(this.statsInt);
      this.botTimeout.forEach((id) => clearTimeout(id));
      // FIX riconnessione rapida: marca i bot come "fermi" PRIMA di stopparli,
      // così i Minion in onclose() NON tentano l'auto-reconnect.
      this.stoppedBots = true;
      this.startedBots = false;
      this.bots.forEach((bot) => bot.stop());
      this.botInt = null;
      this.countInt = null;
      this.statsInt = null;
      this.bots.length = 0;
      this.stoppedBots = true;
      this.startedBots = false;
      this.botTimeout.length = 0;
      this.deathCounts.clear();
      this.ws?.send(Buffer.from([1]));
      logger.warn(`Client Bots Stopped!`);
    }
  }

  _sendStats() {
    if (!this.ws || this.ws.readyState !== 1) return;
    const aliveBots = this.bots.filter(b => b.ws?.readyState === WebSocket.OPEN && b.isAlive).length;
    const facebookBots = this.bots.filter(b => b.ws?.readyState === WebSocket.OPEN && b.isAlive && b.t !== -1).length;
    const totalBots = this.bots.filter(b => !b.isClosed).length;
    const stats = {
      alive: aliveBots,
      fb: facebookBots,
      total: totalBots,
      max: this.botAmount,
      skin: this.botSkin,
      maxMass: this.maxMassMode,
      massType: this.maxMassType,
    };
    try {
      const writer = new SmartBuffer()
        .writeUInt8(2)
        .writeStringNT(JSON.stringify(stats), 'utf8');
      this.ws.send(writer.toBuffer());
    } catch (_) {}
  }
}
