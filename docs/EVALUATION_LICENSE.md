---
summary: "Evaluation licence: Team-tier evaluation of Kurahi for 90 days, no fee, no support SLA, feedback clause"
read_when:
  - You are evaluating Kurahi in an organisation
  - Procurement asks under which terms the evaluation runs
title: "Evaluation Licence"
---

# Kurahi evaluation licence (Team tier)

> **Pending legal review.** This text is a draft prepared with the evaluation kit on 2026-10-13. The liability cap, jurisdiction, user and gateway counts, and the feedback clause are placeholders until counsel has reviewed them. It is shared so that procurement can see the intended shape; it is not yet an offer. The reviewed version will replace this page and carry a version date without this banner.

This licence applies to an evaluation of Kurahi by an organisation ("Evaluator") that has been given access to the evaluation kit by KODA ("Licensor"). It sits on top of the open-core licence map in `LICENSING.md`: the MIT and Functional Source License layers apply as published; this document governs the proprietary layer and the evaluation as a whole. Where this document and the layer licences conflict for the open layers, the layer licence prevails.

## 1. Grant

For the Evaluation Period, Licensor grants Evaluator a non-exclusive, non-transferable, revocable licence to install and run Kurahi, including the proprietary layer (identity and continuity engine, protected policy system, role packs, evaluation dashboard), on systems Evaluator controls, for the purpose of assessing whether to license Kurahi, with up to the number of users and gateways of the Team tier (ten named users, five gateway identities, unless the evaluation agreement states otherwise).

## 2. Evaluation Period

Ninety (90) days from the date the evaluation kit is delivered, extendable once in writing by Licensor. At the end of the period, Evaluator stops using the proprietary layer and deletes it (`kurahi uninstall --all` removes all state; the open layers may continue to be used under their own licences).

## 3. Fee

No fee is payable for the evaluation. Third-party services Evaluator connects (model providers, messaging channels, hosting) are contracted and paid by Evaluator directly under those providers' terms.

## 4. Support

The evaluation is provided without a support service level. Licensor answers questions and defect reports on a reasonable-effort basis through the support channel named in the evaluation kit, during Japanese business hours, with no response-time commitment. Security vulnerabilities are handled under the disclosure process in `SECURITY.md` regardless of this clause.

## 5. Feedback

Evaluator agrees to provide feedback on the evaluation (findings, defects, feature needs, questionnaire results) at least once during the period, through the channel named in the kit. Licensor may use such feedback to improve Kurahi without obligation or attribution; Evaluator grants Licensor a perpetual, royalty-free licence to do so. Feedback does not include Evaluator's confidential data, prompts, or conversation content, which Licensor never receives unless Evaluator sends it deliberately (for example in a support bundle).

## 6. Restrictions

Evaluator will not: offer Kurahi or the proprietary layer to third parties as a service; remove notices; reverse engineer the proprietary layer beyond what applicable law permits; publish benchmark or evaluation results that name the Licensor without Licensor's written consent; or use the Kurahi or KODA marks except to describe the evaluation (`TRADEMARKS.md`).

## 7. Data and privacy

Kurahi is self-hosted; Licensor receives no telemetry and holds no Evaluator data. The data flows are documented in the [Security overview](/security/SECURITY_OVERVIEW) and [Privacy](/security/privacy) pages. Evaluator is the controller of any personal data processed on its systems during the evaluation.

## 8. Warranty and liability

The software is provided "as is" for evaluation, without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose and non-infringement. To the extent permitted by law, Licensor's aggregate liability arising from the evaluation is limited to JPY 100,000; neither party is liable for indirect or consequential loss. Nothing limits liability for wilful misconduct or where it cannot be limited by law.

## 9. Termination

Either party may end the evaluation on written notice. Sections 5 (feedback licence), 6 (restrictions), 8 and 10 survive. On termination Evaluator deletes the proprietary layer and confirms deletion on request.

## 10. Governing law and language

Japanese law governs; the Tokyo District Court has exclusive jurisdiction of first instance. This licence is written in English with a Japanese translation provided for convenience; the English text prevails unless the evaluation agreement states otherwise.

## 11. Conversion

At any point during or after the Evaluation Period, Evaluator may license Kurahi under a commercial agreement (Team or Enterprise tier). Nothing in this document obliges either party to enter one.

---

Issued by KODA. Version 2026-10. Questions: the support channel named in the evaluation kit, or the repository's issue tracker for non-confidential matters.
