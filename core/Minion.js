// core/Minion.js — ZeroExtens Bots PRO (fix token + followMouse immediato)
// FIX APPLICATI:
//   1. Riferimenti 'this.token' → 'this.t' (il campo si chiamava 't', non 'token').
//      Senza questo fix, eject/split/massBoost fallivano con TypeError silenziosi.
//   2. followMouse = true SUBITO allo spawn (rimosso il ritardo di 7 secondi).
//      Prima: per 7s i bot non seguivano il mouse → eject/split sembravano morti.
//   3. isNearMouse calcolato con soglia più generosa.
import WebSocket from "ws";
import Entity from "./Entity.js";
import { manager } from "../server.js";
import { SmartBuffer } from "smart-buffer";
import { buffers, helper, logger } from "../utils/index.js";
import { config } from "../config/index.js";

export class Minion {
  t;
  ws;
  rX;
  rY;
  client;
  isAlive;
  proxyAgent;
  offsetX;
  offsetY;
  borderX;
  borderY;
  isClosed;
  ownCells;
  gameModeInt;
  playerCells;
  followMouse;
  isConnected;
  isNearMouse;
  encryptionKey;
  decryptionKey;
  mapOffsetFixed;
  moveInterval;
  errorTimeout;
  myCellIds;
  followMouseTimeout;
  spawnTimeout;
  maxMassMode;
  deathCount;
  reconnectAttempts;
  reconnectTimeout;

  constructor(client) {
    this.ws = null;
    this.rX = 1;
    this.rY = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.borderX = 0;
    this.borderY = 0;
    this.myCellIds = {};
    this.ownCells = [];
    this.moveInterval = null;
    this.t = manager.t();
    this.client = client;
    this.isAlive = false;
    this.isClosed = false;
    this.gameModeInt = -1;
    this.playerCells = [];
    this.encryptionKey = 0;
    this.decryptionKey = 0;
    this.followMouse = false;
    this.errorTimeout = null;
    this.spawnTimeout = null;
    this.reconnectTimeout = null;
    this.isConnected = false;
    this.isNearMouse = false;
    this.mapOffsetFixed = false;
    this.followMouseTimeout = null;
    this.proxyAgent = helper.getProxy();
    this.maxMassMode = client.maxMassMode || true;
    this.deathCount = 0;
    this.reconnectAttempts = 0;
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.client.server, {
      agent: this.proxyAgent,
      headers: helper.generateHeaders(),
      rejectUnauthorized: true,
    });
    this.ws.binaryType = "nodebuffer";
    this.ws.onopen = this.onopen.bind(this);
    this.ws.onclose = this.onclose.bind(this);
    this.ws.onerror = this.onerror.bind(this);
    this.ws.onmessage = this.onmessage.bind(this);
  }

  send(buffer, encrypt = true) {
    if (!this.ws) return;
    encrypt && (buffer = helper.xorBuffer(buffer, this.encryptionKey));
    this.encryptionKey &&
      (this.encryptionKey = helper.rotateKey(this.encryptionKey));
    if (this.ws.readyState === 1) this.ws.send(buffer);
  }

  onopen() {
    this.reconnectAttempts = 0;
    this.send(buffers.protocolVersion());
    this.send(buffers.protocolKey());
  }

  onclose() {
    this.isClosed = true;
    this.client.connectedBots--;
    if (this.t !== -1) {
      manager.releaseToken(this.t, () => {
        this.t = -1;
      });
    }
    if (
      config.facebookBotSettings.autoReconnect &&
      !this.client.stoppedBots &&
      this.reconnectAttempts < (config.facebookBotSettings.maxReconnectAttempts || 10)
    ) {
      const delay = Math.min(
        config.facebookBotSettings.reconnectDelay * Math.pow(2, this.reconnectAttempts),
        30000
      );
      this.reconnectAttempts++;
      this.isClosed = false;
      logger.info(`Minion reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
      this.reconnectTimeout = setTimeout(() => {
        this.mapOffsetFixed = false;
        this.encryptionKey = 0;
        this.decryptionKey = 0;
        this.proxyAgent = helper.getProxy();
        this.t = manager.t();
        this.connect();
      }, delay);
    }
  }

  onerror() {
    this.isClosed = true;
    this.clearTimeouts();
    this.clearIntervals();
    this.errorTimeout = setTimeout(() => {
      if (
        this.ws?.readyState === WebSocket.CONNECTING ||
        this.ws?.readyState === WebSocket.OPEN
      ) {
        this.ws.close();
      }
    }, 1000);
  }

  onmessage({ data: buffer }) {
    let processedBuffer = buffer;
    if (this.decryptionKey) {
      processedBuffer = helper.xorBuffer(processedBuffer, this.decryptionKey ^ 31128);
    }
    this.handleBuffer(processedBuffer);
  }

  handleBuffer(buffer) {
    const reader = SmartBuffer.fromBuffer(buffer);
    const messageType = reader.readUInt8();
    switch (messageType) {
      case 18:
        this.myCellIds = {};
        this.ownCells = [];
        this.playerCells = [];
        break;

      case 32: {
        const cellId = reader.readUInt32LE();
        this.myCellIds[cellId] = cellId;
        if (!this.isAlive) {
          this.isAlive = true;
          this.moveInterval = setInterval(() => this.move(), 40);
          if (!this.client.startedBots && !this.client.stoppedBots) {
            this.client.startedBots = true;
            logger.info("Bots started.");
          }
          // FIX: seguiamo il mouse SUBITO, nessun ritardo di 7s.
          this.followMouse = true;
          if (this.t !== -1) {
            manager.requestLogin(this.t, (loginBuffer) => {
              this.send(loginBuffer, true);
            });
          }
          if (this.maxMassMode && this.t !== -1) {
            this._applyMaxMass();
          }
        }
        break;
      }

      case 69:
        this.ghostCells(reader);
        break;

      case 85:
        logger.info("Mass boost activated");
        break;

      case 103:
        this.useMassBoost();
        manager.buyMassBoost(this.t, (massBoostBuffer) => {
          this.send(massBoostBuffer, true);
        });
        break;

      case 104:
        manager.releaseToken(this.t, () => {
          this.t = -1;
        });
        break;

      case 241: {
        this.isConnected = true;
        this.client.connectedBots++;
        if (!this.client.server) break;
        this.decryptionKey = reader.readUInt32LE();
        const serverMatch = this.client.server.match(
          /wss:\/\/(web-arenas-live-[\w-]+\.agario\.miniclippt\.com\/[\w-]+\/[\d-]+)/
        );
        if (serverMatch && serverMatch[1]) {
          this.encryptionKey = helper.murmur2(
            "" + serverMatch[1] + reader.readStringNT("utf-8"),
            255
          );
        }
        break;
      }

      case 242: {
        const nameToSpawn = this.client.nextBotName();
        this.send(buffers.spawn(nameToSpawn), true);
        break;
      }

      case 255:
        this.handleMessage(
          helper.uncompressBuffer(
            reader.toBuffer().subarray(5),
            Buffer.alloc(reader.readUInt32LE())
          )
        );
        break;
    }
  }

  _applyMaxMass() {
    if (this.t === -1) return;
    manager.buyMassBoost(this.t, (massBoostBuffer) => {
      this.send(massBoostBuffer, true);
    });
    manager.setMassBoostExpire(this.t, (expireBuffer) => {
      this.send(expireBuffer, true);
    });
    logger.info(`MaxMass boost applied on spawn`);
  }

  useMassBoost() {
    const currentTime = Date.now();
    const accountName = manager.ut[this.t]?.name;
    if (!accountName) return;
    const massBoostExpire = helper.getMassBoostExpire(accountName);
    if (massBoostExpire && currentTime < massBoostExpire) return;
    if (config.facebookBotSettings.useMassBoost && this.t !== -1) {
      manager.buyMassBoost(this.t, (buyBuffer) => {
        this.send(buyBuffer, true);
      });
      manager.setMassBoostExpire(this.t, (expireBuffer) => {
        this.send(expireBuffer, true);
      });
      helper.clearExpiredMassBoosts();
      helper.setMassBoostExpire(accountName, currentTime + 60 * 60 * 1000);
      logger.info("Mass boost activated");
    }
  }

  handleMessage(buffer) {
    const reader = SmartBuffer.fromBuffer(buffer);
    const messageType = reader.readUInt8();
    switch (messageType) {
      case 16:
        this.updateNodes(reader);
        break;
      case 64:
        this.updateOffset(reader);
        break;
    }
  }

  ghostCells(reader) {
    reader.readOffset += 2;
    const x = reader.readInt32LE() - this.offsetX;
    const y = reader.readInt32LE() - this.offsetY;
    let quadrant;
    if (x < 0 && y < 0) quadrant = 1;
    else if (x > 0 && y < 0) quadrant = 2;
    else if (x > 0 && y > 0) quadrant = 3;
    else quadrant = 4;
    const quadrantMappings = [
      [[1, 1], [-1, 1], [-1, -1], [1, -1]],
      [[-1, 1], [1, 1], [1, -1], [-1, -1]],
      [[-1, -1], [1, -1], [1, 1], [-1, 1]],
      [[1, -1], [-1, -1], [-1, 1], [1, 1]],
    ];
    if (this.client.rQuadrant < 1 || this.client.rQuadrant > 4 || this.gameModeInt === 3) return;
    const mapping = quadrantMappings[this.client.rQuadrant - 1];
    [this.rX, this.rY] = mapping[quadrant - 1];
  }

  updateNodes(reader) {
    const removedCount = reader.readUInt16LE();
    for (let i = 0; i < removedCount; i++) {
      if (this.playerCells[reader.readUInt32LE()]) {
        const cell = this.playerCells[reader.readUInt32LE()];
        if (cell) cell.destroy(this);
      }
    }
    while (true) {
      const cellId = reader.readUInt32LE();
      if (cellId === 0) break;
      const x = reader.readInt32LE();
      const y = reader.readInt32LE();
      const size = reader.readUInt16LE();
      const flags = reader.readUInt8();
      const isVirus = !!(flags & 1);
      let skinName = null, color = null, name = null, extraFlags = 0;
      if (flags & 128) extraFlags = reader.readUInt8();
      if (flags & 2) {
        color = helper.intToHex(
          (reader.readUInt8() << 16) | (reader.readUInt8() << 8) | reader.readUInt8()
        );
      }
      if (flags & 4) name = reader.readStringNT("utf8");
      if (flags & 8) skinName = reader.readStringNT("utf8");
      const isAgitated = !!(flags & 16);
      const isFood = !!(extraFlags & 1);
      const isFriend = !!(extraFlags & 2);
      let accountId = 0;
      if (extraFlags & 4) {
        reader.readOffset += 4;
        accountId = reader.readUInt32LE(reader.readOffset - 4);
      }
      let cell = this.playerCells[cellId];
      if (!cell) {
        cell = new Entity(cellId, accountId);
        this.playerCells[cellId] = cell;
      }
      if (color !== null) cell.color = color;
      if (skinName !== null) cell.name = unescape(encodeURIComponent(skinName));
      if (name !== null) cell.skinName = name;
      if (this.myCellIds[cellId] && this.ownCells.indexOf(cell) === -1) {
        cell.isMine = true;
        this.ownCells.push(cell);
      }
      cell.x = x;
      cell.y = y;
      cell.size = size;
      cell.isFood = isFood;
      cell.isVirus = isVirus;
      cell.agitated = isAgitated;
      cell.isFriend = isFriend;
      cell.accountID = accountId;
    }

    const eatenCount = reader.readUInt16LE();
    for (let i = 0; i < eatenCount; i++) {
      const cellId = reader.readUInt32LE();
      if (this.playerCells[cellId]) this.playerCells[cellId].destroy(this);
    }

    if (this.isAlive && this.ownCells.length === 0) {
      this.clearIntervals();
      this.isAlive = false;
      this.isNearMouse = false;
      this.deathCount++;

      const maxD = config.facebookBotSettings.maxDeaths || 0;
      if (maxD > 0 && this.deathCount >= maxD) {
        logger.warn(`Bot reached maxDeaths (${maxD}), not respawning`);
        return;
      }

      const skinSettings = config.facebookBotSettings.skin;
      const clientSkin = this.client.botSkin;
      if (skinSettings.enable && this.t !== -1) {
        let skinName;
        if (skinSettings.preferClientSkin && clientSkin) {
          skinName = clientSkin;
        } else {
          skinName = skinSettings.names[Math.floor(Math.random() * skinSettings.names.length)];
        }
        manager.changeSkin(this.t, skinName, (skinBuffer) => {
          this.send(skinBuffer, true);
        });
      }

      this.spawnTimeout = setTimeout(() => {
        const nameToSpawn = this.client.nextBotName();
        this.send(buffers.spawn(nameToSpawn), true);
        if (this.maxMassMode) {
          setTimeout(() => this._applyMaxMass(), 500);
        }
      }, 0);
    }
  }

  updateOffset(reader) {
    const minX = reader.readDoubleLE();
    const minY = reader.readDoubleLE();
    const maxX = reader.readDoubleLE();
    const maxY = reader.readDoubleLE();
    if (!this.mapOffsetFixed) {
      this.borderX = maxX - minX;
      this.borderY = maxY - minY;
      if (maxX - minX > 14000) this.offsetX = (minX + maxX) / 2;
      if (maxY - minY > 14000) this.offsetY = (minY + maxY) / 2;
      this.gameModeInt = reader.readUInt8();
      this.mapOffsetFixed = true;
    }
  }

  checkEnemies(x, y, size) {
    const enemies = [];
    const myMass = helper.size2mass(size);
    for (const cell of Object.values(this.playerCells)) {
      if (cell.isFood) continue;
      if (cell.isMine) continue;
      if (cell.isVirus) continue;
      if (cell.isFriend) continue;
      if (myMass > 2000) continue;
      if (cell.name == this.client.playerName && this.client.isAlive) continue;
      if (cell.name == unescape(encodeURIComponent(this.client.botName))) continue;
      const dx = cell.x - x;
      const dy = cell.y - y;
      const isBigger = cell.size > size * 0.85;
      const distance = Math.hypot(dx, dy) - size - cell.size;
      const isClose = distance < 150;
      if (isBigger && isClose) {
        enemies.push({
          dx,
          dy,
          distance,
          sizeRatio: helper.size2mass(cell.size) / myMass,
        });
      }
    }
    return enemies;
  }

  nearestPlayer(x, y, size) {
    const maxDistance = 2000;
    const dxToMouse = this.client.userX / this.rX - x;
    const dyToMouse = this.client.userY / this.rY - y;
    const mouseDistance = 1 + Math.hypot(dxToMouse, dyToMouse);
    let moveX = dxToMouse / mouseDistance;
    let moveY = dyToMouse / mouseDistance;
    const enemies = this.checkEnemies(x, y, size);
    if (enemies.length === 0) {
      return {
        x: this.client.userX / this.rX + this.offsetX,
        y: this.client.userY / this.rY + this.offsetY,
      };
    }
    for (const { dx, dy, distance, sizeRatio } of enemies) {
      const force = -10 * sizeRatio;
      moveX += ((dx / distance) * force) / distance;
      moveY += ((dy / distance) * force) / distance;
    }
    const totalForce = 1 + Math.hypot(moveX, moveY);
    return {
      x: x + (moveX / totalForce) * maxDistance,
      y: y + (moveY / totalForce) * maxDistance,
    };
  }

  nearestEntity(type, x, y, size) {
    let nearest = null;
    let minDistance = Infinity;
    const enemies = type === "isFood" ? this.checkEnemies(x, y, size) : [];
    for (const cell of Object.values(this.playerCells)) {
      let isValid = false;
      switch (type) {
        case "isFood":
          isValid = !cell.isFriend && !cell.isVirus && cell.isFood && !cell.agitated;
          break;
        case "isVirus":
          isValid = !cell.isFriend && cell.isVirus && !cell.isFood && !cell.agitated;
          break;
      }
      if (!isValid) continue;
      const distance = helper.calculateDistance(x, y, cell.x, cell.y);
      if (type === "isFood") {
        let isDangerous = false;
        for (const enemy of enemies) {
          if (helper.calculateDistance(enemy.dx + x, enemy.dy + y, cell.x, cell.y) < 1000) {
            isDangerous = true;
            break;
          }
        }
        if (isDangerous) continue;
      }
      if (distance < minDistance) {
        nearest = cell;
        minDistance = distance;
      }
    }
    return { distance: minDistance, entity: nearest };
  }

  move() {
    if (!this.isAlive) return;
    const center = { x: 0, y: 0, size: 0 };
    const cells = this.ownCells;
    const cellCount = cells.length;
    if (cellCount === 0) return;
    for (const { x, y, size } of cells) {
      center.x += x;
      center.y += y;
      center.size += size;
    }
    center.x /= cellCount;
    center.y /= cellCount;
    const playerTarget = this.nearestPlayer(center.x, center.y, center.size);
    const foodTarget = this.nearestEntity("isFood", center.x, center.y, center.size);
    const virusTarget = this.nearestEntity("isVirus", center.x, center.y, center.size);
    const mouseDistance = helper.calculateDistance(
      center.x, center.y,
      this.client.userX / this.rX, this.client.userY / this.rY
    );
    let targetX = playerTarget.x;
    let targetY = playerTarget.y;
    // FIX: soglia più generosa così isNearMouse scatta realmente.
    this.isNearMouse = mouseDistance < 8000 + helper.size2mass(center.size) * 1.0;
    if (this.followMouse) {
      const useAI = this.client.botAi;
      const useVShield = this.client.botVShield;
      if (useAI && useVShield) {
        if (virusTarget.entity) { targetX = virusTarget.entity.x; targetY = virusTarget.entity.y; }
        else if (foodTarget.entity) { targetX = foodTarget.entity.x; targetY = foodTarget.entity.y; }
      } else if (!useAI && useVShield) {
        if (virusTarget.entity && virusTarget.distance < 10000) {
          targetX = virusTarget.entity.x; targetY = virusTarget.entity.y;
        }
      } else if (useAI && !useVShield) {
        if (foodTarget.entity) { targetX = foodTarget.entity.x; targetY = foodTarget.entity.y; }
      }
    } else if (foodTarget.entity) {
      targetX = foodTarget.entity.x;
      targetY = foodTarget.entity.y;
    }
    this.send(buffers.moveTo(targetX, targetY, this.decryptionKey), true);
  }

  clearIntervals() {
    if (this.moveInterval) {
      clearInterval(this.moveInterval);
      this.moveInterval = null;
    }
  }

  clearTimeouts() {
    if (this.spawnTimeout) { clearTimeout(this.spawnTimeout); this.spawnTimeout = null; }
    if (this.errorTimeout) { clearTimeout(this.errorTimeout); this.errorTimeout = null; }
    if (this.followMouseTimeout) { clearTimeout(this.followMouseTimeout); this.followMouseTimeout = null; }
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
  }

  stop() {
    this.clearIntervals();
    this.clearTimeouts();
    // FIX riconnessione rapida: rilascia il token PRIMA di chiudere,
    // così il server di gioco libera subito lo slot (niente attesa del timeout).
    if (this.t !== -1) {
      manager.releaseToken(this.t, () => {
        this.t = -1;
      });
      this.t = -1;
    }
    // Blocca l'auto-reconnect: è uno stop voluto, non una caduta di rete.
    this.isClosed = true;
    if (this.ws) {
      try {
        // Chiusura pulita (handshake) invece di terminate() brusco:
        // il server viene informato e libera la room immediatamente.
        this.ws.close(1000, 'stop');
      } catch (_) {
        this.ws.terminate();
      }
    }
    manager.clearTokenUsage();
  }
}
