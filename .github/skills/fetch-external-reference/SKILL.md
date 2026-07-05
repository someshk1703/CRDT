---
name: fetch-external-reference
description: Fetch reference files from external GitHub repositories. Use this when users reference external code (e.g., "implement similar to https://github.com/org/repo/file.java").
version: 1.1.0
license: MIT
---

# Fetch External Reference Skill

This skill fetches reference implementation files from external GitHub repositories with automatic fallback strategies.

## When to Use

Use this skill when:
- User provides a GitHub URL to a file in another repository
- Issue/PR description mentions "similar to" with a GitHub link
- Need to analyze external code patterns for reference implementation

## Supported URL Formats

```
https://github.com/[org]/[repo]/blob/[branch]/[path/to/file]
https://github.com/[org]/[repo]/tree/[branch]/[path]  (directory)
```

## Fetch Strategy (Three-Tier)

The skill automatically tries methods in priority order:

### Priority 1: `GIAM_TOKEN` via GitHub API (PREFERRED)
- **Best for**: Best Buy private repositories in GitHub Actions
- **Requires**: `GIAM_TOKEN` environment variable (set by `tplat-gha-configure-github-credentials` action)
- **Command**: `curl -H "Authorization: Bearer $GIAM_TOKEN" https://api.github.com/repos/OWNER/REPO/contents/PATH`

### Priority 2: `gh api` CLI (LOCAL DEVELOPMENT)
- **Best for**: Local development with GitHub CLI authenticated
- **Requires**: GitHub CLI (`gh auth login`)
- **Command**: `gh api repos/OWNER/REPO/contents/PATH --jq '.content' | base64 -d`

### Priority 3: `curl` (LAST RESORT)
- **Best for**: Public repositories only
- **Requires**: No authentication
- **Command**: `curl -sL https://raw.githubusercontent.com/OWNER/REPO/BRANCH/PATH`

## Usage

### Using the Helper Script

```bash
# Fetch a file from external repository
./fetch-github-file.sh "https://github.com/bby-corp/mp-return-consumer/blob/main/src/main/java/com/bestbuy/mp/healthcheck/KafkaHealthChecker.java"

# Output saved to /tmp/reference-KafkaHealthChecker.java
```

### Direct Invocation

```bash
# Using GIAM_TOKEN (GitHub Actions / Best Buy private repos)
owner="bby-corp"
repo="mp-return-consumer"
path="src/main/java/com/bestbuy/mp/healthcheck/KafkaHealthChecker.java"

# GH_TOKEN env var avoids exposing the token in the process listing
GH_TOKEN="$GIAM_TOKEN" gh api "repos/$owner/$repo/contents/$path" --jq '.content' | base64 -d > /tmp/reference.java
```

## URL Parsing

The skill automatically extracts:
- **Owner**: Organization or user name
- **Repo**: Repository name
- **Path**: File path within repository
- **Branch**: Optional (defaults to main/master)

**Example**:
```
URL: https://github.com/bby-corp/mp-return-consumer/blob/main/src/main/java/com/bestbuy/mp/healthcheck/KafkaHealthChecker.java

Extracted:
  Owner:  bby-corp
  Repo:   mp-return-consumer
  Path:   src/main/java/com/bestbuy/mp/healthcheck/KafkaHealthChecker.java
  Branch: main
```

## Authentication

The script resolves credentials in this order:

| Priority | Method | When Available |
|---|---|---|
| 1 | `GIAM_TOKEN` env var | GitHub Actions (set by `tplat-gha-configure-github-credentials`) |
| 2 | `gh` CLI | Local dev — run `gh auth login` |
| 3 | Unauthenticated | Public repositories only |

## Output

The skill saves fetched content to `/tmp/reference-<filename>` and outputs:

```
✅ SUCCESS via GIAM_TOKEN
Content saved to: /tmp/reference-KafkaHealthChecker.java
Size: 342 lines (8.5 KB)

Preview (first 10 lines):
package com.bestbuy.mp.healthcheck;

import com.bestbuy.shield.operational.endpoints.HealthCheck;
...
```

## Error Handling

If all fetch methods fail:

```
❌ Unable to fetch reference file

Attempted methods:
1. GIAM_TOKEN - Not set
2. gh api - gh CLI not installed
3. curl (public) - Failed

Possible reasons:
- Repository is private and credentials lack access
- File path is incorrect or file was moved/deleted
- Repository does not exist
- Network connectivity issues

Recommendation:
1. Verify the GitHub URL is correct
2. In GitHub Actions: ensure GIAM_TOKEN is available (set by tplat-gha-configure-github-credentials)
3. Locally: run 'gh auth login'
4. Confirm the file exists at that path
```

## Integration with Agents

Agents can use this skill when they detect:
- GitHub URLs in user requests
- Phrases like "implement similar to", "based on", "reference"
- Issue descriptions with external code links
- Requests to integrate with another domain's APIs or events

**Example workflow**:
```
User: "Add Kafka health check similar to https://github.com/bby-corp/mp-return-consumer/blob/main/src/.../KafkaHealthChecker.java"

Agent:
1. Detects GitHub URL
2. Invokes fetch-external-reference skill
3. Receives file content (via GIAM_TOKEN in GitHub Actions)
4. Analyzes reference implementation
5. Adapts patterns to current service
6. Implements feature
```

## Fetching Workspace Agent Context

When working on a cross-domain feature, use this skill to fetch `agent-context.md` from upstream or downstream domain workspaces. This gives the agent accurate API signatures, event schemas, and domain concepts without exploring the full codebase.

### URL Pattern

`agent-context.md` is always at the root of a workspace repo:

```
https://github.com/bby-corp/[domain]-workspace/blob/main/agent-context.md
```

### Fetch Workspace Context

```bash
# Fetch agent context from an upstream domain workspace
./fetch-github-file.sh "https://github.com/bby-corp/fulfillment-workspace/blob/main/agent-context.md"
# Saved to: /tmp/reference-agent-context.md
```

### Agent Invocation Pattern

Agents should fetch workspace context at the start of any planning or implementation session that involves cross-domain integration:

```
User: "I need to add a feature that calls Fulfillment's order readiness API and publishes 
       a pickup-ready event for the Notification domain."

Agent:
1. Recognizes cross-domain feature involving Fulfillment and Notification domains
2. Fetches agent-context.md from bby-corp/fulfillment-workspace
   → Reads public API section: Order Readiness API spec at specs/contracts/orders-api.yaml
   → Reads key concepts: understands "Readiness Window" terminology
3. Fetches agent-context.md from bby-corp/notification-workspace
   → Reads published events: pickup.order-ready topic, schema at specs/contracts/events/pickup-ready.json
4. Plans and implements with accurate API signatures, event contracts, and auth patterns
   → No full codebase exploration needed
   → No risk of using dead or deprecated code
```

### Registering Upstream Workspaces in `copilot-instructions.md`

To make cross-domain context automatically available, register dependency workspaces in your `copilot-instructions.md`:

```markdown
## Cross-Domain Context

When building features that integrate with these domains, fetch their agent-context.md first.

### Upstream Dependencies
- **Fulfillment**: `https://github.com/bby-corp/fulfillment-workspace/blob/main/agent-context.md`
- **Inventory**: `https://github.com/bby-corp/inventory-workspace/blob/main/agent-context.md`

### Downstream Consumers  
- **Store Associate App**: `https://github.com/bby-corp/store-associate-workspace/blob/main/agent-context.md`
```

## Benefits

- Fast: First method typically succeeds (< 5 seconds)
- Reliable: Three-tier fallback ensures success
- Secure: Works with Best Buy private repositories via GIAM_TOKEN
- Accurate: No trial-and-error needed
- Educational: Agents learn from existing code patterns

## Example Script Output

```bash
$ ./fetch-github-file.sh "https://github.com/bby-corp/magellan-copilot-instructions/blob/main/.github/instructions/core.instructions.md"

=== Fetching External Reference ===

URL: https://github.com/bby-corp/magellan-copilot-instructions/blob/main/.github/instructions/core.instructions.md
Owner: bby-corp
Repo: magellan-copilot-instructions
Path: .github/instructions/core.instructions.md

Attempting Priority 1: GIAM_TOKEN via GitHub API...
✅ SUCCESS via GIAM_TOKEN
Content saved to: /tmp/reference-core.instructions.md
Size: 85 lines (2987 bytes)

Preview (first 10 lines):
---
applyTo: "**"
---

# Overview

# AI Operation Principles
...

=== Fetch Complete ===
```

## Testing

Test the skill with various repositories:

```bash
# Test 1: Private Best Buy repo (requires GIAM_TOKEN or gh auth)
./fetch-github-file.sh "https://github.com/bby-corp/magellan-copilot-instructions/blob/main/.github/instructions/core.instructions.md"

# Test 2: Public repo (no auth required)
./fetch-github-file.sh "https://github.com/spring-projects/spring-boot/blob/main/README.adoc"

# Test 3: Non-existent file (should fail gracefully)
./fetch-github-file.sh "https://github.com/bby-corp/mp-return-consumer/blob/main/nonexistent.txt"
```