# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Java 21 (LTS), Java 17, Kotlin 1.9 or NEEDS CLARIFICATION]  
**Primary Dependencies**: [e.g., Spring Boot 3.2, Spring Data JPA, Hibernate or NEEDS CLARIFICATION]  
**Storage**: [if applicable, e.g., PostgreSQL 15, MySQL 8, MongoDB or N/A]  
**Testing**: [e.g., JUnit 5, Mockito, TestContainers, Spring Boot Test or NEEDS CLARIFICATION]  
**Target Platform**: [e.g., Linux server, Docker container, Kubernetes or NEEDS CLARIFICATION]
**Project Type**: [single/web/mobile - determines source structure]  
**Performance Goals**: [domain-specific, e.g., 1000 req/s, <500ms p95 latency or NEEDS CLARIFICATION]  
**Constraints**: [domain-specific, e.g., <200ms p95, <512MB memory, 80% test coverage or NEEDS CLARIFICATION]  
**Scale/Scope**: [domain-specific, e.g., 10k concurrent users, 1M transactions/day or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Specification-Driven Development** (Principle I)
- [ ] Feature specification exists with prioritized user stories (P1, P2, P3...)
- [ ] Each user story has acceptance criteria in Given-When-Then format
- [ ] Unclear requirements marked as "NEEDS CLARIFICATION"
- [ ] All user stories are independently testable

**Comprehensive Testing Standards** (Principle II)
- [ ] Test strategy defined (JUnit 5, Mockito, TestContainers)
- [ ] Tests will validate conformance to specifications and contracts
- [ ] Minimum 80% code coverage required
- [ ] Given-When-Then structure planned for all tests

**Independent User Story Implementation** (Principle III)
- [ ] User stories prioritized and can be implemented independently
- [ ] Foundational/shared infrastructure identified and will be completed first
- [ ] Each story delivers standalone, demonstrable value
- [ ] No hidden dependencies between stories

**Integration Testing** (Principle IV)
- [ ] Contract tests planned for all API endpoints/interfaces
- [ ] TestContainers planned for database integration tests
- [ ] Inter-service communication testing strategy defined
- [ ] Spring Boot system tests (`@SpringBootTest`) planned for end-to-end flows

**Observability and Traceability** (Principle V)
- [ ] Structured logging approach defined
- [ ] Error handling strategy includes context (operation, inputs, state)
- [ ] Configuration externalization planned
- [ ] Correlation IDs or request tracing planned

**Quality Standards**
- [ ] 80%+ test coverage target confirmed per service/module
- [ ] Code review process acknowledged
- [ ] Static analysis (SonarQube) will be used
- [ ] Public APIs will have Javadoc with examples

**Monorepo Architecture Standards** (if applicable)
- [ ] Service boundaries clearly defined with distinct responsibilities
- [ ] Shared code identified for extraction to libs/ (common, domain, contracts)
- [ ] Inter-service API contracts documented and versioned
- [ ] No circular dependencies between services/modules
- [ ] Each affected service independently buildable and testable
- [ ] Service/module versioning strategy defined (semantic versioning)
- [ ] Each service has README with purpose, dependencies, and API

**Performance Standards** (if applicable)
- [ ] P95 latency < 500ms target acknowledged
- [ ] N+1 query prevention strategy defined
- [ ] Throughput requirements identified (1000 req/s per service)
- [ ] Cross-service communication minimized (async/event-driven patterns considered)

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
├── diagrams/            # Phase 1 output (/speckit.plan command)
│   ├── system-architecture.md
│   ├── data-flow.md
│   └── [other diagrams as applicable]
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Monorepo - Multiple Services (DEFAULT for modern-monorepo)
services/
├── [service-name]/
│   ├── src/
│   │   ├── main/java/com/bestbuy/order/[service]/
│   │   │   ├── model/
│   │   │   ├── service/
│   │   │   ├── controller/
│   │   │   └── repository/
│   │   └── test/java/com/bestbuy/order/[service]/
│   │       ├── contract/
│   │       ├── integration/
│   │       └── unit/
│   ├── pom.xml or build.gradle
│   └── README.md
└── [another-service]/

libs/
├── common/          # Shared utilities, exceptions, logging
├── domain/          # Shared domain models, DTOs
└── contracts/       # API contracts, interfaces

apps/                # If frontend apps exist
└── [app-name]/

# [REMOVE IF UNUSED] Option 2: Single Service (non-monorepo project)
src/
├── main/java/com/example/
│   ├── model/
│   ├── service/
│   └── controller/
└── test/java/com/example/
    ├── contract/
    ├── integration/
    └── unit/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
services/
└── [service-name]/  # Backend API in monorepo

apps/
├── ios/            # iOS app
└── android/        # Android app
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
