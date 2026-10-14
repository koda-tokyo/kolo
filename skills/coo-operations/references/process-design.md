# Process Design — KodaSōken

## Philosophy

Processes exist to make good outcomes repeatable, not to control people. At KodaSōken's scale, a process should be:
1. **Documented in one page** (if it takes more, it's too complex for the current team size)
2. **Owned by one person** (the person who does the work owns the process)
3. **Reviewed when it breaks, not on a schedule**

Never design a process for a problem you haven't actually had. Anticipatory bureaucracy is the enemy of startup velocity.

## When to Formalize a Process

Formalize when:
- **The same task is done 3+ times by different people** with different results
- **A mistake cost money or damaged a client relationship**, and a checklist would have prevented it
- **Someone is leaving** and their knowledge needs to transfer
- **A regulatory requirement** demands documentation (see compliance-operations.md)

Don't formalize when:
- A task is done by one person, correctly, and they're not leaving soon
- The process changes monthly (write a guide, not a procedure)
- "We might need this someday"

## SOP Template

For processes that need documentation, use this minimal format. See also `assets/coo-toolkit.json` → `sop_template_fields`.

```
SOP: [Process Name]
Owner: [Name]
Last updated: [Date]
Review frequency: [When this should be checked — e.g., "after 3 uses" or "6 months"]

Purpose (1 line):
[What this process accomplishes]

Triggers:
- What starts this process? (e.g., "Client sends purchase order")

Steps:
1. [Action] → [Owner/role] → [Expected output]
2. [Action] → [Owner/role] → [Expected output]
...

Exceptions:
- [Condition]: [What to do instead]

Related:
- [Link to template, regulation, or upstream/downstream process]
```

Max 15 steps. If you have more, split into multiple SOPs or simplify the process.

## Process Mapping with Swimlane Diagrams

For cross-functional processes (involving 2+ people/roles), use a swimlane diagram. Don't buy software — draw it in Miro, Google Drawings, or on a whiteboard (photo is fine).

### Swimlane conventions:
- **Lanes = roles** (not people): "Project Lead," "Finance," "CEO" — not "Tanaka-san"
- **Left to right = time sequence.** Don't make the reader guess the order.
- **Diamonds = decisions.** Every decision box needs exactly 2 exits (yes/no). If you need more, break it into two decisions.
- **Handoffs between lanes = risk points.** Most process failures happen at handoffs. Highlight these.

### When to swimlane-map:
- Onboarding a new client
- Month-end close
- Hiring process
- Contract approval flow
- Any process where someone said "I thought you were doing that"

## Approval Workflows

### Design principles for approval chains:
1. **Fewest steps possible.** Every approval step adds latency. Default to 1 step: "person responsible + one approver."
2. **Approver must have authority AND context.** An approver who rubber-stamps because they lack context is worse than no approver.
3. **Escalation, not ping-pong.** If an approver rejects, the submitter revises and resubmits ONCE. Second rejection = escalate to the next level for a binding decision.

### Default KodaSōken approval thresholds:
| Amount / Type | Approver |
|---|---|
| Expense < ¥50K | Self-approve with receipt |
| Expense ¥50K-¥500K | Department lead |
| Expense > ¥500K | CEO |
| Contract commitment < ¥1M | Operations lead |
| Contract commitment ≥ ¥1M | CEO |
| Hiring (any) | CEO |

Adjust these if the company has updated its delegation policy.

## Exception Handling

Every process needs an exception path. If a process has zero exceptions over 3 months, it's either perfect or nobody's using it.

### Exception log format:
```
Date | Process | Exception description | Action taken | Resolved? | Lessons
```

Keep one shared exception log (spreadsheet). Review monthly to identify:
- Processes that need redesign (too many exceptions)
- Processes that are too rigid (exceptions are reasonable but process blocks them)
- Training gaps (exceptions arise from people not knowing the process)

## Process Automation Opportunities

At KodaSōken scale, automate only when:
- **Volume > 20 repetitions/month** (otherwise, manual is cheaper than setup time)
- **Error cost is high** (compliance filings, financial data)
- **The automation tool is already in the stack** (use Zapier if you already have it; don't adopt a new platform for one automation)

### High-ROI automation targets for a small Japanese firm:
1. **Invoice generation** from project tracking (reduce unbilled hours)
2. **Expense receipt capture** → accounting software (free up ops time)
3. **Compliance deadline reminders** (calendar with email/Slack alerts — low tech, high value)
4. **Client onboarding checklist** (automated welcome email + folder creation)
5. **Timesheet → invoice draft** (if billing hourly)

Don't automate for the sake of it. A Slack reminder that takes 5 min to set up beats a custom integration that takes 2 days.

## Continuous Improvement (Kaizen)

Adopt Kaizen at team scale, not factory scale:

- **Improvement meeting:** 30 min, every 2 weeks. Optional — only if someone has a specific improvement to propose.
- **Format:** "Here's what's bothering me → Here's my proposed fix → Try it for 2 weeks → Review." Not "Let's brainstorm everything wrong with the company."
- **Improvement log:** One shared doc. Date | Issue | Proposed fix | Trial start | Result | Adopted?
- **Rule:** Anyone can propose. Anyone can trial (as long as it doesn't break compliance). If it works, adopt. If it doesn't, discard. No permission needed for changes that only affect your own work.
- **What NOT to improve:** Compliance processes (those are changed by regulation, not Kaizen). Client contracts (legal review required). Anything safety-critical.

## Process Health Check

Quarterly, ask these 5 questions about every documented process:
1. Is this process still used? (If not, archive it — don't leave zombie SOPs.)
2. Has it prevented more problems than it caused? (If not, simplify or kill.)
3. Does the owner still know they own it? (If not, reassign.)
4. Could a new hire follow it without asking for help? (If not, rewrite.)
5. Is it shorter than one page? (If not, why?)
