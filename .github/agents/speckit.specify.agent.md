---
description: Create or update the feature specification from a natural language feature description.
handoffs: 
  - label: Build Technical Plan
    agent: speckit.plan
    prompt: Create a plan for the spec. I am building with...
  - label: Clarify Spec Requirements
    agent: speckit.clarify
    prompt: Clarify specification requirements
    send: true
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

The text the user typed after `/speckit.specify` in the triggering message **is** the feature description. Assume you always have it available in this conversation even if `$ARGUMENTS` appears literally below. Do not ask the user to repeat it unless they provided an empty command.

Given that feature description, do this:

1. **Detect Charter Brief** (if applicable):
   - If `$ARGUMENTS` is a file path pointing to a file in `docs/intake/` whose name starts with `charter-`, treat it as a **charter brief intake doc**
   - Read the file and confirm it contains a `## 2. Domain Responsibilities` section
   - If confirmed, apply these **charter brief rules** for the entire spec:
     - **Scope**: Requirements MUST come only from the "Domain Responsibilities" and "Interfaces to Implement" tables — do not add scope beyond what the brief specifies
     - **Interfaces to Implement**: Each row in that table becomes a required functional requirement (P1)
     - **Interfaces to Consume**: Treat as external dependencies — list them in the spec's Dependencies section; do not spec their internals
     - **ADRs**: Copy all rows from "Relevant ADRs" into the spec's Dependencies/Assumptions section with their links
     - **Charter reference**: Add the charter name and the value-stream-workspace path as the first entry in the spec's Dependencies section
     - **[NEEDS CLARIFICATION] limit**: Still max 3 markers, but do NOT raise clarifications on scope — the brief is the scope authority
   - If the file does not contain `## 2. Domain Responsibilities`, treat it as a standard intake doc (fall through to normal flow)

2. **Detect Jira Reference** (if applicable):
   - If `$ARGUMENTS` contains a Jira ticket key (pattern `[A-Z][A-Z0-9]+-\d+`, e.g., `DEALS-1234`), use the **`fetch-jira-story`** skill to pre-populate the specification. See `.github/skills/fetch-jira-story/SKILL.md` for usage, field mapping, and fallback behaviour.

3. **Generate a concise short name** (2-4 words) for the branch:
   - Analyze the feature description and extract the most meaningful keywords
   - Create a 2-4 word short name that captures the essence of the feature
   - Use action-noun format when possible (e.g., "add-user-auth", "fix-payment-bug")
   - Preserve technical terms and acronyms (OAuth2, API, JWT, etc.)
   - Keep it concise but descriptive enough to understand the feature at a glance
   - Examples:
     - "I want to add user authentication" → "user-auth"
     - "Implement OAuth2 integration for the API" → "oauth2-api-integration"
     - "Create a dashboard for analytics" → "analytics-dashboard"
     - "Fix payment processing timeout bug" → "fix-payment-timeout"

4. **Check current branch and create specification**:
   
   The `create-new-feature.sh` script now intelligently handles existing branches:
   - If you're on `main`, `master`, or `develop`, it creates a new feature branch
   - If you're already on a feature branch (e.g., created by GitHub Copilot agent), it uses that branch
   
   **Workflow**:
   
   a. First, check current branch:
      ```bash
      git branch --show-current
      ```
   
   b. Run the script `.specify/scripts/bash/create-new-feature.sh --json "$ARGUMENTS"`:
      - If on a feature branch: Script detects it and creates spec directory matching the branch name
      - If on main/master/develop: Script creates a new numbered branch as before
      - Bash example: `.specify/scripts/bash/create-new-feature.sh --json "Add user authentication"`
      - PowerShell example: `.specify/scripts/bash/create-new-feature.sh -Json "Add user authentication"`
   
   **IMPORTANT**:
   - The script now detects existing feature branches automatically (e.g., `copilot-123-add-auth`)
   - When detected, it creates `specs/copilot-123-add-auth/spec.md` without creating a new branch
   - This works seamlessly with GitHub Copilot's coding agent workflow
   - You must only ever run this script once per feature
   - The JSON is provided in the terminal as output - always refer to it to get the actual content you're looking for
   - The JSON output will contain BRANCH_NAME and SPEC_FILE paths
   - For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot")
   
   c. **Advanced usage** (when you want to override auto-detection):
      - To force a specific branch number: Add `--number N`
      - To force a specific short name: Add `--short-name "name"`
      - Example: `.specify/scripts/bash/create-new-feature.sh --json --number 5 --short-name "user-auth" "Add user authentication"`

5. Load `.specify/templates/spec-template.md` to understand required sections.

6. **Check for legacy systems** (CRITICAL for migrations/integrations):
   - If feature description mentions "migration", "replace", "modernize", or references existing systems
   - Search `docs/legacy-systems/` for related documentation
   - If legacy system found:
     - Note the existing contracts/APIs/events in Assumptions section
     - Add explicit backward compatibility requirements
     - Reference legacy documentation in Dependencies section
   - If NOT found but description suggests migration:
     - Add [NEEDS CLARIFICATION: Which existing system is being replaced?]

7. Follow this execution flow:

    1. Parse user description from Input
       If empty: ERROR "No feature description provided"
    2. Extract key concepts from description
       Identify: actors, actions, data, constraints
    3. For unclear aspects:
       - Make informed guesses based on context and industry standards
       - Only mark with [NEEDS CLARIFICATION: specific question] if:
         - The choice significantly impacts feature scope or user experience
         - Multiple reasonable interpretations exist with different implications
         - No reasonable default exists
       - **LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total**
       - Prioritize clarifications by impact: scope > security/privacy > user experience > technical details
    4. Fill User Scenarios & Testing section
       If no clear user flow: ERROR "Cannot determine user scenarios"
    5. Generate Functional Requirements
       Each requirement must be testable
       Use reasonable defaults for unspecified details (document assumptions in Assumptions section)
       **For migrations**: Include explicit backward compatibility requirements:
       - Existing API/event contracts must remain unchanged (or versioned)
       - Data migration strategy (if applicable)
       - Parallel run/cutover approach
       - Reference legacy system documentation in requirements
    6. Define Success Criteria
       Create measurable, technology-agnostic outcomes
       Include both quantitative metrics (time, performance, volume) and qualitative measures (user satisfaction, task completion)
       Each criterion must be verifiable without implementation details
    7. Identify Key Entities (if data involved)
    8. **Validate migration assumptions** (if applicable):
       - Verify assumption about frozen contracts/schemas is explicit
       - Confirm backward compatibility requirements are stated
       - Check that legacy system is referenced in Dependencies section
    9. Return: SUCCESS (spec ready for planning)

8. Write the specification to SPEC_FILE using the template structure, replacing placeholders with concrete details derived from the feature description (arguments) while preserving section order and headings.

9. **Specification Quality Validation**: After writing the initial spec, validate it against quality criteria:

   a. **Create Spec Quality Checklist**: Generate a checklist file at `FEATURE_DIR/checklists/requirements.md` using the checklist template structure with these validation items:

      ```markdown
      # Specification Quality Checklist: [FEATURE NAME]
      
      **Purpose**: Validate specification completeness and quality before proceeding to planning
      **Created**: [DATE]
      **Feature**: [Link to spec.md]
      
      ## Content Quality
      
      - [ ] No implementation details (languages, frameworks, APIs)
      - [ ] Focused on user value and business needs
      - [ ] Written for non-technical stakeholders
      - [ ] All mandatory sections completed
      
      ## Requirement Completeness
      
      - [ ] No [NEEDS CLARIFICATION] markers remain
      - [ ] Requirements are testable and unambiguous
      - [ ] Success criteria are measurable
      - [ ] Success criteria are technology-agnostic (no implementation details)
      - [ ] All acceptance scenarios are defined
      - [ ] Edge cases are identified
      - [ ] Scope is clearly bounded
      - [ ] Dependencies and assumptions identified
      
      ## Migration/Integration Checks (if applicable)
      
      - [ ] Legacy system identified and documented in Dependencies
      - [ ] Existing contracts/APIs/events documented in Assumptions
      - [ ] Backward compatibility requirements explicit (frozen schemas/APIs)
      - [ ] Migration strategy included (parallel run, cutover, data migration)
      - [ ] Feature parity requirements defined
      - [ ] References to legacy system documentation included
      
      ## Feature Readiness
      
      - [ ] All functional requirements have clear acceptance criteria
      - [ ] User scenarios cover primary flows
      - [ ] Feature meets measurable outcomes defined in Success Criteria
      - [ ] No implementation details leak into specification
      
      ## Notes
      
      - Items marked incomplete require spec updates before `/speckit.clarify` or `/speckit.plan`
      ```

   b. **Run Validation Check**: Review the spec against each checklist item:
      - For each item, determine if it passes or fails
      - Document specific issues found (quote relevant spec sections)

   c. **Handle Validation Results**:

      - **If all items pass**: Mark checklist complete and proceed to step 6

      - **If items fail (excluding [NEEDS CLARIFICATION])**:
        1. List the failing items and specific issues
        2. Update the spec to address each issue
        3. Re-run validation until all items pass (max 3 iterations)
        4. If still failing after 3 iterations, document remaining issues in checklist notes and warn user

      - **If [NEEDS CLARIFICATION] markers remain**:
        1. Extract all [NEEDS CLARIFICATION: ...] markers from the spec
        2. **LIMIT CHECK**: If more than 3 markers exist, keep only the 3 most critical (by scope/security/UX impact) and make informed guesses for the rest
        3. For each clarification needed (max 3), present options to user in this format:

           ```markdown
           ## Question [N]: [Topic]
           
           **Context**: [Quote relevant spec section]
           
           **What we need to know**: [Specific question from NEEDS CLARIFICATION marker]
           
           **Suggested Answers**:
           
           | Option | Answer | Implications |
           |--------|--------|--------------|
           | A      | [First suggested answer] | [What this means for the feature] |
           | B      | [Second suggested answer] | [What this means for the feature] |
           | C      | [Third suggested answer] | [What this means for the feature] |
           | Custom | Provide your own answer | [Explain how to provide custom input] |
           
           **Your choice**: _[Wait for user response]_
           ```

        4. **CRITICAL - Table Formatting**: Ensure markdown tables are properly formatted:
           - Use consistent spacing with pipes aligned
           - Each cell should have spaces around content: `| Content |` not `|Content|`
           - Header separator must have at least 3 dashes: `|--------|`
           - Test that the table renders correctly in markdown preview
        5. Number questions sequentially (Q1, Q2, Q3 - max 3 total)
        6. Present all questions together before waiting for responses
        7. Wait for user to respond with their choices for all questions (e.g., "Q1: A, Q2: Custom - [details], Q3: B")
        8. Update the spec by replacing each [NEEDS CLARIFICATION] marker with the user's selected or provided answer
        9. Re-run validation after all clarifications are resolved

   d. **Update Checklist**: After each validation iteration, update the checklist file with current pass/fail status

9. Report completion with branch name, spec file path, checklist results, and readiness for the next phase (`/speckit.clarify` or `/speckit.plan`).

### Sample Prompts with Jira

```
/speckit.specify DEALS-1234
/speckit.specify DEALS-1234 with OAuth2 integration requirement
/speckit.specify FULFILL-567 — mobile-only scope
```

## Related Skills

- **`fetch-jira-story`** (`.github/skills/fetch-jira-story/`): Fetches Jira issue details for pre-populating specifications.

**NOTE:** The script creates and checks out the new branch and initializes the spec file before writing.

## General Guidelines

## Quick Guidelines

- Focus on **WHAT** users need and **WHY**.
- Avoid HOW to implement (no tech stack, APIs, code structure).
- Written for business stakeholders, not developers.
- DO NOT create any checklists that are embedded in the spec. That will be a separate command.

### Section Requirements

- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation

When creating this spec from a user prompt:

1. **Make informed guesses**: Use context, industry standards, and common patterns to fill gaps
2. **Document assumptions**: Record reasonable defaults in the Assumptions section
3. **Limit clarifications**: Maximum 3 [NEEDS CLARIFICATION] markers - use only for critical decisions that:
   - Significantly impact feature scope or user experience
   - Have multiple reasonable interpretations with different implications
   - Lack any reasonable default
4. **Prioritize clarifications**: scope > security/privacy > user experience > technical details
5. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
6. **Common areas needing clarification** (only if no reasonable default exists):
   - Feature scope and boundaries (include/exclude specific use cases)
   - User types and permissions (if multiple conflicting interpretations possible)
   - Security/compliance requirements (when legally/financially significant)

**Examples of reasonable defaults** (don't ask about these):

- Data retention: Industry-standard practices for the domain
- Performance targets: Standard web/mobile app expectations unless specified
- Error handling: User-friendly messages with appropriate fallbacks
- Authentication method: Standard session-based or OAuth2 for web apps
- Integration patterns: RESTful APIs unless specified otherwise

### Success Criteria Guidelines

Success criteria must be:

1. **Measurable**: Include specific metrics (time, percentage, count, rate)
2. **Technology-agnostic**: No mention of frameworks, languages, databases, or tools
3. **User-focused**: Describe outcomes from user/business perspective, not system internals
4. **Verifiable**: Can be tested/validated without knowing implementation details

**Good examples**:

- "Users can complete checkout in under 3 minutes"
- "System supports 10,000 concurrent users"
- "95% of searches return results in under 1 second"
- "Task completion rate improves by 40%"

**Bad examples** (implementation-focused):

- "API response time is under 200ms" (too technical, use "Users see results instantly")
- "Database can handle 1000 TPS" (implementation detail, use user-facing metric)
- "React components render efficiently" (framework-specific)
- "Redis cache hit rate above 80%" (technology-specific)
