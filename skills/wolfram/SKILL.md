---
name: wolfram
description: "Compute answers using Wolfram|Alpha — math, science, finance, data, conversions, real-time facts. Use for calculations, derivatives, integrals, statistics, physics, chemistry, unit conversions, currency, distances, or any computational query. Triggers: calculate, compute, solve, derivative, integral, formula, equation, convert units, distance between, statistics, factorial, prime, or any math/science question."
metadata:
  {
    "KoLo":
      {
        "emoji": "🔢",
        "requires": { "bins": ["curl"], "env": ["WOLFRAM_APP_ID"] }
      }
  }
---

# Wolfram|Alpha Computation Skill

Query Wolfram|Alpha's computational knowledge engine. Handles math, science, finance, geography, conversions, and real-time data.

## Setup

1. Get a free App ID: https://developer.wolframalpha.com/
2. Set environment variable: `export WOLFRAM_APP_ID=your-app-id`
3. Or pass directly: `--appid YOUR_APP_ID`

Free tier: **2,000 queries/month**

## Quick Start

### Simple Query
```bash
./scripts/query.sh "derivative of x^3 * sin(x)"
```

### With explicit App ID
```bash
./scripts/query.sh "integrate x^2 from 0 to 10" --appid YOUR_APP_ID
```

## Example Queries

### Mathematics
```bash
./scripts/query.sh "solve x^2 + 5x + 6 = 0"
./scripts/query.sh "derivative of ln(x^2 + 1)"
./scripts/query.sh "integral of e^(-x^2) from -infinity to infinity"
./scripts/query.sh "100 factorial"
./scripts/query.sh "is 104729 prime"
./scripts/query.sh "taylor series of sin(x) around x=0"
```

### Unit Conversions
```bash
./scripts/query.sh "500000 barrels to liters"
./scripts/query.sh "68000 metric tons to barrels of crude oil"
./scripts/query.sh "100 km/h to knots"
./scripts/query.sh "1 astronomical unit in light minutes"
```

### Finance
```bash
./scripts/query.sh "compound interest on $1000000 at 5% for 10 years"
./scripts/query.sh "present value of $50000 in 5 years at 8% discount"
./scripts/query.sh "USD to AED exchange rate"
./scripts/query.sh "mortgage payment $500000 at 6% for 30 years"
```

### Geography & Distance
```bash
./scripts/query.sh "distance from Dubai to Singapore"
./scripts/query.sh "flight time Tokyo to New York"
./scripts/query.sh "coordinates of Abu Dhabi"
./scripts/query.sh "time zone in São Paulo"
```

### Physics & Chemistry
```bash
./scripts/query.sh "speed of light in km/s"
./scripts/query.sh "molecular weight of C8H18"  # octane
./scripts/query.sh "density of crude oil"
./scripts/query.sh "boiling point of water at 2000m altitude"
```

### Statistics
```bash
./scripts/query.sh "mean, median, std dev of 23, 45, 67, 89, 12, 34"
./scripts/query.sh "linear regression for (1,2), (2,4), (3,5), (4,4), (5,5)"
./scripts/query.sh "normal distribution probability x > 2 for mean=0 std=1"
```

### Real-Time Data
```bash
./scripts/query.sh "population of UAE"
./scripts/query.sh "current temperature in Dubai"
./scripts/query.sh "sunrise time in Tokyo"
./scripts/query.sh "days until December 31, 2026"
```

### Oil Trading Specific
```bash
./scripts/query.sh "specific gravity from API gravity 33"
./scripts/query.sh "barrels per metric ton for 0.85 specific gravity"
./scripts/query.sh "vessel speed 12 knots distance 6000 nautical miles travel time"
./scripts/query.sh "demurrage $50000 per day for 3.5 days"
```

## Response Format

The LLM API returns natural language suitable for direct use in responses:

```
Input: derivative of x^3 * sin(x)
Result: d/dx(x^3 sin(x)) = x^2 (3 sin(x) + x cos(x))
```

## Tips

1. **Be specific**: "solve x^2 = 4" → better than "quadratic equation"
2. **Include units**: "convert 100 gallons to liters" → clear units
3. **Use natural language**: Wolfram understands conversational queries
4. **Chain computations**: "then multiply by 1.05" works in follow-ups

## Error Handling

- No results: Query may be too vague or unsupported
- Rate limited: Free tier is 2,000/month; check usage
- Timeout: Complex computations may take longer; retry

## API Reference

Endpoint: `https://www.wolframalpha.com/api/v1/llm-api`

Parameters:
- `input` - Query string (URL encoded)
- `appid` - Your Wolfram App ID
- `maxchars` - Max response length (default: 6000)

Docs: https://products.wolframalpha.com/llm-api/documentation
