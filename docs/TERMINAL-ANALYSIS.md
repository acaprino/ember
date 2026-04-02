# Analisi Funzionale del Terminale — Applicativo di Riferimento

Analisi esaustiva del sistema di rendering terminale dell'applicativo studiato. Basata su lettura completa dei sorgenti.

---

## 1. Layout Principale (REPL Screen)

### Struttura Componenti

```
<FullscreenLayout>
├─ Area scrollabile (messaggi):
│  ├─ <LogoHeader> (memoizzato)
│  └─ <VirtualMessageList> oppure <MessageRows[]>
│     └─ per messaggio: <MessageRow> → <Message>
│
├─ Area fissa in basso:
│  ├─ <Spinner> (indicatore animato, 1-3 righe)
│  ├─ <PromptInput> (campo input + footer pills)
│  └─ <SessionBackgroundHint>
│
└─ Overlay modale:
   ├─ <PermissionRequest>
   ├─ <ModelPicker>, <HistorySearchDialog>
   └─ Altri dialog
```

### Separazione Layout

- **Top/Center**: Area scrollabile con cronologia messaggi. Supporta virtualizzazione (memoizzazione righe, cache altezze).
- **Bottom**: Altezza massima 50% dello schermo. Contiene spinner + input + hint. Posizione fissa.
- **Modal**: Overlay posizionato in assoluto sopra tutto.

### Gestione Focus

- Modale attivo → tastiera al modale
- Altrimenti → PromptInput (TextInput)
- Soppressione dialog permessi per 1500ms quando l'utente sta digitando

### Alternate Screen

- Buffer alternativo del terminale (scrollback principale intatto)
- Altezza contenuto = esattamente `terminalRows`
- Cursore nascosto durante il rendering (no flicker)

---

## 2. Sistema Messaggi

### Tipi di Messaggio

| Tipo | Componente | Descrizione |
|------|-----------|-------------|
| `assistant.text` | `AssistantTextMessage` | Testo risposta, con `MessageResponse` (⎿) |
| `assistant.thinking` | `AssistantThinkingMessage` | Blocco thinking, 💭 con conteggio token |
| `assistant.tool_use` | `AssistantToolUseMessage` | Chiamata tool con `●` indicatore |
| `user.text` | `UserTextMessage` | Input utente, con `MessageResponse` (⎿) |
| `user.tool_result` | `UserToolResultMessage` | Risultato tool (success/error/canceled) |
| `system` | `SystemTextMessage` | Messaggi di sistema |
| `grouped_tool_use` | `GroupedToolUseContent` | Gruppo di tool consecutivi collassato |

### MessageResponse (Gutter ⎿)

**Chi lo usa**: Risposte assistant, risultati tool, messaggi sistema, spinner (per tip/budget)
**Chi NON lo usa**: Blocchi thinking, input bash, notifiche agenti, plan approval

```
  ⎿  Testo con gutter (2 spazi + carattere + 2 spazi)
```

- Carattere: `⎿` (U+23BF)
- Rendering: `dimColor={true}` (grigio smorzato)
- Anti-nesting: se già dentro un MessageResponse, restituisce solo i children

### Raggruppamento e Collapsing

- Tool use consecutivi dello stesso tipo → raggruppati in `GroupedToolUseContent`
- Catene lunghe di ricerca → collassate con "Reading N files..."
- Hook summary → compattati
- Shutdown teammate → compattati

---

## 3. Sistema Spinner

### Modalità Spinner

| Modalità | Quando | Verbo |
|----------|--------|-------|
| `idle` | Non in esecuzione | Nessuno spinner |
| `thinking` | Extended thinking attivo | "Thinking..." |
| `requesting` | In attesa risposta API | Verbo casuale |
| `responding` | Streaming risposta | "Responding..." |
| `tool-use` | Esecuzione tool | Nome tool |
| `stalled` | Nessun token per 3s+ | Colore → rosso |

### Caratteri e Animazione

**Caratteri per piattaforma:**
- macOS: `· ✢ ✳ ✶ ✻ ✽`
- Linux: `· ✢ * ✶ ✻ ✽`
- Ghostty: `· ✢ ✳ ✶ ✻ *`

**Ciclo bidirezionale**: `[...chars, ...chars.reverse()]` → animazione avanti-indietro
**Frame rate**: 50ms per frame (20 fps) via `useAnimationFrame(50)`
**Reduced motion**: `●` statico con ciclo dim/bright di 2 secondi

### Formato Output

```
{frame} {verbo}… {elapsed}     ← riga principale
```

Esempi:
```
✢ Thinking…                    ← thinking iniziale (< 1s)
✳ Thinking… · 3s               ← thinking con tempo
✶ Reading… · 5s                ← tool use
· Responding… · 12s · ↓ 1.2k   ← streaming con conteggio token
✽ Implementing… · 45s           ← stalled (colore → rosso)
```

### Transizione Colore (Stall)

- **Normale**: colore tema (accent/cyan)
- **Shimmer**: colore più chiaro (glimmer)
- **Stalled** (>30s senza token): interpolazione graduale verso rosso `rgb(171, 43, 63)`
- **Intensità stall**: `t = min(1, (elapsed - 30s) / 30s)`

### Conteggio Token

- Appare dopo ~30s di attività
- Formula: `responseLengthRef / 4 ≈ tokens`
- Formato: `↓ 1.2k tokens`

### Thinking Status

1. Thinking inizia → mostra "thinking…"
2. Thinking finisce → calcola durata
3. Mostra `{durata}ms` per minimo 2 secondi (visibilità garantita)
4. Poi cancella

### Teammate Tree (Agenti Team)

Quando ci sono teammate attivi:
```
✢ Thinking… · 5s
├─ agent-1 · 234 tokens
└─ agent-2 · 567 tokens
```

---

## 4. Rendering Tool Use

### Formato Chiamata Tool

```
● {nomeToolVisibile} {inputSummary}
```

Esempi:
```
● Read (src/main.ts)
● Write (src/auth.ts, 45 lines)
● Bash (cd /project && npm test)
● Edit (src/utils.ts)
```

### Stati Indicatore ●

| Stato | Visuale | Colore |
|-------|---------|--------|
| Queued | `●` dim | Grigio |
| Running | `●` animato | Default, dots ruotano (200ms) |
| Success | `✓` | Verde |
| Error | `✗` | Rosso |

### ToolUseLoader

- **Pending**: `●` dim (in attesa di avvio)
- **Running**: `●` con animazione dots rotanti (5 fps)
- **Success**: `✓` statico verde
- **Error**: `✗` statico rosso

### Gruppi Tool Collassati

Tool consecutivi dello stesso tipo vengono raggruppati:
```
● Reading 5 files…
  [espandi per vedere i singoli file]
```

### Indicatori Permesso

- `Auto classifier checking…` — classificatore automatico in esecuzione
- `Waiting for permission…` — in attesa approvazione utente

---

## 5. Prompt Input

### Carattere Prompt

| Modalità | Carattere | Colore |
|----------|-----------|--------|
| Prompt | `❯` | Default/bianco |
| Bash | `!` | Rosso |
| Search | `/` | Blu |

### Input Durante Loading

- Il campo input **resta editabile** durante il loading
- Il testo digitato viene **accodato** via `messageQueueManager.enqueue()`
- Processato FIFO quando la query corrente termina
- Badge visuale per comandi in coda

### Multi-line

- Backspace svolge le righe lunghe
- Paste con newline embedded
- Word wrapping visivo (senza newline reali)
- Navigazione cursore: frecce, Home/End, Ctrl+A/Ctrl+E
- Auto-expand: il campo cresce verticalmente fino all'altezza dello schermo

### Footer (Pills)

```
Model · Perms · [Bridge] · [Tmux] · [Companion] · Tasks
```

- **Model**: Nome modello corrente (cliccabile)
- **Perms**: Modalità permessi (bypass/auto/default)
- **Tasks**: Conteggio task background + nomi teammate
- **Keyboard hints**: Ctrl+K help, Ctrl+S submit, ecc.

### Sistema Suggerimenti

Tre livelli:
1. **History**: Frecce su/giù per input precedenti
2. **Shell completion**: Typeahead bash
3. **Typeahead**: Nomi comandi, percorsi file

### Paste Handling

1. Testo incollato → salvato in `pastedContents[nextPasteId]`
2. Placeholder inserito nel testo: `[Pasted text #N]`
3. Al submit: placeholder espanso al contenuto reale
4. Immagini: ridimensionate se > threshold, iniettate come `ImageBlockParam`

---

## 6. Ink Renderer

### Pipeline di Rendering

```
1. Layout Yoga (flex) → dimensioni calcolate per ogni nodo
2. Validazione dimensioni (no NaN, no Infinity, >= 0)
3. Render nodi → Output buffer (back frame)
4. Diff contro frame precedente (front frame)
5. Emissione scritture terminale minimali
```

### Operazioni Output

| Operazione | Descrizione |
|-----------|-------------|
| `write` | Testo con coordinate e soft-wrap |
| `blit` | Copia regione da frame precedente (ottimizzazione) |
| `shift` | Scroll hardware via DECSTBM |
| `clear` | Segna regione come "dirty" |
| `clip` | Limita area di rendering |
| `noSelect` | Marca regione non selezionabile |

### CharCache

- `Map<string, ClusteredChar[]>` — cache per riga di testo
- Tokenizzazione ANSI + clustering grafemi fatto UNA volta per riga unica
- Hot loop: solo letture proprietà + `setCellAt`
- Cap a 16.384 entry per prevenire crescita illimitata

### Screen (Griglia Celle)

```typescript
Cell = {
  char: string       // Carattere
  styleId: number    // Indice in stylePool
  hyperlink?: string // Link OSC 8
  noSelect?: boolean // Non selezionabile
  softWrap?: boolean // Wrap generato da word-wrap
}
```

- **Char Pool**: Deduplicazione caratteri (8000 celle → ~50 char unici)
- **Hyperlink Pool**: Deduplicazione link

---

## 7. Display Thinking

### ThinkingToggle

- Badge: `💭 {tokenCount}`
- Toggle: `Ctrl+T` nasconde/mostra blocchi thinking
- Animazione shimmer durante streaming thinking (pulsazione opacità 70%)

### AssistantThinkingMessage

```
💭 {tokenCount} {durationMs}ms
{testo thinking con syntax highlighting}
```

- **Collassato**: Prime 200 char + link [espandi]
- **Espanso**: Testo completo con line wrapping
- In modalità transcript: solo l'ultimo blocco thinking del turno più recente

---

## 8. Status Line

### Contenuto

```
{model} · {workspace} · {context_pct}% context · {perm_mode} · ${cost}
```

Campi:
- **Model**: Nome modello + display name
- **Workspace**: Directory corrente (git-aware)
- **Cost**: Costo totale sessione + durata
- **Context**: `input_tokens/context_window` con percentuale
- **Rate limits**: Utilizzo 5 ore e 7 giorni
- **Vim mode**: INSERT/NORMAL/VISUAL (se attivo)
- **Agent**: Tipo e nome agente (se in esecuzione)

### Refresh

- Debounced a 300ms
- Trigger su: cambio modello, cambio permessi, cambio modo vim, nuovo messaggio

---

## 9. Flussi di Interazione

### A. Utente digita "fix the bug" e preme Enter

1. Tasto premuto → `TextInput.onInputChange("fix the bug")`
2. Enter → `PromptInput.onSubmit("fix the bug")`
3. Controllo comandi immediati (no slash → skip)
4. Aggiunta a history
5. Pulizia input field: `setInputValue('')`
6. `isLoading = true` → spinner appare
7. Messaggio inviato al query engine

### B. Agent inizia thinking

1. Evento `thinking` ricevuto
2. Spinner mode → `'thinking'`
3. Verbo → "Thinking…"
4. `thinkingStartRef = Date.now()`
5. Shimmer animazione attiva

### C. Agent chiama tool Read

1. Evento `tool_use` ricevuto → `AssistantToolUseMessage` aggiunto
2. Indicatore: `● Read (src/main.ts)` con `●` dim
3. Spinner verbo → "Reading…"
4. `ToolUseLoader` → stato running (dots animati)

### D. Tool Read completa

1. Evento `tool_result` ricevuto
2. Indicatore: `● Read (src/main.ts) ✓` verde
3. `ToolUseLoader` → stato success
4. Output collassato (espandibile)
5. Spinner verbo → torna a "Thinking…"

### E. Agent streama testo risposta

1. Evento `assistant.text` (streaming)
2. `AssistantTextMessage` aggiunto con `MessageResponse` (⎿)
3. Testo appare incrementalmente
4. Spinner mode → `'responding'`
5. Conteggio token incrementa

### F. Risposta completa, prompt ritorna

1. Streaming termina → `isLoading = false`
2. Spinner rimosso
3. PromptInput riattivato
4. Cursore riappare nell'input field
5. Coda messaggi processata (se presenti)

### G. Utente digita durante processing

1. Input field **resta editabile**
2. Testo accodato via `messageQueueManager.enqueue()`
3. Badge "queued" visibile
4. Quando query corrente termina → messaggio accodato inviato
5. Spinner NON viene interrotto

### H. Prompt permesso appare

1. Tool richiede approvazione → `PermissionRequest` overlay modale
2. Mostra: tool name + descrizione + opzioni (Allow/Deny/Allow session)
3. Input utente → risposta permesso
4. Overlay chiuso → processing riprende
5. Soppressione 1500ms se utente sta digitando

### I. Errore durante processing

1. Evento errore ricevuto
2. `SystemAPIErrorMessage` con `MessageResponse` (⎿)
3. Messaggio rosso con dettagli
4. Spinner fermato
5. `isLoading = false` → prompt riattivato
6. Possibile retry automatico (rate limit con backoff)

---

## 10. Differenze Chiave con la Nostra Implementazione

| Aspetto | Applicativo Riferimento | Nostra Implementazione |
|---------|------------------------|----------------------|
| Renderer | Ink (React virtual DOM per terminale) | ANSI diretto a xterm.js |
| Layout | Flex layout con area scrollabile + bottom fisso | Tutto sequenziale nel buffer scroll |
| Spinner | Componente React, sempre in bottom fisso | ANSI animato, posizionato dopo ultimo blocco |
| Input durante loading | Editabile, accodato, mai bloccato | Editabile sotto spinner (nuovo) |
| Gutter ⎿ | Solo su: risposte, tool result, system, spinner tip | Non usato (rimosso) |
| Tool display | `●` con dots animati + nome visibile utente | `●` con ✓/✗ + nome tool |
| Thinking | `💭` badge + testo espandibile + shimmer | Solo sidebar (spinner mostra "Thinking...") |
| Virtualizzazione | `VirtualMessageList` con cache altezze | Nessuna (blocchi congelati quando lontani) |
| Status line | Barra fissa con model/cost/context/vim | Bottom bar React (fuori dal terminale) |
