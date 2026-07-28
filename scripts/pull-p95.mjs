#!/usr/bin/env node
// ============================================================
// Team Sharing — Slice 1b, Phase 4.1: gate de performance de la RLS (design.md §9).
//
// Mide el p95 de `GET /api/sync/pull` (pull completo, `since` vacío) contra una cuenta real, N
// veces, y reporta el percentil 95 en milisegundos. Standalone, sin dependencias más allá de las
// built-in de Node 20+ (fetch global) — a propósito, para poder escribirlo y correrlo sin tocar
// producción ni instalar nada nuevo.
//
// Uso (Phase 4.2 / Phase 20.1 / Phase 20.3 — SIEMPRE corrido por el dueño, nunca en automático):
//   PULL_P95_BASE_URL=https://audio-transcriber-web.vercel.app \
//   PULL_P95_TOKEN=<jwt de una cuenta real, mismo header que usa el desktop> \
//   PULL_P95_ITERATIONS=30 \
//   node web/scripts/pull-p95.mjs
//
// `PULL_P95_TOKEN` es el JWT de sesión de Supabase de una cuenta real (mismo mecanismo que
// `getApiUser` acepta para el desktop: `Authorization: Bearer <jwt>`). NO corre nada contra
// Supabase directamente — pega al endpoint HTTP como lo haría el cliente desktop.
// ============================================================

const baseUrl = process.env.PULL_P95_BASE_URL ?? "http://localhost:3000";
const token = process.env.PULL_P95_TOKEN;
const iterations = Number(process.env.PULL_P95_ITERATIONS ?? "30");

if (!token) {
  console.error("Falta PULL_P95_TOKEN (JWT de una cuenta real). Ver el comentario de cabecera de este script.");
  process.exit(1);
}

if (!Number.isFinite(iterations) || iterations <= 0) {
  console.error(`PULL_P95_ITERATIONS inválido: "${process.env.PULL_P95_ITERATIONS}"`);
  process.exit(1);
}

function percentile(sortedMs, p) {
  const idx = Math.ceil((p / 100) * sortedMs.length) - 1;
  return sortedMs[Math.min(Math.max(idx, 0), sortedMs.length - 1)];
}

async function main() {
  const url = `${baseUrl}/api/sync/pull`;
  const durationsMs = [];
  let failures = 0;

  console.log(`Pull p95 gate — ${iterations} corridas contra ${url} (pull completo, since vacío)`);

  for (let i = 0; i < iterations; i++) {
    const startedAt = performance.now();
    let ok = false;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ok = res.ok;
      if (!ok) {
        console.warn(`  corrida ${i + 1}/${iterations}: HTTP ${res.status}`);
      }
      // Drena el body para que el timing incluya la transferencia completa, no solo los headers.
      await res.arrayBuffer();
    } catch (err) {
      console.warn(`  corrida ${i + 1}/${iterations}: error de red — ${err instanceof Error ? err.message : err}`);
    }
    const elapsedMs = performance.now() - startedAt;
    if (ok) {
      durationsMs.push(elapsedMs);
    } else {
      failures += 1;
    }
  }

  if (durationsMs.length === 0) {
    console.error("Ninguna corrida exitosa — no se puede calcular p95.");
    process.exit(1);
  }

  durationsMs.sort((a, b) => a - b);
  const p50 = percentile(durationsMs, 50);
  const p95 = percentile(durationsMs, 95);
  const max = durationsMs[durationsMs.length - 1];

  console.log("");
  console.log(`Corridas exitosas: ${durationsMs.length}/${iterations} (fallos: ${failures})`);
  console.log(`p50: ${p50.toFixed(1)} ms`);
  console.log(`p95: ${p95.toFixed(1)} ms`);
  console.log(`max: ${max.toFixed(1)} ms`);
  console.log("");
  console.log("Guardá este p95 como baseline (Phase 20.1) o compará contra el baseline previo");
  console.log("(Phase 20.3 — regresión aceptada: <= 20%).");
}

main();
