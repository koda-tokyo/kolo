#!/usr/bin/env node
// scripts/smoke-test-ticker-apis.mjs
//
// Smoke test for the 4 financial moat ticker APIs:
//   GET /api/health/[ticker]    — Health Score 0-100 with grade
//   GET /api/scenarios/[ticker] — Scenario analysis (bull/bear/base)
//   GET /api/ledger/[ticker]    — Transaction ledger
//   GET /api/issuer/[ticker]    — Issuer/company details
//
// Usage:
//   node scripts/smoke-test-ticker-apis.mjs [base-url] [ticker]
//
// Defaults:
//   base-url = http://127.0.0.1:3001
//   ticker   = PETR4
//
// Exit codes:
//   0 = all checks passed
//   1 = one or more checks failed

const BASE_URL = process.argv[2] || "http://127.0.0.1:3001"
const TICKER = (process.argv[3] || "PETR4").toUpperCase()

const ROUTES = [
  { path: `/api/health/${TICKER}`, label: "Health Score" },
  { path: `/api/scenarios/${TICKER}`, label: "Scenarios" },
  { path: `/api/ledger/${TICKER}`, label: "Ledger" },
  { path: `/api/issuer/${TICKER}`, label: "Issuer" },
]

let passed = 0
let failed = 0

async function checkRoute(route) {
  const url = `${BASE_URL}${route.path}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const data = await res.json()

    if (!res.ok) {
      console.error(`  FAIL ${route.label}: HTTP ${res.status}`)
      console.error(`  Body: ${JSON.stringify(data).slice(0, 200)}`)
      failed++
      return
    }

    // Validate response shape
    switch (route.label) {
      case "Health Score":
        if (typeof data.score !== "number" || data.score < 0 || data.score > 100) {
          console.error(`  FAIL ${route.label}: score out of range (${data.score})`)
          failed++
          return
        }
        if (!data.grade || !/^[A-F][+-]?$/.test(data.grade)) {
          console.error(`  FAIL ${route.label}: invalid grade "${data.grade}"`)
          failed++
          return
        }
        break

      case "Scenarios":
        if (!data.scenarios?.bull || !data.scenarios?.base || !data.scenarios?.bear) {
          console.error(`  FAIL ${route.label}: missing bull/base/bear scenarios`)
          failed++
          return
        }
        break

      case "Ledger":
        if (!Array.isArray(data.entries)) {
          console.error(`  FAIL ${route.label}: entries is not an array`)
          failed++
          return
        }
        break

      case "Issuer":
        if (!data.name || !data.sector) {
          console.error(`  FAIL ${route.label}: missing name or sector`)
          failed++
          return
        }
        break
    }

    console.log(`  PASS ${route.label}: HTTP ${res.status}`)
    passed++
  } catch (err) {
    console.error(`  FAIL ${route.label}: ${err.message}`)
    failed++
  }
}

async function main() {
  console.log(`\nSmoke test — ${TICKER} @ ${BASE_URL}`)
  console.log(`Routes: ${ROUTES.length}`)
  console.log("─".repeat(50))

  for (const route of ROUTES) {
    await checkRoute(route)
  }

  console.log("─".repeat(50))
  console.log(`Results: ${passed} passed, ${failed} failed`)

  if (failed > 0) {
    console.error("\nSome checks failed. Verify the database and Supabase config.")
    process.exit(1)
  } else {
    console.log("\nAll checks passed.")
  }
}

main()
