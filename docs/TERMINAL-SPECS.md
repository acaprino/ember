# Specifiche Terminal Rendering — Claude Code GUI

Specifiche funzionali per allineare il terminale xterm.js alla UX dell'applicativo di riferimento.
Ogni sezione descrive il comportamento target, il formato visivo esatto, e le differenze da gestire.

---

## 1. Layout Generale

### 1.1 Struttura

Il terminale xterm.js è un buffer scroll continuo (non ha area fissa). Il layout è sequenziale:

```
[messaggi precedenti — scorrono verso l'alto]
[ultimo blocco di output]
[spinner — riga animata]
[input utente — sotto lo spinner]
```

Lo spinner e l'input sono "ephemeral" — non fanno parte del document model. Vengono cancellati e riscritti quando arriva nuovo contenuto.

### 1.2 Spaziatura tra Turni

Una riga vuota prima di ogni prompt utente (escluso il primo):
```
  ● Read src/main.ts ✓
Response text from previous turn.

❯ next user input
```

---

## 2. Spinner

### 2.1 Caratteri

```
macOS/Windows: · ✢ ✳ ✶ ✻ ✽
```

Ciclo bidirezionale: `[· ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢]` (11 frame, poi ricomincia)

### 2.2 Timing

- **Frame rate**: 50ms per frame (20 fps)
- **Tempo trascorso**: mostrato dopo 1 secondo come `· Ns`

### 2.3 Formato Riga

```
  {frame} {verbo}                        ← se elapsed < 1s
  {frame} {verbo} · {elapsed}s           ← se elapsed >= 1s
  {frame} {verbo} · {elapsed}s · ↓ {N}k ← se elapsed >= 30s (con token count)
```

Indentazione: 2 spazi prima del frame.

Colore: `fg(palette.accent)` per il frame, `DIM` per verbo e tempo.

### 2.4 Verbi per Stato

| Stato | Verbo | Quando |
|-------|-------|--------|
| Processing iniziale | `Thinking...` | Dopo submit, prima di qualsiasi evento |
| Thinking attivo | `Thinking...` | Evento `thinking` ricevuto |
| Tool use | `{ToolName}: {file}` | Evento `tool_use` ricevuto. Es: `Read: main.ts` |
| Dopo tool result | `Thinking...` | Tool completato, in attesa del prossimo evento |
| Streaming risposta | `Responding...` | Evento `assistant` streaming |
| Dopo stream end | `Thinking...` | Stream finito ma processing continua |

### 2.5 Stall Detection

- **Soglia**: 30 secondi senza nuovi token
- **Effetto**: colore del frame interpola gradualmente da `palette.accent` verso `palette.red`
- **Formula**: `t = min(1, (elapsed - 30000) / 30000)`
- **Colore**: `interpolateColor(palette.accent, palette.red, t)`

### 2.6 Layout 2 Righe

Lo spinner occupa 1 riga di testo + il cursore è sulla riga sotto:

```
  ✳ Thinking... · 3s     ← riga N (spinner)
[cursore qui]              ← riga N+1 (per input o in attesa)
```

L'aggiornamento dello spinner usa `CURSOR_SAVE` + `cursorUp` + scrivi + `CURSOR_RESTORE` per non disturbare l'input sotto.

### 2.7 Spinner e Input Coesistono

Quando l'utente digita durante il processing:
```
  ✢ Thinking... · 5s     ← spinner (continua ad animarsi)
❯ also check tests_       ← input utente sotto
```

Lo spinner NON viene fermato. L'input appare sulla riga del cursore (N+1).

### 2.8 suspendAll / resumeAll

Prima di scrivere nuovo contenuto (blocchi), il renderer chiama `suspendAll()` che:
1. Cancella l'input (se presente sullo schermo)
2. Cancella lo spinner (se presente)
3. Posiziona il cursore dove il contenuto va scritto

Dopo aver scritto il contenuto, `resumeAll()`:
1. Ri-renderizza lo spinner (se mode = processing e non streaming)
2. Ri-renderizza l'input (se l'utente aveva digitato qualcosa)

---

## 3. Prompt e Input

### 3.1 Carattere Prompt

```
❯ _                        ← modo normale (accent color, bold)
```

Prompt: `❯` (U+276F) + spazio. Colore: `fg(palette.accent)` + `BOLD`.

### 3.2 Input Durante Processing

L'input è **sempre editabile**. Il testo digitato durante processing viene accodato e inviato quando la query corrente termina.

- Digitare NON ferma lo spinner
- L'input appare sotto lo spinner
- Submit (Enter) accoda il messaggio
- Ctrl+C con buffer vuoto → interrupt
- Ctrl+C con buffer pieno → cancella solo l'input

### 3.3 Input durante Streaming

L'input è buffer-only (non echato al terminale). Quando lo streaming finisce, l'input viene ripristinato sullo schermo.

### 3.4 Paste Multilinea

I newline nel testo incollato vengono sostituiti con spazi. Il prompt è single-line.

### 3.5 Fast Path (ASCII)

Per input ASCII single-line che non riempie la riga:
- Insert: echo diretto del carattere (nessun erase/redraw)
- Backspace: `\b \b` per cancellare ultimo char
- Delete: riscrittura dalla posizione del cursore

Condizione: `asciiOnly && inputRows <= 1 && newLen < cols`

Per non-ASCII (CJK) o wrapped: slow path con erase + full redraw.

---

## 4. Blocchi di Output

### 4.1 UserBlock

```
❯ {testo utente}
  {continuazione wrapped, indentata 2 spazi}
```

- Prompt: `❯` accent bold + spazio
- Word wrap a `cols - 2`
- NON renderizzato dal renderer (già echato dall'InputManager)
- Solo tracciato nel document model per il conteggio righe

### 4.2 AssistantBlock

```
{testo risposta plain}
  ─────────────── javascript
  {codice indentato 2 spazi, colore accent}
  ───────────────
{continuazione testo}
```

- Testo plain senza prefisso né gutter
- Inline markdown: `**bold**` → BOLD, `*italic*` → ITALIC, `` `code` `` → accent color
- Code block: separatori `─` con etichetta linguaggio
- Word wrap a `cols - 1`

### 4.3 ToolBlock

**Pending:**
```
  ● {ToolName} {inputSummary}
```

**Success:**
```
  ● {ToolName} {inputSummary} ✓
```

**Fail:**
```
  ● {ToolName} {inputSummary} ✗
    {riga errore 1}
    {riga errore 2}
    ...max 5 righe
```

Icone:
- Pending: `●` dim
- Success: `● ✓` verde
- Fail: `● ✗` rosso

Input summary:
- `file_path` o `path` → basename troncato a 60 char
- `command` → testo comando
- Altrimenti nessun summary

Indentazione: 2 spazi prima del `●`.

### 4.4 DiffBlock

**Pending:**
```
  ● {Tool} {filename} +{N} -{M}
```

**Success:**
```
  ● {Tool} {filename} +{N} -{M} ✓
    + riga aggiunta (verde)
    - riga rimossa (rosso)
    contesto (dim)
    ...max 6 righe
```

**Fail:**
```
  ● {Tool} {filename} +{N} -{M} ✗
    ...max 20 righe diff
```

Stats colorate: `+N` verde, `-M` rosso.

### 4.5 PermissionBlock

**Non risolto:**
```
  ⚠ Allow {ToolName}: {descrizione}
    [Y]es  [A]llow session  [N]o
```

**Risolto:**
```
  ✓ Allowed: {ToolName} {descrizione}
```
oppure:
```
  ✗ Denied: {ToolName} {descrizione}
```

La riga dei tasti è indentata di 4 spazi. Colori: Y verde, A accent, N rosso.

### 4.6 AskBlock

**Non risolto (con opzioni):**
```
  {domanda bold}
  {header/contesto dim}

  1. Opzione A
     Descrizione dim
  2. Opzione B
     Descrizione dim
  (1/N)
```

**Non risolto (free-text):**
```
  {domanda bold}
❯ _
```

**Risolto:**
```
  {header}: {risposta}
```

Indentazione: 2 spazi. Opzioni numerate con colore accent.

### 4.7 ErrorBlock

```
ERROR [{code}] {messaggio rosso}
               {continuazione indentata}
```

Prefisso `ERROR` bold rosso. Messaggio rosso. Word wrap con indent.

### 4.8 StatusBlock

```
── {status} ──
```

Solo testo dim. Usato per "Interrupted" e separatori sessione.

### 4.9 ThinkingBlock

**NON renderizzato nel terminale.** Il thinking è mostrato:
- Nel sidebar panel (testo completo)
- Nello spinner (verbo "Thinking...")
- Nel bottom bar (indicatore "thinking" con dot animato)

---

## 5. Streaming Testo

### 5.1 Flusso

1. `AssistantBlock` creato con `streaming: true`, committato con `lineCount: 0`
2. Spinner verb → `"Responding..."`
3. `streamAppend` eventi scrivono testo direttamente al terminale
4. Testo sanitizzato: ANSI stripped, trailing spaces rimossi, `\n` → `\r\n`
5. `streamEnd`: aggiunge `\r\n` se mancante, fix lineCount, flush deferred updates

### 5.2 Durante Streaming

- Spinner fermato (streaming attivo)
- Block updates deferred (cursore inaffidabile)
- Input buffer-only (no echo)
- Al termine: spinner riprende, input ripristinato

---

## 6. Aggiornamento In-Place Blocchi

### 6.1 Stesso Numero Righe

```
CURSOR_SAVE
cursorUp(linesFromBottom + lineCount)
{per ogni riga: ERASE_LINE + \r\n}
cursorUp(lineCount)
{scrivi nuovo contenuto}
CURSOR_RESTORE
```

### 6.2 Numero Righe Cambiato

`redrawFrom(block)`: cancella dal blocco alla fine, ri-renderizza tutti i blocchi successivi.

### 6.3 Blocchi Congelati

Se un blocco è più di `rows * 2` righe lontano dal fondo → `frozen = true`, non più aggiornato.

---

## 7. Full Redraw

Trigger: resize (cambio colonne), cambio tema.

1. Se streaming attivo → `forceFinalize()`
2. Reset tracking input
3. Clear terminale
4. Ri-renderizza tutti i blocchi in ordine
5. Spaziatura `\r\n` prima di ogni UserBlock (eccetto il primo)

---

## 8. Flussi Completi

### 8.1 Submit → Thinking → Tool → Response → Prompt

```
❯ fix the bug                           ← utente submit
  · Thinking...                          ← spinner (frame 0)
  ✳ Thinking... · 2s                     ← spinner animato
  ✶ Read: main.ts · 3s                   ← spinner verb cambia per tool
  ● Read main.ts                         ← tool block (pending)
  ● Read main.ts ✓                       ← tool block (success, in-place update)
  ✢ Thinking... · 5s                     ← spinner verb torna a thinking
I found the bug in the parseInput        ← response streaming (spinner sparisce)
function on line 47...                   ← continua streaming
  · Responding... · 8s                   ← spinner (opzionale, se continua)

❯ _                                      ← prompt ritorna
```

### 8.2 Digitare Durante Processing

```
❯ fix the bug
  ✳ Thinking... · 3s                     ← spinner
❯ also check the tests_                  ← input sotto spinner
```

Submit dell'input accodato:
```
❯ fix the bug
  ✢ Thinking... · 4s                     ← spinner continua
```
(messaggio accodato, processato dopo la risposta corrente)

### 8.3 Permesso

```
❯ fix the bug
  ● Edit main.ts +3 -1                   ← tool pending
  ⚠ Allow Edit: main.ts
    [Y]es  [A]llow session  [N]o         ← spinner fermato, attesa input
```

Dopo Y:
```
  ✓ Allowed: Edit main.ts
  ● Edit main.ts +3 -1 ✓                ← tool completato
```

### 8.4 Errore

```
❯ fix the bug
  ✳ Thinking... · 2s
ERROR [rate_limit] Too many requests.
                   Please wait 30 seconds.

❯ _                                      ← prompt ritorna
```

---

## 9. Vincoli Tecnici

### 9.1 xterm.js vs Ink

| Aspetto | Ink (riferimento) | xterm.js (nostra impl) |
|---------|-------------------|----------------------|
| Layout | Flex con aree fisse | Buffer scroll continuo |
| Bottom fisso | Sì (spinner + input) | No (tutto scorre) |
| Rendering | Virtual DOM + diff | Scritture ANSI dirette |
| Virtualizzazione | VirtualMessageList | Blocchi congelati |
| Aggiornamento | React batching atomico | `terminal.write()` asincrono |

### 9.2 Conseguenze

- Lo spinner non può stare in posizione fissa — si muove con il contenuto
- `suspendAll/resumeAll` simula l'atomicità cancellando/riscrivendo l'area ephemeral
- xterm.js bufferizza le scritture per frame di animazione → aggiornamenti nella stessa call stack sono atomici
- Il congelamento blocchi compensa la mancanza di virtualizzazione

### 9.3 Font e Caratteri

I caratteri usati devono essere presenti nel font del terminale:
- `❯` (U+276F) — prompt
- `●` (U+25CF) — bullet tool
- `✓` (U+2713) — success
- `✗` (U+2717) — fail
- `⚠` (U+26A0) — warning
- `· ✢ ✳ ✶ ✻ ✽` — spinner frames
- `─` (U+2500) — separatore code block

Se il font non supporta un carattere, xterm.js mostra un box vuoto. Il font consigliato (Consolas) supporta tutti questi.

Il carattere `⎿` (U+23BF) **NON è supportato** in molti font monospace — per questo non lo usiamo come gutter.
