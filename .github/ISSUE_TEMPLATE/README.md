# GitHub Templates for Cloud Agents

**Design Philosophy**: 3 fields → assign → done! Agent handles the rest.

## 📋 Templates

### Discovery Phase

#### 1. 🏁 Feature Intake
**4 fields**: Idea, why, migration?, legacy repo  
**Time**: 2 minutes  
**Agent does**: Create intake doc with vision, goals, constraints, next steps

#### 2. 🔍 Reverse Engineer Legacy System
**3 fields**: Legacy repo, feature name, focus areas  
**Time**: 1 minute  
**Agent does**: Analyze legacy system, extract architecture/APIs/schemas

#### 3. 📋 Create Requirements Spec
**2 fields**: Intake doc, legacy docs  
**Time**: 30 seconds  
**Command**: `/speckit.specify` creates spec.md with user stories

### Planning Phase

#### 4. 🏗️ Technical Implementation Plan
**2 fields**: Spec path, tech preferences  
**Time**: 30 seconds  
**Command**: `/speckit.plan` creates plan/research/data-model/contracts

#### 5. ✅ Task Breakdown
**2 fields**: Plan path, create issues?  
**Time**: 30 seconds  
**Command**: `/speckit.tasks` breaks plan into 100+ executable tasks

### Execution Phase

#### 6. 💻 Implement Task from Spec
**4 fields**: Service, task ID, spec path, notes  
**Time**: 1 minute  
**Agent does**: Read spec, implement, test (80% coverage), verify runtime, create PR

#### 7. 🐛 Bug Fix  
**5 fields**: Service, severity, description, file, skip spec?  
**Time**: 1-2 minutes  
**Agent does**: Fix, regression test, verify bug gone

#### 8. ⚡ Quick Work (No Spec)
**4 fields**: Service, description, reason, impact  
**Time**: 1 minute  
**Agent does**: Implement, test, build verification

#### 9. 🧪 QA Testing
**6 fields**: Service, spec path, PR, environment, deployment status, notes  
**Time**: 2 minutes  
**Agent does**: Test execution, bug reports, production sign-off

#### 10. 📚 Generate / Update Codebase Documentation
**3 fields**: Service path, scope, focus/feature (optional)  
**Time**: 1-2 minutes  
**Agent does**: Generate or update `docs/codebase/<service>/` — code flows, APIs, models, integrations — and register reference in `copilot-instructions.md`  
**Scopes**: Quick Overview · Developer Onboarding · Comprehensive · Focused Deep Dive · Feature Update

---

## 🚀 How It Works

```
User: Fills 3 simple fields (WHAT to do)
  ↓
GitHub: Auto-generates agent prompt in issue body
  ↓
User: Assigns issue to @agent-name (or agent reads issue)
  ↓
Agent: Executes per .agent.md file (HOW - 60+ checklist items)
  ↓
CI/CD: Validates output (automated enforcement)
  ↓
Human: Reviews PR
```

**Key Innovation**: Agent prompt is **auto-generated in issue body** when you create the issue. No copy/pasting needed - just fill fields → create issue → assign to agent!

**Old approach** (❌): 60+ checkboxes, 10 minutes, template fatigue  
**New approach** (✅): 3 fields, 30 seconds, high adoption

---

## 📊 Why This Works

✅ **Low friction**: Users create issues quickly  
✅ **Clear expectations**: Agent knows exact checklist  
✅ **Automated enforcement**: CI/CD catches shortcuts  
✅ **Evidence-based**: Agent provides proof  
✅ **Auditable**: Full trail in PR

---

## 🎯 Quick Reference

| Scenario | Template |
|----------|----------|
| **Discovery Phase** |
| Start new feature | 🏁 Feature Intake |
| Analyze legacy system | 🔍 Reverse Engineer Legacy System |
| Define requirements | 📋 Create Requirements Spec |
| **Planning Phase** |
| Design technical solution | 🏗️ Technical Implementation Plan |
| Break into tasks | ✅ Task Breakdown |
| **Execution Phase** |
| Implement spec task | 💻 Implement Task from Spec |
| Fix production bug | 🐛 Bug Fix |
| Quick improvement/upgrade | ⚡ Quick Work (No Spec) |
| Test deployed feature | 🧪 QA Testing |

---

## 🔄 Complete Workflow Example

```
1. 🏁 Intake:           Capture idea → docs/intake/
2. 🔍 Reverse Engineer: Analyze legacy → docs/legacy-systems/ (if migration)
3. 📋 Requirements:     /speckit.specify → specs/###/spec.md
4. 🏗️ Tech Plan:        /speckit.plan → plan.md, contracts/
5. ✅ Task Breakdown:   /speckit.tasks → tasks.md (100+ tasks)
6. 💻 Implementation:   Implement T001-T100 → PRs
7. 🧪 QA Testing:       Test in staging → sign-off
8. 🚀 Production:       Deploy!
```

---

**See**: `.github/agents/*.agent.md` for what agents do automatically  
**Last Updated**: 2026-01-04
