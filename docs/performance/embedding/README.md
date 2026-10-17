# OpenOnyx embedding performance refactor

## Scope and validation limits

The application was not launched. No real vault was modified, no dependencies
were installed, and no commit or push was made. Benchmark records are local.
The original implementation was rechecked before recording `baseline-mocked.json`.

Actual ONNX cold/warm initialization, tokenization time, inference latency,
Electron input-to-paint latency, process RSS/WASM memory, and packaged offline
operation are recorded only for the isolated synthetic harness described below.
No post-throughput real-inference comparison completed in the available
environment, so this document makes no throughput-speedup claim.

## Architecture

The renderer owns the note store and scheduler. A lazily created module Web Worker
owns Transformers.js, tokenization, quantized MiniLM and ONNX WASM execution.
There is one model instance, including a shared initialization promise, per
embedding worker. CPU execution uses one WASM thread unless the runtime proves
that `SharedArrayBuffer` and cross-origin isolation are available; only then it
selects a conservative 2 or 4 thread count from available cores. GPU is not
required.
There is no renderer or main-process inference fallback. Existing keyword
fallback remains available and visibly reports backend failures.

Typed messages carry request IDs and vault generations. Results use transferable
Float32 buffers. Model-cache RPCs bridge the worker to narrowly scoped preload
methods; the main process checks the expected vault before accessing files.
Model files are transferred only during loading/populating the cache. Network
model fetching and model decoding happen in the worker. Disk cache writes complete
before downloaded files are used. A loaded model survives vault changes; partial
loads are terminated. Worker crashes reject pending requests, and the client can
restart. Backend failures use a 30-second retry cooldown.

Vite's `new Worker(new URL(..., import.meta.url))` emits production worker assets
and their relative dependencies. Existing local WASM files are shipped under
`dist/wasm`. Electron isolation, node integration and CSP were not weakened.

Graph pairwise similarity and capped Insights analysis run in a separate module
worker. Pure algorithms were extracted without changing their calculations.
Only bounded sampled vectors, transferred as Float64 buffers to preserve their
original precision, accompany the full path order needed for sampling. Graph
physics continues using its existing worker.

## Scheduling, indexing and cancellation

All local model callers use one scheduler: P0 interactive queries, P1 active-note
inference, P2 bulk/Spaces work. It executes one batch at a time with a maximum of
128 pending/active tasks. Identical tasks share promises; queued batches recheck
the cache at execution time. Every eighth selection favors the oldest task to
prevent starvation. Noninteractive inference waits while recent typing is active;
interactive requests bypass that inactivity gate.

Batches are capped at four chunks. A small shared chunk collector combines work
from independent notes, Spaces, and active operations into those batches while
retaining each note's original chunk-to-vector mapping and aggregation. P0 work
flushes immediately; background work has an 8 ms collection window. A running
synchronous ONNX call is not preemptible. Queries can run between batches of a
long note. Cancellation rejects obsolete promises, prevents subsequent batches,
and discards stale completions.

File-written events own save-triggered indexing. Explicit duplicate save/create
calls were removed. Watchers and typing-idle requests feed the same keyed note
queue. Queued revisions are replaced with the latest source; active identical
sources are suppressed. Note request promises also deduplicate identical content.
Revision checks prevent older results replacing newer ones. Delete/move operations
cancel queued jobs. Vault changes invalidate work before native IPC switches the
root, rather than relying only on React effects.

Vault scans are coalesced and start after a 300 ms startup grace period. Queue
construction uses a keyed map and sorts at consumption rather than every insert.
It prepares at most six notes concurrently, but inference stays in the one
scheduled worker pipeline. Scan-time mtime and byte size are reused instead of
issuing one metadata IPC request per note; watcher/save jobs without metadata
still use the validated native call. The previous fixed 100 ms pause per three
notes is replaced by a zero-delay event-loop yield.

## Cache compatibility and persistence

The model, 384 dimensions, quantization, tokenizer behavior, mean pooling,
normalization, note averaging and eight-segment aggregation are preserved.
Existing embedding schema 2 remains accepted. Moving inference to a worker does
not force reindexing. Legacy vectors without provenance remain usable as before.

New entry filenames are injective UTF-8 hexadecimal path encodings under
`embeddings/v3`, split into bounded path components. This is a filename layout
version, **not an embedding schema/model change**. Existing flattened JSON files
are loaded first and new entries take precedence. Unchanged legacy files are not
rewritten. The loader recovers entries even without `_index.json`. Legacy files
are not deleted merely to migrate layout. Ordinary note deletion/rename retains
the existing corresponding cache cleanup behavior.

Auxiliary per-note caches under `embedding-chunks/v3` are populated lazily and
never required to read existing embeddings. Their identity includes model,
quantization, preprocessing, pooling, normalization and semantic/lexical type.
They retain at most 64 chunks per note and are loaded only for an edited note.
The shared in-memory chunk/query cache holds at most 2,048 entries and is cleared
on vault changes. This adds disk space but avoids loading all cached chunk vectors
into the renderer.

New notes use the existing 1,200-character splitter and 120-character overlap.
Edited notes retain unchanged text anchors and split uncovered regions with the
same splitter. Insertions/deletions can therefore preserve downstream chunks.
Formatting-only changes reuse normalized chunks. Changed coverage and overlap
regions are recomputed; note/segment aggregates are rebuilt. Very large notes
beyond the retained 64 chunks may require more work after restart. Real retrieval
quality for boundary edits still needs manual checking.

New note and Spaces vectors record their vector type. Incompatible new lexical
and semantic caches are not reused or compared as interchangeable vector spaces.
A partial backend failure rebuilds the note aggregate entirely in the lexical
space. Legacy missing provenance cannot be reconstructed without reindexing and
is preserved for compatibility.

Metadata index reconstruction occurs once per delayed flush. Debounced writers
support cancellation/flush and capture the originating vault. Main-process data
writes and deletions serialize per destination and use same-directory temporary
files followed by rename for writes. Pending auxiliary writes are cancelled on
note deletion/move. This prevents partial JSON publication and older overlapping writes
replacing newer ones; it is not a guarantee against power-loss/filesystem failure.
The old localStorage migration backup is retained.

Suggestion update events have one owner and coalesce simultaneous changes.
Refreshes target visible notes, with trailing debounce and a maximum wait during
continuous indexing. Stale async results are ignored. Content cache limits are
48 notes, 2 MiB, a 5-second TTL, and explicit invalidation. Suggestion result maps
are bounded; graph pairwise caching keeps one dataset.

## BENCHMARK RESULTS

These are **mocked inference and jsdom event-loop measurements**, not Electron
vault throughput. Baseline used the original implementation and a deterministic
0.15 ms synchronous mock per inference call. The optimized harness mocks the
worker boundary with the same model workload, so it does not simulate off-thread
execution. Each fixture contains distinct short notes and a long note every tenth
entry; persistence is mocked. Timing noise and host load remain relevant.

| Notes | Baseline elapsed ms | After elapsed ms | Baseline notes/s | After notes/s | Initial model calls before/after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 50 | 73.9 | 93.2 | 676.6 | 536.2 | 50 / 55 |
| 500 | 710.7 | 805.6 | 703.6 | 620.7 | 500 / 550 |
| 2,000 | 3,022.9 | 3,257.9 | 661.6 | 613.9 | 2,000 / 2,200 |

Ten concurrent identical saves: **10 inference calls before, 1 after** in every
fixture. One paragraph edit in the long-note fixture: **7 chunks inferred before,
2 after**. Additional regression fixtures verify insertion, formatting changes,
and reuse after restart with the persisted auxiliary cache.

Initial mock throughput decreased. Smaller batches require more calls for long
notes, and scheduling/cache bookkeeping has measurable overhead when inference
is almost free. Real ONNX throughput has not been established; four versus eight
chunks and one versus limited multiple threads must be benchmarked on target
hardware before claiming a throughput gain.

An earlier isolated Electron run with the real quantized MiniLM model on the
synthetic 48-note vault recorded a 13,465.9 ms cold pass (3.56 notes/s, about
6.31 inferred chunks/s), a 502 ms semantic query during indexing, and 85 inferred
chunks. ONNX accounted for 191.3 ms average batch time; metadata and note reads
averaged 0.82 ms and 1.37 ms. The harness's isolated HTTP thread matrix measured
roughly 7.98 / 8.15 / 8.30 chunks/s for 1 / 2 / 4 threads at four chunks per
batch. A 32-chunk batch reached 8.58 chunks/s at four threads but held the worker
for 3.73 seconds, which is unsuitable for interactive work. Current main-process
headers do not establish cross-origin isolation, so OpenOnyx must use the
single-thread fallback in its packaged configuration.

The follow-up post-change real run could not complete because the public ONNX
model asset transfer did not finish in this environment. The temporary fixture
was isolated under `/tmp`, contained no user data, and no result was recorded.
Consequently, there is no before/after real throughput claim for the queue and
cross-note batching changes.

The independent Node worker responsiveness experiment applies the same 200 ms CPU
load on the calling event loop and then in a worker. Its maximum heartbeat delay
was **195.30 ms before / 1.35 ms after**, with **2 / 41 heartbeat ticks**. This
demonstrates isolation for controlled CPU work, not Electron UI acceptance.

Raw records: `baseline-mocked.json`, `after-mocked.json`, and
`responsiveness-mocked.json`. Reproduce current measurements with:

```sh
node scripts/benchmark-embeddings.mjs /tmp/embedding-results.json
node scripts/benchmark-embedding-responsiveness.mjs
node scripts/create-embedding-fixtures.mjs /tmp/openonyx-embedding-fixtures-new
```

The fixture generator refuses an existing destination and never reads user
vaults. Synthetic 50/500/2,000-note vaults have also been prepared under
`/tmp/openonyx-embedding-fixtures` for manual QA.

In a development build, `window.__embeddingPerformance()` returns bounded local
counters/samples: inference requests, deduplication, chunk cache hits, cold model
initialization, warm model reuse, single/batch inference, queue wait, query time,
note indexing time, vault processing duration, suggestion refreshes, long tasks,
event-loop delay, and renderer heap where Chromium exposes it. Counters include
both note- and chunk-level deduplication; they are not all distinct note counts.
Warm reuse requires no model reload and records zero load time. These diagnostics
are disabled in production and contain no note text or external telemetry.

## AUTOMATED VERIFIED

Tests cover model singleton initialization/failure retry, actual worker entry
with injected model and offline cache RPC, request IDs, crash recovery, vault
generation mismatches, identical requests, latest revisions, deletes, delayed
vault switches, queue coalescing, priorities/fairness/typing, interactive wait
bounded by a running simulated batch, incremental cache reuse, cache identity
invalidation, legacy schema compatibility, missing-index recovery, dimensions,
normalization, search ranking, Spaces concurrency, suggestion coalescing, atomic
write ordering, and graph/Insights equivalence.

Final regression result: **528 tests passed, 4 real-vault tests skipped** across
81 passing test files. Renderer/Electron typechecks, the production build,
production worker asset checks, and `git diff --check` passed. The sandbox initially blocked
existing child-process tests; the unrestricted rerun passed. Real-vault tests
remain intentionally skipped without `OO_EVAL_VAULT`.

`node scripts/check-embedding-worker-assets.mjs` statically checks production
worker imports, local WASM files, unchanged CSP permission, and `dist/**/*`
inclusion for packaging. A **Linux x64 unpacked package was built** using the
installed Electron distribution, with dependency rebuilding disabled. Its actual
ASAR was inspected and contains both workers, their imports, and WASM assets.
The application was not launched. Linux AppImage/deb installers, Windows
NSIS/portable, macOS DMG/ZIP, and packaged worker/model/offline execution are
**not runtime verified**. Successful builds do not establish that compatibility.

## Remaining bottlenecks and next measurements

All note/segment JSON vectors still reside in the renderer. Large-vault loading
still reads per-note files. Hashing, Markdown stripping, aggregate construction,
suggestion enrichment, and some graph assembly remain on the renderer. Spaces
has separate note-level persistence and chunking, so cache sharing is incomplete.
The vault queue now yields without a fixed sleep; measure the actual trade-off
between its six-note preparation bound and worker batch/thread tuning.
The separate remote embedding path used by legacy Space forks and the external
Thought Model service were not redesigned. No Forge implementation was found.

Measure real worker cold load with/without disk cache, single/batch inference,
tokenization, P50/P95/P99 query/input latency under indexing, startup-to-editable
time, worker and renderer RSS/heap/WASM peaks, GC pauses, disk/IPC traffic, cache
hit ratios, and 4/8-chunk versus 1/2-thread configurations on 8 GB hardware. Check
cross-origin isolation/runtime support before enabling WASM threading. Keep CPU
fallback and the current model; GPU exploration is separate future work.

## NEEDS VARSHITH MANUAL QA

### MANUAL QA FOR VARSHITH

Use the synthetic vaults or disposable copies. Do not benchmark by editing your
only copy of a real vault. Record CPU/memory and diagnostic snapshots alongside
observed behavior; this checklist was not executed by the agent.

1. **Small vault:** open the 50-note fixture; the editor becomes usable while indexing progresses.
2. **Large vault:** open the 2,000-note fixture; navigation works without waiting for completion.
3. **Typing:** type continuously during indexing; input stays responsive and noninteractive inference waits during typing.
4. **Scrolling:** scroll a long note while inference runs; rendering remains smooth.
5. **Note switching:** switch quickly among notes; content and suggestions stay attached to the current note.
6. **Repeated saves:** save identical content repeatedly; no repeated model work for completed/in-flight content.
7. **Paragraph edit:** edit/insert/delete a paragraph near a chunk boundary; fewer chunks recompute and late sections remain searchable.
8. **Semantic query:** ask/search during bulk indexing; it runs after the current batch, ahead of queued background batches.
9. **Related suggestions:** verify relevance, accept/reject behavior, and refreshes in split panes without floods.
10. **Graph/Insights:** verify semantic edges, missing links, clustering and synthesis; change graph settings while indexing.
11. **Spaces:** build/rebuild an index, retrieve source passages, and verify unchanged notes reuse their cache.
12. **Vault switching:** switch during model loading and during inference; old results never appear in the new vault.
13. **Restart:** reopen a cached vault; existing embeddings and persisted chunk caches remain usable.
14. **Offline:** after one successful model load, disconnect and restart; cached model/search works. Check visible keyword fallback when model assets are absent.
15. **CPU/RAM:** monitor renderer, embedding worker and total app memory through repeated operations; check for sustained growth and contention on an 8 GB laptop.
16. **Packaged app:** repeat loading, indexing, search and offline checks in Linux AppImage/deb, Windows NSIS/portable, and macOS DMG/ZIP where available; inspect worker/WASM loading errors.
17. **Forge:** exercise existing Forge integrations in your distribution, including save/retrieval flows; none could be identified in this checkout.
