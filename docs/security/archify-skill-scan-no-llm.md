# SkillSpector Security Report

**Skill:** archify  
**Source:** `/private/tmp/archify-review/src/archify`  
**Scanned:** 2026-09-14 06:49:30 UTC  

## Risk Assessment

| Metric | Value |
|--------|-------|
| Score | 80/100 |
| Severity | HIGH |
| Recommendation | DO NOT INSTALL |

## Components (81)

| File | Type | Lines | Executable |
|------|------|-------|------------|
| `LICENSE` | other | 22 | No |
| `SKILL.md` | markdown | 137 | No |
| `THIRD_PARTY_NOTICES.md` | markdown | 69 | No |
| `assets/JetBrainsMono-OFL.txt` | text | 93 | No |
| `assets/template.html` | other | 14934 | No |
| `bin/archify.mjs` | other | 2101 | No |
| `bin/open-artifact.mjs` | other | 86 | No |
| `bin/preview.mjs` | other | 653 | No |
| `bin/visual-check.mjs` | other | 829 | No |
| `brand-marks/README.md` | markdown | 31 | No |
| `brand-marks/catalog.json` | json | 131 | No |
| `delta/architecture-delta.mjs` | other | 1221 | No |
| `examples/agent-run.lifecycle.json` | json | 60 | No |
| `examples/agent-tool-call.workflow.json` | json | 94 | No |
| `examples/async-job-roundtrip.sequence.json` | json | 61 | No |
| `examples/brand-aware-delivery.architecture.json` | json | 47 | No |
| `examples/cache-miss-request.sequence.json` | json | 82 | No |
| `examples/checkout-platform.base.architecture.json` | json | 31 | No |
| `examples/checkout-platform.head.architecture.json` | json | 31 | No |
| `examples/dataflow-product-analytics.html` | other | 15045 | No |
| `examples/deployment-release.lifecycle.json` | json | 49 | No |
| `examples/event-stream.dataflow.json` | json | 57 | No |
| `examples/incident-response.workflow.json` | json | 64 | No |
| `examples/lifecycle-agent-run.html` | other | 14980 | No |
| `examples/product-analytics.dataflow.json` | json | 76 | No |
| `examples/production-deployment.architecture.json` | json | 71 | No |
| `examples/release-delivery.workflow.json` | json | 62 | No |
| `examples/sequence-cache-miss-request.html` | other | 15060 | No |
| `examples/web-app-rendered.html` | other | 15009 | No |
| `examples/web-app.architecture.json` | json | 46 | No |
| `examples/workflow-agent-tool-call-rendered.html` | other | 15051 | No |
| `migrations/workflow-v2.mjs` | other | 279 | No |
| `package.json` | json | 39 | No |
| `recipes/scenarios.mjs` | other | 391 | No |
| `references/authoring-contract.md` | markdown | 243 | No |
| `references/brand-marks.md` | markdown | 65 | No |
| `references/delivery-contract.md` | markdown | 120 | No |
| `references/viewer-runtime.md` | markdown | 45 | No |
| `renderers/architecture/grid.mjs` | other | 62 | No |
| `renderers/architecture/render-architecture.mjs` | other | 1078 | No |
| `renderers/dataflow/README.md` | markdown | 104 | No |
| `renderers/dataflow/render-dataflow.mjs` | other | 483 | No |
| `renderers/lifecycle/README.md` | markdown | 115 | No |
| `renderers/lifecycle/render-lifecycle.mjs` | other | 561 | No |
| `renderers/sequence/README.md` | markdown | 114 | No |
| `renderers/sequence/render-sequence.mjs` | other | 464 | No |
| `renderers/shared/brand-marks.mjs` | other | 563 | No |
| `renderers/shared/cli.mjs` | other | 218 | No |
| `renderers/shared/desktop-readability.mjs` | other | 26 | No |
| `renderers/shared/diagnostics.mjs` | other | 127 | No |
| `renderers/shared/engineering-profiles.mjs` | other | 157 | No |
| `renderers/shared/generated-brand-marks.mjs` | other | 2003 | No |
| `renderers/shared/generated-validators.mjs` | other | 13 | No |
| `renderers/shared/geometry.mjs` | other | 1423 | No |
| `renderers/shared/i18n.mjs` | other | 595 | No |
| `renderers/shared/layout-report.mjs` | other | 40 | No |
| `renderers/shared/legend.mjs` | other | 217 | No |
| `renderers/shared/output-path.mjs` | other | 340 | No |
| `renderers/shared/repository-evidence.mjs` | other | 238 | No |
| `renderers/shared/repository-location.mjs` | other | 58 | No |
| `renderers/shared/text-fit.mjs` | other | 49 | No |
| `renderers/shared/utils.mjs` | other | 232 | No |
| `renderers/shared/validator.mjs` | other | 86 | No |
| `renderers/workflow/README.md` | markdown | 223 | No |
| `renderers/workflow/render-workflow.mjs` | other | 35 | No |
| `renderers/workflow/workflow-compiler.mjs` | other | 4400 | No |
| `renderers/workflow/workflow-migration-geometry.mjs` | other | 144 | No |
| `schemas/README.md` | markdown | 211 | No |
| `schemas/architecture.schema.json` | json | 178 | No |
| `schemas/common.schema.json` | json | 115 | No |
| `schemas/dataflow.schema.json` | json | 243 | No |
| `schemas/lifecycle.schema.json` | json | 266 | No |
| `schemas/sequence.schema.json` | json | 223 | No |
| `schemas/workflow.schema.json` | json | 428 | No |
| `scripts/check-render-output.mjs` | other | 836 | No |
| `scripts/check-update.mjs` | other | 1667 | No |
| `scripts/generate-brand-marks.mjs` | other | 141 | No |
| `scripts/generate-validators.mjs` | other | 66 | No |
| `scripts/render-examples.mjs` | other | 26 | No |
| `scripts/update-contract.mjs` | other | 182 | No |
| `skill-release.json` | json | 10 | No |

## Issues (123)

### 🟢 LOW: EA3

**Location:** `LICENSE:17`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `assets/JetBrainsMono-OFL.txt:86`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `assets/template.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `examples/dataflow-product-analytics.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `examples/lifecycle-agent-run.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `examples/sequence-cache-miss-request.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `examples/web-app-rendered.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🟢 LOW: EA3

**Location:** `examples/workflow-agent-tool-call-rendered.html:134`  
**Confidence:** 70%  

**Message:** Scope Creep

**Remediation:** Limit the skill's scope to its documented purpose. Remove instructions that enable the agent to perform actions outside its stated functionality.

---

### 🔴 HIGH: PE3

**Location:** `bin/archify.mjs:71`  
**Confidence:** 60%  

**Message:** Credential Access

**Remediation:** Remove references to credential paths. Use environment variables or secrets managers. For docs, use placeholder paths (e.g., /path/to/config). Never load .env or token files in production code paths.

---

### 🔴 HIGH: PE3

**Location:** `bin/archify.mjs:71`  
**Confidence:** 60%  

**Message:** Credential Access

**Remediation:** Remove references to credential paths. Use environment variables or secrets managers. For docs, use placeholder paths (e.g., /path/to/config). Never load .env or token files in production code paths.

---

### 🔴 HIGH: P2

**Location:** `assets/template.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `assets/template.html:5230`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/dataflow-product-analytics.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/dataflow-product-analytics.html:5136`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/lifecycle-agent-run.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/lifecycle-agent-run.html:5136`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/sequence-cache-miss-request.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/sequence-cache-miss-request.html:5136`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/sequence-cache-miss-request.html:5299`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/web-app-rendered.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/web-app-rendered.html:5136`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/web-app-rendered.html:5323`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/workflow-agent-tool-call-rendered.html:4978`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `examples/workflow-agent-tool-call-rendered.html:5136`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🔴 HIGH: P2

**Location:** `renderers/shared/utils.mjs:12`  
**Confidence:** 70%  

**Message:** Hidden Instructions

**Remediation:** Audit all comments and invisible characters. Remove any instructions that direct the agent to perform unauthorized actions. Use plain, reviewable content.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:7561`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8240`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8334`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8497`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8502`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8551`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8680`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8845`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8861`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8865`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8870`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8876`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8882`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8888`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `assets/template.html:8890`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:7672`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8351`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8445`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8608`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8613`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8662`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8791`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8956`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8972`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8976`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8981`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8987`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8993`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:8999`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/dataflow-product-analytics.html:9001`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:7607`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8286`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8380`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8543`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8548`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8597`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8726`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8891`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8907`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8911`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8916`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8922`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8928`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8934`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/lifecycle-agent-run.html:8936`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:7687`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8366`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8460`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8623`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8628`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8677`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8806`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8971`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8987`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8991`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:8996`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:9002`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:9008`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:9014`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/sequence-cache-miss-request.html:9016`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:7636`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8315`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8409`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8572`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8577`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8626`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8755`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8920`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8936`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8940`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8945`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8951`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8957`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8963`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/web-app-rendered.html:8965`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:7678`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8357`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8451`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8614`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8619`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8668`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8797`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8962`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8978`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8982`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8987`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8993`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:8999`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:9005`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟡 MEDIUM: RA2

**Location:** `examples/workflow-agent-tool-call-rendered.html:9007`  
**Confidence:** 75%  

**Message:** Session Persistence

**Remediation:** Remove any persistence mechanisms (cron jobs, startup scripts, state files). Skills should not maintain state across sessions without explicit user consent.

---

### 🟢 LOW: SC1

**Location:** `package.json:31`  
**Confidence:** 40%  

**Message:** Unpinned Dependencies

**Remediation:** Pin all dependency versions in requirements.txt or pyproject.toml. Use exact versions (==) or compatible ranges. Run pip-audit regularly.

---

### 🟢 LOW: SC4

**Location:** `package.json:31`  
**Confidence:** 40%  

**Message:** Unverifiable Dependency: ajv has 2 known advisory(ies) (CVE-2025-69873 (ajv has ReDoS when using `$data` option); CVE-2020-15366 (Prototype Pollution in Ajv)), but the manifest does not pin a version, so it is unknown whether the installed release is affected

**Remediation:** Update the dependency to a patched version that addresses the known CVE. Check OSV (osv.dev) or NVD for details on the vulnerability.

---

### 🔴 HIGH: YR4

**Location:** `assets/template.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

### 🔴 HIGH: YR4

**Location:** `examples/dataflow-product-analytics.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

### 🔴 HIGH: YR4

**Location:** `examples/lifecycle-agent-run.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

### 🔴 HIGH: YR4

**Location:** `examples/sequence-cache-miss-request.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

### 🔴 HIGH: YR4

**Location:** `examples/web-app-rendered.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

### 🔴 HIGH: YR4

**Location:** `examples/workflow-agent-tool-call-rendered.html:145`  
**Confidence:** 80%  

**Message:** YARA rule 'agent_skill_mcp_tool_poisoning_metadata': MCP/tool metadata poisoning indicators in tool schemas or skill manifests [agent_skills]

**Remediation:** Remove offensive tool references and exploit code. Legitimate agent skills should not contain penetration testing tools, exploit frameworks, or reconnaissance utilities.

---

## Inspection Completeness

| Metric | Value |
|--------|-------|
| Execution | successful |
| Coverage | 100.0% |
| Fully inspected | 81 |
| Partially inspected | 0 |
| Entirely uninspected | 0 |

### Analyzer Statuses

| Reason / Status | Location | Details |
|-----------------|----------|---------|
| no_applicable_files | `` | No files matched this analyzer's applicability contract. |
| no_applicable_files | `` | No files matched this analyzer's applicability contract. |
| no_applicable_files | `` | No files matched this analyzer's applicability contract. |
| completed | `` |  |
| completed | `` |  |
| disabled_by_configuration | `` | Analyzer was disabled by the requested configuration. |
| disabled_by_configuration | `` | Analyzer was disabled by the requested configuration. |
| disabled_by_configuration | `` | Analyzer was disabled by the requested configuration. |
| disabled_by_configuration | `` | Analyzer was disabled by the requested configuration. |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |
| completed | `` |  |

### Limitations

- Analyzer was disabled by the requested configuration.
- Analyzer was disabled by the requested configuration.
- Analyzer was disabled by the requested configuration.
- Analyzer was disabled by the requested configuration.

## Metadata

- **Executable Scripts:** No

*Generated by SkillSpector v2.9.5*
