---
description: "🔍 FOR MIGRATIONS: Analyzes legacy systems before /speckit.specify - only needed when migrating from existing code"
name: reverse-engineer
---

# Reverse Engineer Legacy Systems

**Prerequisites**:
- Repository cloning capabilities (see skill reference below)

> **📦 Skill**: Use `clone-external-repository` skill for cloning repositories. See `src/skills/clone-external-repository/SKILL.md` for authentication setup, helper scripts, and troubleshooting.

**Input**: 
- **Main Repository** (required): The primary codebase being migrated
- **Context Repositories** (optional): Upstream/downstream services for broader understanding

**Output**: Structured analysis in `docs/legacy-systems/`

## Repository Analysis Strategy

### Main Repository (Deep Analysis)
The primary target for migration receives comprehensive analysis:
- Complete architecture documentation
- All API contracts and event schemas
- Data models and storage patterns
- Business logic and processing flows
- External integrations and dependencies

### Context Repositories (Focused Analysis)
Upstream/downstream services get targeted analysis for integration understanding:
- **Upstream**: Services this repo depends on (APIs consumed, events subscribed to)
- **Downstream**: Services that depend on this repo (APIs they call, events they consume)
- Focus on: Integration contracts, shared data models, communication patterns
- Document: How they interact with main repo (API calls, event flows, shared storage)

### Integration Mapping
Create `integration-map.md` showing:
- Main repo → Upstream dependencies (what it consumes)
- Main repo → Downstream consumers (what it provides)
- Data flow diagrams with evidence from code
- Event publish/subscribe relationships
- Shared resources (databases, caches, message queues)

### Identifying Deployable Applications
Identify components with runnable entrypoints that produce executable artifacts (container images, binaries, frontend bundles), excluding shared libraries. Look for:
- Build configs: `Dockerfile`, `build.gradle`, `pom.xml`, `package.json`, `.csproj`, `requirements.txt` (search entire repository)
- Entrypoints: `main()` methods, `Program.cs`, `index.js`, `app.py`
- Deployment configs: `application.yml`, `.env`, K8s manifests

Document as table with name, type, path, build files, and entrypoint evidence. Mark findings [VERIFIED] or [INFERRED].


## Core Principles

### Repository Cloning
**CRITICAL**: Before beginning analysis, ALWAYS clone the entire repository locally.

> **📦 Skill**: Use `clone-external-repository` skill for cloning repositories. See `src/skills/clone-external-repository/SKILL.md` for full documentation.

**Why This Matters**:
- Allows cloning private Best Buy repositories
- Ensures you have access to all files, build configs, tests, and documentation
- Enables use of grep, file search, and read_file tools for comprehensive analysis
- Analyze the actual code files, not just GitHub's web interface

### Evidence-Based Analysis
- ONLY document what you can directly observe in the codebase
- Quote actual code snippets to support findings
- Never infer architecture or behavior without explicit evidence
- Mark uncertain interpretations with "[ASSUMPTION]" prefix

### Handling Ambiguity
When encountering unclear or ambiguous code:
1. Document multiple possible interpretations
2. List specific evidence for each interpretation
3. Flag the ambiguity with "[REQUIRES CLARIFICATION]"
4. Ask specific questions referencing file paths and line numbers

### Assumption Management
When you must make assumptions to proceed:
1. Explicitly state: "[ASSUMPTION: <description>]"
2. Explain why the assumption is necessary
3. Provide evidence that led to the assumption
4. Suggest how to validate the assumption
5. Continue analysis with the assumption clearly marked

## Extraction Checklist

**Note on Enhanced Sections**: Sections marked "Recommended" or "Optional" should be completed based on:

### Priority Levels Explained

**CORE (Always Required)**:
- Architecture, API Contracts, Event Schemas, Data Models, Patterns
- **Why**: These are the minimum artifacts needed to rewrite a system. Without them, you cannot recreate the external interfaces and data structures.

**RECOMMENDED (Complete for Production Migrations)**:
- Business Logic Flows, Configuration & Environment, Error Handling, Testing Strategy
- **Why Business Logic**: Prevents missing critical workflows and business rules that aren't obvious from API contracts alone. Without this, you risk silent functional regressions.
- **Why Configuration**: Misconfiguration is the #1 cause of post-migration failures. Environment-specific behavior must be explicitly captured.
- **Why Error Handling**: Client systems depend on specific error responses and retry behaviors. Changing these breaks integrations.
- **Why Testing**: Existing tests reveal what the original developers thought was critical. They serve as regression tests for the new implementation.

**OPTIONAL (Use When Needed)**:
- Code Dependencies, Performance Characteristics
- **Why Code Dependencies**: Only needed for large codebases (>50 files) or when refactoring during migration. For small services, the code structure is self-evident from reading it.
- **Why Performance**: Only document if the legacy system has known performance requirements or SLAs. Otherwise, establish baselines post-migration.

**SKIP (For Simple Migrations)**:
- For proof-of-concepts, internal tools, or services with <10 endpoints, focus only on CORE sections to save time.

### Architecture
- [ ] Identify main components from project structure
- [ ] Document inter-service communication patterns (with code references)
- [ ] Map dependencies from import statements and config files
- [ ] Flag unclear architectural boundaries with [REQUIRES CLARIFICATION]
- [ ] Note: Do NOT create architecture diagrams without verifiable component relationships

### API Contracts
- [ ] Extract endpoint definitions from route handlers
- [ ] Document request/response schemas from validation code or type definitions
- [ ] Identify authentication/authorization mechanisms
- [ ] List all HTTP methods, paths, and parameters with file references
- [ ] Mark undocumented endpoints with [ASSUMPTION: <inferred behavior>]
- [ ] Ask for clarification on endpoints with inconsistent patterns

### Event Schemas
- [ ] Locate event producer code (publish/send calls)
- [ ] Locate event consumer code (subscribe/listen handlers)
- [ ] Extract message formats from serialization code
- [ ] Document topic/queue names from configuration
- [ ] Flag events with unclear payload structures with [REQUIRES CLARIFICATION]

### Integration Verification (Critical for Accuracy)
**Before documenting any integration, verify thoroughly:**

#### Event-Based Integration
- [ ] Grep for ALL producers of each topic/event across all repositories
- [ ] Grep for ALL consumers of each topic/event across all repositories
- [ ] Verify topic names from actual code, not assumptions
- [ ] Check Kafka/messaging configuration for topic naming patterns
- [ ] Document producer → topic → consumer chains with file references
- [ ] Note: "[VERIFIED: Grepped entire codebase for 'order-placed']" or "[PARTIAL: Only checked main repo]"

#### REST API Integration
- [ ] Grep for ALL REST client usages (RestTemplate, WebClient, HttpClient, etc.)
- [ ] Extract actual endpoint URLs from configuration or code
- [ ] Verify HTTP methods from client code
- [ ] Check for authentication/authorization headers
- [ ] Identify circuit breakers, retries, timeouts from actual config/annotations
- [ ] Document: "Calls endpoint X [VERIFIED: RestClient.java:45, endpoints.yml:23]"

#### Database/Storage Integration
- [ ] Identify ALL data sources from configuration
- [ ] Check for shared databases between services (document with evidence)
- [ ] Verify connection pooling configuration
- [ ] Note caching layers (Redis, Memcached) with actual usage evidence
- [ ] Document: "[VERIFIED: application.yml:12, DataSourceConfig.java:34]"

### Data Models
- [ ] Extract schema definitions from ORM models, database migrations, or type definitions
- [ ] Document relationships between entities
- [ ] Identify primary/foreign keys and constraints
- [ ] Note any schema inconsistencies between services
- [ ] Mark inferred relationships with [ASSUMPTION: based on field naming]

### Polymorphism & Dependency Injection (High Hallucination Risk)
**When documenting interfaces, abstract classes, or @Autowired dependencies:**

- [ ] Find ALL implementations of each interface using grep/search
- [ ] Check Spring/Jakarta configuration for which implementation is wired
- [ ] Document profile-specific implementations (dev vs. prod)
- [ ] Check for @Qualifier, @Primary, or @ConditionalOnProperty annotations
- [ ] For multiple implementations, document: "Interface X has implementations [A, B, C]. Active implementation: [determined by profile/config] [VERIFIED: AppConfig.java:56]"
- [ ] If unclear, document: "Interface X has implementations [A, B]. Active implementation unclear [REQUIRES CLARIFICATION: Check runtime profile]"

**Example**:
```markdown
❌ Bad: "Uses NotificationService for sending notifications"
✅ Good: "Uses NotificationService interface (File: NotificationService.java:1). Implementations found:
  - EmailNotificationService (File: EmailNotificationService.java:15)
  - PushNotificationService (File: PushNotificationService.java:12)
  Active implementation: PushNotificationService when spring.profiles.active=prod [VERIFIED: application-prod.yml:8]
```

### Conditional Logic & Feature Flags (Medium Hallucination Risk)
**When encountering if/else or switch statements:**

- [ ] Document ALL code paths, not just the "happy path"
- [ ] Identify feature flags and their impact on behavior
- [ ] Check configuration for flag default values
- [ ] Note environment-specific logic branches
- [ ] Document: "Behavior varies based on flag X [VERIFIED: FeatureService.java:45-78, shows both paths]"

**Example**:
```markdown
❌ Bad: "Processes orders through new checkout flow"
✅ Good: "Order processing has two paths:
  1. If feature.new_checkout=true: Uses NewCheckoutService [VERIFIED: OrderController.java:45-67]
  2. If feature.new_checkout=false: Uses LegacyCheckoutService [VERIFIED: OrderController.java:69-89]
  Default: false [VERIFIED: application.yml:23]
```

### Business Logic Flows (Recommended for Complex Migrations)
- [ ] Document 3-5 critical business workflows with code paths
- [ ] Map business rules to implementation locations (where logic lives)
- [ ] Identify decision points and branching logic with file references
- [ ] Extract validation rules and business constraints
- [ ] Note side effects (emails sent, events published, external API calls)
- [ ] Trace user journeys end-to-end through the codebase
- [ ] Mark complex business logic with [REQUIRES VALIDATION]

### Code Dependencies (Optional - For Large Codebases)
- [ ] Map class/module dependencies (what calls what)
- [ ] Identify circular dependencies between components
- [ ] Document shared utilities and their usage patterns
- [ ] List tightly coupled components that should be refactored
- [ ] Note dead/unused code that can be excluded from migration
- [ ] Extract common libraries and their versions

### Configuration & Environment (Recommended)
- [ ] Document ALL configuration sources (see Configuration Source Verification below)
- [ ] Extract feature flags and their impact on behavior
- [ ] Map environment-specific differences (dev/staging/prod)
- [ ] Identify secrets and credential management patterns
- [ ] Document runtime behavior changes based on configuration
- [ ] Note configuration validation and defaults
- [ ] List external configuration dependencies (e.g., Consul, Spring Cloud Config)

### Configuration Source Verification (Critical - High Miss Rate)
**Check ALL possible configuration sources:**

- [ ] Application config files: `application.yml`, `application.properties`, `config.json`, etc.
- [ ] Profile-specific configs: `application-dev.yml`, `application-prod.yml`, etc.
- [ ] Environment variables: Check Dockerfile, docker-compose.yml, K8s manifests, .env files
- [ ] External config services: Spring Cloud Config, Consul, AWS Systems Manager, live-config
- [ ] Build-time config: Maven/Gradle properties, build profiles
- [ ] Runtime overrides: System.setProperty(), @TestPropertySource, command-line args
- [ ] Hardcoded values: Search for hardcoded URLs, timeouts, retry counts in code

**Document**:
```markdown
Configuration sources identified:
- application.yml (File: src/main/resources/application.yml)
- Environment variables: DB_HOST, API_KEY (File: docker-compose.yml:23-25)
- External: Spring Cloud Config (File: bootstrap.yml:5)

[ASSUMPTION: May have missed runtime overrides or live-config sources]
```

### Error Handling & Edge Cases (Recommended for APIs/Event Processing)
- [ ] Document exception handling strategies with code examples
- [ ] Identify retry/timeout/backoff patterns
- [ ] Map error responses (HTTP codes, error messages, error formats)
- [ ] Note circuit breakers and fallback logic
- [ ] Extract validation error messages and formats
- [ ] Document logging patterns for errors
- [ ] Identify graceful degradation strategies

### Performance Characteristics (Optional)
- [ ] Identify caching strategies (where, what, TTL)
- [ ] Document batch processing vs. real-time patterns
- [ ] Note async operations and background jobs
- [ ] Extract rate limiting/throttling logic
- [ ] Identify known performance bottlenecks from comments/docs
- [ ] Document connection pooling and resource management

### Testing Strategy & Coverage (Recommended if Tests Exist)
- [ ] Identify existing test types (unit, integration, e2e, contract)
- [ ] Document critical test scenarios and assertions
- [ ] Extract test data patterns and fixtures
- [ ] Note untested areas (risk assessment for migration)
- [ ] List mocked dependencies in tests
- [ ] Document test execution patterns (setup/teardown)
- [ ] Identify flaky or skipped tests with explanations

### Patterns & Anti-Patterns
- [ ] Document observed patterns with specific code examples
- [ ] Identify code smells with severity and file locations
- [ ] Note inconsistent implementations of similar features
- [ ] List technical debt areas with concrete examples
- [ ] Do NOT suggest fixes unless explicitly requested

## Architecture & Integration Relationship Rules

**Documenting component relationships is HIGH RISK for hallucination.**

### DO: Document Observable Facts
✅ "Found `KafkaTemplate.send('order-placed')` in OrderService.java:45"
✅ "Found `@KafkaListener(topics='order-placed')` in NotificationService.java:67"
✅ "Found `RestTemplate.postForEntity('http://inventory-api/check')` in OrderService.java:89"

### DON'T: Infer Direct Relationships
❌ "OrderService publishes to NotificationService" ← Implies direct connection
❌ "OrderService calls InventoryService" ← Assumes ownership of endpoint

### DO: Document Indirect Relationships with Evidence
✅ **Good Pattern**:
```markdown
## Event Flow: order-placed

**Producers**:
- OrderService publishes to 'order-placed' topic [VERIFIED: OrderService.java:45]

**Consumers**:
- NotificationService consumes from 'order-placed' topic [VERIFIED: NotificationService.java:67]
- InventoryService consumes from 'order-placed' topic [VERIFIED: InventoryService.java:123]

[INFERRED: OrderService indirectly triggers NotificationService and InventoryService via Kafka]
```

### Architecture Diagram Rules
- Only create diagrams after verifying ALL relationships
- Use evidence-based connections only
- Label connections with mechanism (Kafka topic name, REST endpoint, database)
- Include file references in diagram annotations
- If any relationship is [ASSUMPTION], note it prominently on diagram

---

## Clarification Protocol

Before completing analysis, review all [REQUIRES CLARIFICATION] items and output:

**Questions for Stakeholders:**
1. [Component X] - Found references to Y but no implementation. Is this:
   - An external service?
   - Deprecated code?
   - Located in a different repository?
   
2. [API Endpoint Z] - Observed behavior in `/path/to/file.js:123` conflicts with `/other/path.js:456`. Which is authoritative?

**Assumptions Made:**
1. [Database Schema] - Assumed table X links to table Y based on field name `y_id`, but no explicit foreign key found. Please verify.

## Sample Prompts

**Example 1 - Single Repository (No Context)**:
```
@reverse-engineer Analyze https://github.com/bestbuy/dotnet-notification-service
```

**Example 2 - Main Repo + Context Repos**:
```
@reverse-engineer 
Main Repository: https://github.com/bestbuy/notification-service

Upstream Context (services we depend on):
- https://github.com/bestbuy/order-api (we subscribe to order events)
- https://github.com/bestbuy/customer-api (we call to get customer preferences)

Downstream Context (services that depend on us):
- https://github.com/bestbuy/mobile-app (consumes our push notification API)

Focus: Understand integration contracts and event flows
```

**Example 3 - Multiple Related Services (Equal Weight)**:
```
@reverse-engineer Analyze the following repositories:
- https://github.com/bestbuy/order-api
- https://github.com/bestbuy/notification-service
- https://github.com/bestbuy/payment-gateway

Note: Treat all equally - we're migrating the entire order processing system
```

**Example 4 - With Specific Focus**:
```
@reverse-engineer 
Main: https://github.com/bestbuy/legacy-cart

Upstream: 
- https://github.com/bestbuy/inventory-service (for stock checks)

Downstream:
- https://github.com/bestbuy/checkout-service (receives cart data)

Focus on: API contracts, event schemas, shared data models
```

## Output Structure

For the **main repository**, create comprehensive analysis:

```
docs/legacy-systems/
  <main-repo-name>/
    overview.md           # High-level summary with evidence
    architecture.md       # Component structure (evidence-based only)
    integration-map.md    # Upstream/downstream relationships
    apis/
      <service-name>.yaml # OpenAPI/Contract specs
    events/
      <topic-name>.json   # Event schemas
    data-models/
      <entity>.md         # Schema documentation
    business-flows/       # NEW: Critical business workflows
      <workflow-name>.md  # End-to-end flow with code paths
    configuration/        # NEW: Configuration analysis
      config-analysis.md  # All config sources and patterns
      environment-differences.md  # Dev/staging/prod differences
      feature-flags.md    # Feature flag documentation
    error-handling/       # NEW: Error patterns (if applicable)
      patterns.md         # Exception handling strategies
      edge-cases.md       # Known edge cases and handling
    performance/          # NEW: Performance patterns (if applicable)
      caching-strategies.md
      async-patterns.md
    testing/              # NEW: Test analysis (if tests exist)
      test-coverage.md    # Coverage analysis and gaps
      critical-scenarios.md  # Key test scenarios
    dependencies/         # NEW: Code dependency analysis (optional)
      dependency-graph.md # Internal component dependencies
      external-libs.md    # Third-party dependencies
    patterns.md           # Observed patterns with examples
    assumptions.md        # All assumptions and clarifications needed
    evidence/             # Referenced code snippets
      <file-name>.md
```

For **context repositories** (upstream/downstream), create focused analysis:

```
docs/legacy-systems/
  context/
    <upstream-repo-name>/
      integration-summary.md    # How main repo depends on this
      exposed-apis.yaml         # APIs main repo calls
      published-events.json     # Events main repo subscribes to
    <downstream-repo-name>/
      integration-summary.md    # How this depends on main repo
      consumed-apis.yaml        # APIs this calls on main repo
      subscribed-events.json    # Events this consumes from main repo
```

**integration-map.md format**:
```markdown
# Integration Map: <main-repo>

## Upstream Dependencies (What We Consume)

### order-api
- **Type**: REST API
- **Purpose**: Subscribe to order placement events
- **Evidence**: `src/listeners/OrderListener.cs:45-67`
- **Contract**: `events/order-placed.json`

## Downstream Consumers (What We Provide)

### mobile-app
- **Type**: REST API + Push Notifications
- **Purpose**: Sends push notifications via our API
- **Evidence**: Found in mobile-app `/src/api/notifications.ts:23`
- **Contract**: `apis/push-api.yaml`
```

## Quality Gates

Before marking analysis complete:
- [ ] Every claim has a code reference (file + line number)
- [ ] All assumptions are documented in assumptions.md
- [ ] Clarification questions are specific and actionable
- [ ] No architecture diagrams without verified relationships
- [ ] No behavioral descriptions without supporting code
- [ ] Evidence snippets are stored in evidence/ folder

---

## Anti-Hallucination Verification 🚨

**MANDATORY FINAL CHECK**: Review before completing analysis.

### Integration Accuracy
- [ ] All event producers found via grep (not assumed from naming)
- [ ] All event consumers found via grep (not assumed from naming)
- [ ] All REST endpoints verified from actual client code
- [ ] All database connections verified from configuration
- [ ] Integration relationships marked [VERIFIED] or [INFERRED] appropriately

### Implementation Accuracy
- [ ] All interfaces checked for multiple implementations
- [ ] Active implementation identified from Spring/DI config
- [ ] Profile-specific implementations documented
- [ ] Polymorphism documented, not assumed

### Configuration Accuracy
- [ ] All configuration sources checked (app config, env vars, external)
- [ ] Environment-specific overrides documented
- [ ] Feature flags documented with default values
- [ ] Hardcoded values in code identified
- [ ] Document: "[VERIFIED: Checked 5 config sources]" or "[PARTIAL: Only checked application.yml]"

### Conditional Logic Accuracy
- [ ] All code paths documented (not just happy path)
- [ ] Feature flag impacts on behavior documented
- [ ] If/else branches traced completely
- [ ] Environment-specific logic identified

### Relationship Accuracy
- [ ] No implied direct relationships without evidence
- [ ] Indirect relationships (via events, queues) explicitly noted
- [ ] Integration mechanisms named (Kafka topic, REST endpoint, DB)
- [ ] Architecture diagrams have evidence for all connections
- [ ] Inferred relationships marked with [INFERRED] and explanation

### Evidence Quality
- [ ] Every claim cites file + line numbers
- [ ] Code snippets copy-pasted (not paraphrased)
- [ ] No invented method/class names
- [ ] No assumptions about "standard" framework behavior without verification

### Assumption Transparency
- [ ] All [ASSUMPTION] tags have explanation of why assumption was made
- [ ] All [REQUIRES CLARIFICATION] items have specific questions
- [ ] All [UNKNOWN] items documented instead of invented
- [ ] assumptions.md contains complete list

---
