# Resource Allocation — KodaSōken

## Philosophy

At 5-15 people, "resource allocation" is about knowing who's doing what, who's overloaded, and where the next hire should go. It's a conversation, not a model. The goal: nobody is burned out, and the most important work is staffed.

## People Allocation Across Projects

### Allocation model (simple):
Track per person, per week, in percentage points (not hours):
- **100% = full-time dedicated to one project**
- **Split allocation:** e.g., 60% Project A, 40% Project B
- **Overhead budget:** Everyone has 10-20% for internal ops, learning, admin. This is real — don't pretend it's zero and wonder why estimates are off.

### Allocation rules:
- No one should be on more than 3 active projects simultaneously. Context switching beyond 3 is unproductive.
- Key-person risk: if one person is >50% of billable capacity in any revenue stream, document a bus-factor mitigation.
- Project lead should be ≥50% allocated to the project they're leading. Leading a project at 10% allocation = not actually leading.

### Allocation review cadence:
- **Weekly:** Informal check — who's drowning?
- **Monthly:** Formal resource rebalance in portfolio review. Move people between projects if needed. It's better to delay a low-priority project than burn out a high-performer.
- **Quarterly:** Capacity planning for next quarter. Factor in holidays, known leave, and ramp-up time for new hires.

## Capacity Planning

### How to estimate capacity (quarterly):
1. Total person-weeks available (e.g., 10 people × 13 weeks × 0.85 utilization = ~110 person-weeks)
2. Subtract committed work (signed SOWs, ongoing retainer obligations)
3. Subtract internal must-dos (compliance, hiring, ops)
4. Remaining = capacity for new work or buffer

### Buffer is not optional:
Keep 15-20% unallocated capacity for:
- Urgent client requests
- Someone getting sick or quitting
- A project taking longer than expected
If you plan to 100%, you're planning to miss deadlines.

### New hire decision trigger:
Hire when the buffer is consistently zero for 6+ weeks AND pipeline is strong. Don't hire on a spike — hire on sustained demand.

## Contractor vs. FTE Decisions

### Default to contractor when:
- Need is <6 months and scope is defined
- Skill is specialized and not core to KodaSōken's long-term value proposition
- FTE has 3-6 month notice period at the end (typical for Japan) — contractor is easier to stop if need evaporates

### Default to FTE when:
- Role is core to ongoing operations (will be needed indefinitely)
- Knowledge accumulation matters (domain expertise that should stay in-house)
- The person manages other people or client relationships
- Need is >12 months with reasonable certainty

### Japan-specific contractor considerations:
- **Gyōmu itaku (service contract):** Contractor is independent. You don't control their hours or method — only the output. Misclassification as "disguised employee" is a labor bureau risk.
- **Haken (temporary staffing):** Regulated by the Worker Dispatching Act. Limited to 3 years per person per role. Use registered agencies only.
- **Shōhizei (consumption tax):** Contractor invoices include 10% CT. FTE salaries don't charge CT. Factor this into cost comparison.

## Budget Tracking

### Monthly rhythm:
- **First week of month:** Department leads submit actuals vs. budget for previous month
- **One spreadsheet, one tab per department.** Not a financial system — a shared view.
- **Line items:** Personnel, contractors, travel, software/tools, office, other.
- **Variance flags:** Any line >10% over or >20% under gets a one-line explanation.

### Budget ownership:
- Department leads own their budget. They can reallocate within their department without approval.
- Cross-department reallocation needs operations lead sign-off.
- Total company budget needs CEO sign-off.

### Project-level budget:
- Track per project: planned budget, actual to date, % complete, estimate to complete.
- Red flag: actual >80% of budget with <%50 completion. Project lead must report before next milestone.

## Time Tracking Philosophy

KodaSōken uses lightweight time tracking:

- **Track to project, not to task.** "4 hours on Project Alpha" is enough. "0.5 hours on JIRA-442" is overhead that doesn't pay for itself at this scale.
- **Track billable vs. non-billable.** This is the one distinction that matters financially.
- **For hourly-billed client work:** Track to the granularity the client contract requires (and bill for that tracking time if it's significant).
- **Daily or weekly entry, not real-time.** Real-time timers are distracting. Fill in at end of day or end of week.
- **Tool:** Harvest, Toggl, or Google Sheets. Don't build or customize — pick one and use it.

## Bottleneck Detection

### Signs of a bottleneck:
- Multiple people waiting on the same person for decisions or deliverables
- One person is "the only one who can" for 3+ different things
- A project phase that was estimated at 1 week consistently takes 3+
- The same person's name comes up in every "what's blocking you" standup

### Bottleneck resolution:
1. **Name it.** Bottlenecks often persist because nobody says "Tanaka-san is the bottleneck."
2. **Triage.** Which tasks only this person can do? Which can someone else do with 1 hour of handoff?
3. **Short-term:** Reassign low-uniqueness tasks. Add a contractor for overflow.
4. **Long-term:** Cross-train. Document the bottleneck's knowledge (see process-design.md for SOP approach).

## Resource Allocation Matrix

See `assets/coo-toolkit.json` → `resource_allocation_matrix` for the template. Update it monthly at the portfolio review. It's a one-page view of who's on what — the single most useful operational artifact at this scale.
