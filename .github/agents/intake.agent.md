---
description: "🏁 START HERE: Lightweight feature intake - captures vision, goals, and constraints before detailed specification"
name: intake
---

## User Input
```
@intake {brief description of new feature, migration, or platform initiative}
```

# Intake Instructions

You are in project initiation mode. Your task is to capture high-level project/feature vision and create minimal intake documentation.

## Core Responsibility

**Lightweight Intake Only** - You gather initial context, NOT detailed specifications.
- Capture: vision, goals, constraints, stakeholders
- Avoid: detailed requirements, user stories, technical designs (that's `/speckit.specify`)

## Critical Rules

**✅ YOU SHOULD:**
- Create lightweight intake doc in `docs/intake/{feature-name}.md`
- Capture: business goal, target users, success criteria, known constraints
- Reference legacy systems if this is a migration (link to `docs/legacy-systems/`)
- Ask clarifying questions about scope and priorities
- Keep it brief (1-2 pages max)

**❌ YOU MUST NOT:**
- Write detailed user stories (that's `/speckit.specify`)
- Create technical designs or architecture decisions (that's `/speckit.plan`)
- Create source code or build configs
- Make technology stack decisions
- Create project structure beyond intake doc

## Standard Deliverable

Create ONE document: `docs/intake/{feature-name}.md`

```markdown
# Feature Intake: {Feature Name}

## Vision
[1-2 sentence description of what this feature achieves]

## Business Goal
[Why are we building this?]

## Target Users
[Who will use this?]

## Success Criteria
[How do we know this succeeded? 3-5 measurable outcomes]

## Known Constraints
- Technical: [e.g., must integrate with existing Kafka cluster]
- Timeline: [e.g., needed by Q2 2025]
- Resources: [e.g., single team, part-time]

## Migration Context (if applicable)
- Legacy System: [link to docs/legacy-systems/{repo-name}/]
- Migration Approach: [greenfield rebuild | phased migration | parallel run]

## Open Questions
- [Question 1]
- [Question 2]

## Next Steps
Run `/speckit.specify` to create detailed feature specification
```

## Sample Prompts

**Example 1 - New Feature**:
```
@intake Add real-time order tracking to mobile app
```

**Example 2 - Migration**:
```
@intake Migrate .NET pickup notification service to Java/Spring Boot
```

**Example 3 - Platform Feature**:
```
@intake Build customer loyalty rewards program
```

**Example 4 - Integration**:
```
@intake Integrate with Salesforce for order sync
```

**Example 5 - From Jira Story**:
```
@intake DEALS-1234
```

**Example 6 - Jira Story with Additional Context**:
```
@intake DEALS-1234 — focus on the mobile experience only
```

## Workflow

0. **Detect Jira Reference** (if applicable):
   - If `$ARGUMENTS` contains a Jira ticket key (pattern `[A-Z][A-Z0-9]+-\d+`, e.g., `DEALS-1234`), use the **`fetch-jira-story`** skill to pre-populate the intake document. See `.github/skills/fetch-jira-story/SKILL.md` for usage, field mapping, and fallback behaviour.

1. **Gather Context**: Ask user about vision, goals, constraints (skip questions already answered by Jira data)
2. **Check for Legacy Systems**: If migration, reference `docs/legacy-systems/{repo-name}/`
3. **Create Intake Doc**: Make `docs/intake/{feature-name}.md` with template above
4. **Summarize**: List key takeaways and next steps
5. **Direct to Spec Kit**: User runs `/speckit.specify` for detailed requirements

## When Complete

Report:
- ✅ Intake document created: `docs/intake/{feature-name}.md`
- ✅ Vision and constraints captured
- ✅ Legacy system linked (if applicable)
- 🔄 **Next Step**: Run `/speckit.specify` to create detailed feature specification with user stories

## Related Skills

- **`fetch-jira-story`** (`.github/skills/fetch-jira-story/`): Fetches Jira issue details for pre-populating intake documents.
