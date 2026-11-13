# ZeroExtens Bots TITANIUM (PRO) — Fix massa & bot amount

## Problema risolto

I bot nascevano con massa ~10 e il "bot amount" non funzionava. Cause:

1. **Il campo "Massa" del menu non arrivava mai al server.**
   Il `Client.js` (case 0) leggeva solo `server + botName + botAmount` e ignorava
   il `uint32 mass` che lo userscript mandava in coda.
2. **Il `botAmount` era rotto.** Lo userscript mandava `amount=1`, quindi il server
   creava 1 bot invece di N.
3. **La massa in agar.io non si imposta alla nascita.** Si ottiene (a) mangiando cibo
   (feeding) o (b) con il mass boost Facebook (il sistema lo supporta già).

## Soluzione applicata

- `Client.js` → legge `uint32 mass` opzionale, lo salva come `targetMass`, lo passa al Minion.
- `Minion.js` → mass boost allo spawn + fase di **feeding** (il bot insegue SOLO cibo
  finché `currentMass < targetMass`, poi torna alla normale AI).
- `v4.4-BOT_SCRIPT.js` → il client manda `amount=N` + `mass` in un unico packet di spawn.

## Protocollo spawn (opcode 0)

```
[0][server\0][name\0][uint16 amount=N][uint32 mass]
```

- `amount` = numero di bot da creare (il server crea N bot se supporta amount=N).
- `mass` = massa target (opzionale; fallback 150 se assente o 0).

Client `B()` (in v4.4-BOT_SCRIPT.js):

```js
function B(srv, nm, amt, mas) {
  // [0][server\0][name\0][uint16 amt][uint32 mas]
}
window.gg.send(B(window.gg.server || "", firstName, total, mass));
```

Server `Client.js` (case 0):

```js
this.server = reader.readStringNT();
this.botName = reader.readStringNT();
this.botAmount = reader.readUInt16LE();
if (reader.remaining() >= 4) {
  const m = reader.readUInt32LE();
  this.targetMass = (m && m > 0) ? m : 150;
} else {
  this.targetMass = 150;
}
this.botNames = [this.botName];
this.startBots();
```

E in `startBots()`:

```js
const minion = new Minion(this);
minion.targetMass = this.targetMass || 150;
this.bots.push(minion);
```

## Feeding (Minion.js — inizio di `move()`)

```js
const currentMass = helper.size2mass(center.size);
if (!this.feedingDone && currentMass < this.targetMass) {
  if (foodTarget.entity) { targetX = foodTarget.entity.x; targetY = foodTarget.entity.y; }
  this.send(buffers.moveTo(targetX, targetY, this.decryptionKey), true);
  return;
}
if (currentMass >= this.targetMass) this.feedingDone = true;
```

## Mass boost Facebook (opzionale)

Il mass boost dipende da:
- token Facebook validi in `data/tokens.json`
- il master server su `wss://svr99.xevbots.com:3000`
- `facebookBotSettings.useMassBoost = true`

Se questi mancano, i bot crescono comunque tramite **feeding** (più lento ma autonomo).

### BUG corretto: `this.token` vs `this.t`

Nel `Minion.js` originale c'era un bug che impediva al mass boost di partire:
- `this.t = manager.t()` nel costruttore (indice del token assegnato).
- Ma `useMassBoost()`, `case 103`, `case 104`, `requestLogin` usavano `this.token`,
  che non è MAI inizializzato (restava `undefined`).
- Risultato: `manager.buyMassBoost(undefined, ...)` falliva silenziosamente →
  nessun "Mass boost activated" nel log.

Fix: tutti gli `this.token` sono stati sostituiti con `this.t` (l'indice reale del token).

## Deploy

### Server
Copia questi file sul progetto e riavvia (`start.bat`):
- `core/Client.js`
- `core/Minion.js`
- `config/index.js`

### Userscript (Tampermonkey)
Sostituisci `var BOT_SCRIPT='...';` con il contenuto di `v4.4-BOT_SCRIPT.js`.

## Verifiche

1. **Opzione A vs B** in `v4.4-BOT_SCRIPT.js`:
   - Opzione A (default) = un solo packet `amount=N`.
   - Se i bot NON appaiono, scommenta l'Opzione B (N packet da 1): il tuo server
     crea 1 bot per packet.
2. **Mass boost** richiede master server `:3000` + token; altrimenti solo feeding.
