# SP-1 (agy-gate) — Spike de transporte: `agy --print`

**Data:** 2026-06-15 · **agy:** v1.0.3 · **Objetivo:** validar se `agy -p` serve de transporte para um plugin irmão do `codex-gate`, mantendo subscription (custo marginal zero).

## Veredito: VIÁVEL, com 1 problema central (read-only) e 1 degradação (token budget).

| # | Pergunta | Resultado | Impacto no design |
|---|---|---|---|
| 1 | Subscription headless funciona? | ✅ `agy -p` exit 0 na subscription Antigravity cacheada. Binário oficial Google. Endpoint `daily-cloudcode-pa.googleapis.com` (plano daily-quota). | Tese de custo-zero preservada. Auth probe = smoke `agy -p`. |
| 2 | JSON estruturado por prompt? | ✅ JSON limpo, sem fences/prosa, **parse OK** num review real. 3/3 defeitos semeados achados c/ severidade correta. | **Remove o hack dual-schema do codex-gate §9.** Pipeline: prompt força JSON → parse tolerante → validação draft-07 → fail-visible no parse. |
| 3 | Token usage exposto? | ⚠️ NÃO em stdout/log. Há `quota_manager` interno, sem contagens parseáveis. | stop-gate `TOKEN_BUDGET` indisponível → cai no degradation path da §7.4: **só iteration cap**. |
| 4 | `--sandbox` garante read-only? | ❌ **NÃO.** Escreveu `PWNED.txt` mesmo com `--sandbox` e SEM `--dangerously-skip-permissions`, fora de trustedWorkspaces. `--sandbox` = "terminal restrictions", não FS read-only. | **Maior delta vs codex-gate.** A SDK do Codex dá `sandboxMode:"read-only"` de graça (SP-1 Codex confirmou). Aqui read-only precisa ser **engenheirado**. |
| 5 | Modelo de permissão? | ℹ️ `~/.gemini/antigravity-cli/settings.json` tem `permissions.allow` (só `command(...)` shell) + `trustedWorkspaces`. Não gateia a tool nativa de write em print mode. | Possível lever futuro (deny-list?), não confirmado. |
| 6 | Seleção de modelo? | ✅ `--model` + subcomando `agy models`. | `models.mjs` equivalente factível. |

## Read-only — RESOLVIDO (OS sandbox, kernel-enforced)

**Por que `--sandbox` não bastava:** a `--sandbox` do `agy` usa Seatbelt/nsjail, mas confina writes *para dentro* do workspace e protege o que está *fora*. O workspace é o próprio projeto → projeto gravável por design. Sentido invertido do que queremos.

**Solução comprovada — Seatbelt Strategy A (macOS):** wrap o `agy -p` num profile de 3 linhas que nega write só no diretório do projeto. `(allow default)` mantém escrita de estado (`~/.gemini`) e rede.
```scheme
(version 1)
(allow default)
(deny file-write* (subpath (param "PROJECT_DIR")))
```
```
sandbox-exec -D PROJECT_DIR="<abs real path>" -f review.sb agy -p "<prompt>"
```
**Teste real:** `agy` tentou escrever PWNED2.txt → BLOQUEADO no kernel ("system-level write permissions"); ainda assim leu cart.js e produziu o review correto; exit 0. É o **mesmo mecanismo** que a SDK do Codex usa internamente (Seatbelt). Custo ~0, sem cópia.

**Linux:** equivalente com `bwrap --ro-bind / / --bind ~/.gemini ~/.gemini --share-net … agy -p`.

**Defense-in-depth (opcional):** somar o guardrail nativo do `agy` — `settings.json` `permissions.deny: ["write_file(*)"]` + Tool Permission mode `strict`. Precedência `Deny > Ask > Allow` sobrepõe o default "projeto é gravável". É camada de agente (bypassável por prompt-injection/bug), então o OS sandbox continua sendo a garantia dura.

**Não precisamos de cópia.** E mesmo se quiséssemos: `cp -cR` no APFS é clone copy-on-write O(1) (50MB em 0.00s, confirmado) — a objeção de lentidão era falsa. Mantido só como fast-path opcional.

**Caveats operacionais (pesquisa):** usar o path *real* em PROJECT_DIR (Seatbelt resolve symlinks; `/tmp`→`/private/tmp`); incluir `$TMPDIR` (`/private/var/folders/...`) se migrar para allowlist (Strategy B); guardar contra o bug não-TTY do `agy --print` que pode dropar a resposta final com exit 0 (tratar stdout-vazio-com-sucesso como falha visível).

## Notas operacionais

- Startup do `agy` loga erros transitórios "You are not logged into Antigravity" (singleflight refresh races) que **se resolvem sozinhos** — o review rodou e produziu resultado válido. Não confundir com AUTH_REQUIRED real no probe.
- `--print-timeout` default 5m; review real fechou em ~10s.
- `agy` lê arquivos do workspace (cwd) sozinho, sem `--add-dir`.

## Saldo vs codex-gate

Reaproveita ~85% (driver seam, scope, stop-gate, fingerprinting, fail-visible, 2 consumidores). **Simplifica** o schema (sem strict subset). **Piora** em 2 pontos load-bearing: (a) read-only engenheirado em vez de grátis; (b) sem token budget no stop-gate; e (c) churn da CLI por nossa conta (sem SDK que pine binário).
