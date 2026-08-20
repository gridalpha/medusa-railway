#!/usr/bin/env node
/**
 * Block until the Medusa schema exists.
 *
 * Railway has no service ordering, and Medusa's migrations carry no advisory
 * lock — two containers running `db:migrate` against one database race, and the
 * loser exits on a duplicate-object error. So only the server service migrates;
 * the worker waits here for the tables to appear before it starts.
 */
const { Client } = require("pg")

const MARKERS = ["public.store", "public.user", "public.product"]
const ATTEMPTS = Number(process.env.SCHEMA_WAIT_ATTEMPTS || 60)
const INTERVAL_MS = Number(process.env.SCHEMA_WAIT_INTERVAL_MS || 5000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const log = (message) => console.log(`[medusa-railway] ${message}`)

async function present() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select ${MARKERS.map((_, i) => `to_regclass($${i + 1}) is not null`).join(
        " and "
      )} as ready`,
      MARKERS
    )
    return rows[0].ready === true
  } finally {
    await client.end().catch(() => {})
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL is unset — skipping the schema wait")
    return
  }

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      if (await present()) {
        log(`schema is ready after ${attempt} check(s)`)
        return
      }
      log(`schema not migrated yet (check ${attempt}/${ATTEMPTS})`)
    } catch (error) {
      log(`database not reachable yet (check ${attempt}/${ATTEMPTS}): ${error.message}`)
    }
    await sleep(INTERVAL_MS)
  }

  // Fall through rather than hang: a genuine failure should surface as a crash
  // the restart policy and health check can report, not as a container that
  // sits quiet forever.
  log("WARN: gave up waiting for the schema — starting anyway")
}

main().catch((error) => {
  log(`WARN: schema wait failed: ${error.message}`)
})
