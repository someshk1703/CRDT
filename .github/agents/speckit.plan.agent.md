---
description: Execute the implementation planning workflow using the plan template to generate design artifacts.
handoffs: 
  - label: Create Tasks
    agent: speckit.tasks
    prompt: Break the plan into tasks
    send: true
  - label: Create Checklist
    agent: speckit.checklist
    prompt: Create a checklist for the following domain...
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

1. **Setup**: Run `.specify/scripts/bash/setup-plan.sh --json` from repo root and parse JSON for FEATURE_SPEC, IMPL_PLAN, SPECS_DIR, BRANCH. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. **Load context**: 
   - Read FEATURE_SPEC and `.specify/memory/constitution.md`
   - **Load Repository-Wide Instructions**: Read `.github/copilot-instructions.md` for project structure, tech stack conventions, and quality standards
   - **Load ALL Path-Specific Instructions**: Read ALL files matching `.github/instructions/*.instructions.md` to ensure no patterns are missed
     - These instruction files are organized in 3 layers:
       - **Layer 1 - Core Patterns**: `architecture-patterns`, `springboot`, `bestbuy-libraries` (database standards, deployment, Artifactory - NON-NEGOTIABLE)
       - **Layer 2 - Cross-Cutting**: `operational-endpoints`, `shared-logging`, `live-config`, `config` (monitoring, logging, configuration)
       - **Layer 3 - Layer-Specific**: `controller`, `service`, `repository`, `kafka`, `model`, `dto`, `exception` (layer responsibilities)
     - **CRITICAL**: Read ALL `.instructions.md` files dynamically to catch any new instruction files added to the repository
     - Use the layered understanding above to prioritize which patterns to apply, but ensure ALL instruction files are loaded
   - Load IMPL_PLAN template (already copied)
   - **CHECK for legacy systems**: Search `docs/legacy-systems/` for related system documentation

3. **Execute plan workflow**: Follow the structure in IMPL_PLAN template to:
   - Fill Technical Context (mark unknowns as "NEEDS CLARIFICATION")
   - Fill Constitution Check section from constitution
   - **CRITICAL**: If legacy system exists, identify all existing contracts (APIs, events, data models)
   - Evaluate gates (ERROR if violations unjustified)
   - Phase 0: Generate research.md (resolve all NEEDS CLARIFICATION)
   - Phase 1: Generate data-model.md, contracts/, quickstart.md
   - **Phase 1**: VALIDATE contracts match legacy if migration/integration
   - Phase 1: Update agent context by running the agent script
   - Re-evaluate Constitution Check post-design

4. **Stop and report**: Command ends after Phase 2 planning. Report branch, IMPL_PLAN path, and generated artifacts.

## Phases

### Phase 0: Outline & Research

1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:

   ```text
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md with all NEEDS CLARIFICATION resolved

### Phase 1: Design & Contracts

**Prerequisites:** `research.md` complete

1. **Check for legacy contracts** (MANDATORY for migrations/integrations):
   - Search `docs/legacy-systems/` for existing contracts
   - If legacy contracts exist, they are AUTHORITATIVE
   - New contracts MUST match legacy format for compatibility
   - Document any deviations with explicit justification

2. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable
   - **If legacy system exists**: Match legacy data models

3. **Generate API contracts** from functional requirements:
   - **FIRST**: Check `docs/legacy-systems/{service}/` for existing contracts
   - **IF FOUND**: Use legacy contracts as template (preserve field names, types, structure)
   - **IF NOT FOUND**: Generate from requirements using standard patterns
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`
   - **Add compatibility notes** referencing legacy contracts

4. **Generate architecture diagrams** (create `/diagrams/` directory):
   - **Evaluate diagram needs** based on feature complexity and architecture
   - **Always generate** (minimum set for all features):
     - `system-architecture.md` - Services, databases, external dependencies, deployment targets
     - `data-flow.md` - How data moves through the system (request/response, events)
   - **Conditionally generate** (when applicable):
     - `sequence-diagram.md` - For complex multi-service interactions (3+ services)
     - `component-diagram.md` - Internal service structure (if new service being created)
     - `event-flow.md` - For event-driven architectures (Kafka, SQS, etc.)
     - `state-diagram.md` - For entities with complex state transitions
     - `entity-relationship.md` - For features with 3+ related entities
   - **Use Mermaid syntax** for all diagrams (renders in GitHub/VS Code)
   - **Include context**: Add description above each diagram explaining what it shows
   - **Reference instruction files**: Show which Best Buy standards apply (Aurora, DocumentDB, Stratus, etc.)
   - **Validate consistency**: Ensure diagrams match data-model.md and contracts/
   - **For migrations**: Include "before" and "after" architecture diagrams

5. **Agent context update**:
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
   - These scripts detect which AI agent is in use
   - Update the appropriate agent-specific context file
   - Add only new technology from current plan
   - Preserve manual additions between markers

6. **Validate contracts against legacy** (MANDATORY for migrations):
   - Compare generated contracts with `docs/legacy-systems/{service}/`
   - Verify field names, types, and structure match
   - ERROR if mismatches found without justification
   - Document any intentional deviations

**Output**: data-model.md, /contracts/*, /diagrams/*, quickstart.md, agent-specific file

## Key rules

- Use absolute paths
- ERROR on gate failures or unresolved clarifications
- **MANDATORY**: For migrations/integrations, check `docs/legacy-systems/` BEFORE generating contracts
- **MANDATORY**: Generated contracts MUST match legacy contracts (field names, types, structure)
- **MANDATORY**: Validate contracts against legacy at end of Phase 1
