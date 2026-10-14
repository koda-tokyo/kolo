# Project Management — KodaSōken

## Philosophy

Projects at KodaSōken run with a lightweight hybrid approach. Pure Scrum is too heavy for 5-15 people; pure ad-hoc burns out the team. Default to a Kanban-style board (GitHub Projects or Trello) with optional time-boxed sprints for client deliverables. The goal: visibility and alignment, not ceremony.

## Project Lifecycle

### 1. Initiate
- **Trigger:** Client SOW signed, internal initiative approved, or strategic bet greenlit by CEO.
- **Minimum viable initiation:**
  - One-page charter (who, what, why, when, budget ceiling)
  - Named project lead (one person, not a committee)
  - Initial success criteria (how we'll know it worked)
- **Template:** See `assets/coo-toolkit.json` → `project_kickoff_template`
- **Decision authority:** Projects under ¥2M total budget can be initiated by any department lead. Over ¥2M needs CEO.

### 2. Plan
- **Kanban board:** Columns: Backlog → This Week → In Progress → Review → Done. Add "Blocked" column if dependencies frequently stall work.
- **For client-facing projects:** Add a "Client Review" column between Review and Done.
- **Task granularity:** Tasks should be completable in 1-3 days. If a task is >3 days, break it down. If <2 hours, group it.
- **Dependencies:** Mark cross-team dependencies explicitly. Tag the person who owns the dependency. Review dependencies in weekly portfolio review.
- **Estimation:** T-shirt sizes (S/M/L/XL) work better than hours for internal work. Use hours only for billable client work.

### 3. Execute
- **Daily:** Async standup (3 bullets in Slack). The project lead is responsible for unblocking, not the CEO.
- **Weekly:** Project lead sends a 5-bullet status to stakeholders: on track?, key accomplishment, key risk, help needed, next milestone.
- **Client comms cadence:** Defined in SOW. Typically weekly written update + biweekly call. Don't over-communicate to compensate for uncertainty — it erodes trust.

### 4. Monitor
- **Health check (weekly, by project lead):** Green/Yellow/Red. Red triggers a same-week escalation to CEO or COO.
- **Risk register:** Maintain as a simple table in the project doc. Risk | Likelihood (H/M/L) | Impact (H/M/L) | Mitigation | Owner. Review monthly. Don't build a risk management department — this is a shared doc, not a job title.
- **Budget burn:** Track actual vs. planned monthly. If >15% over, flag to operations lead.

### 5. Close
- **Deliverable handoff:** All deliverables archived in shared drive. Client sign-off documented (email is sufficient for most).
- **Retrospective:** 30 min. What went well / what didn't / what to keep. Write to a shared learnings log. No more than 5 action items.
- **Financial close:** Final invoice issued within 2 weeks of completion. Unbilled hours = lost revenue.
- **Celebrate:** Acknowledge completion. Even a 5-min shoutout in standup counts.

## OKRs vs KPIs

### KPIs (ongoing health metrics)
Track 3-5 company KPIs at any time. Update monthly. Examples for KodaSōken:
- Revenue vs. plan (monthly, trailing 3-month average)
- Utilization rate (billable hours / total hours, target 70-80% for a small firm)
- Client NPS or repeat engagement rate
- Days sales outstanding (DSO, aim for <45 days in Japan)
- Project margin (revenue - direct costs, per project)

### OKRs (quarterly bets)
- **Output:** 2-4 objectives, 2-4 key results each. Team-level OKRs cascade from company OKRs — but only one level. No "individual OKRs" for a 10-person company.
- **Grading:** 0.0-1.0 scale. 0.7 is good. 1.0 means the target was too easy. Review at end of quarter — do not "track" OKRs weekly (that's what KPIs are for).
- **Check-in:** Once mid-quarter. Don't let OKRs become a reporting burden.
- **OKR-setting cadence:** Two weeks before quarter end, draft company OKRs. Team OKRs one week before. No more than 2 rounds of review.

## Stakeholder Management

For a small firm, stakeholders are few and relationships are direct:
- **Internal:** CEO, department leads, project team members. No "stakeholder matrix" needed — just talk to people.
- **External (clients):** Map the decision-maker and the day-to-day contact. They're rarely the same person. The project lead owns both relationships.
- **External (partners/subsidiaries):** Clear scope boundaries in writing. Most partner friction comes from unclear "who does what."
- **Escalation path:** Project lead → Department lead → CEO. Don't jump levels without informing.

## When to Kill a Project

A project should die when any of these are true:
1. **Client stopped paying** or payment is >60 days late without credible resolution.
2. **Strategic relevance disappeared** — the reason we started no longer holds (e.g., regulatory change killed the market).
3. **Key person left** and cannot be replaced within the project's viable timeline.
4. **Margin went negative** and there's no path back within 2 months.
5. **Team dreads it.** Morale cost exceeds any plausible upside. (Trust your team's judgment here.)

### Kill process (lightweight):
- Project lead raises the flag (written, 1 page: why, financials, alternatives considered).
- CEO + operations lead decide within 1 week.
- If killed: communicate to client within 3 business days. Have a transition plan, even if minimal.

## Dependency Tracking

- **Internal dependencies:** Visible on the Kanban board. Tag the person and the date needed.
- **Client dependencies:** "Waiting on client" column on the board. If a task sits there >5 business days, project lead contacts client directly (not the account manager — skip the middleman).
- **Vendor dependencies:** Tracked in vendor-operations.md. SLA breach on a dependency triggers vendor review.
- **Tool:** A simple spreadsheet or the Kanban board. Do not buy dependency-tracking software for 10 people.
