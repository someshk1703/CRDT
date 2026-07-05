---
name: fetch-jira-story
description: Fetch Jira stories/epics and extract structured context for feature intake and specification. Use this when users provide a Jira ticket key (e.g., DEALS-1234) or a Jira URL (e.g., https://jira.tools.bestbuy.com/browse/DEALS-1234)
version: 1.0.0
license: MIT
---

# Fetch Jira Story Skill

This skill fetches Jira issue details and provides structured JSON output that agents use to pre-populate intake documents and feature specifications.

## When to Use

Use this skill when:
- User provides a Jira ticket key (e.g., `DEALS-1234`, `FULFILL-567`) as input to `@intake` or `/speckit.specify`
- User says "pull from Jira", "use the Jira story", or references a ticket key
- User provides a Jira URL (e.g., `https://jira.tools.bestbuy.com/browse/DEALS-1234`) that contains a valid ticket key in the path
- Input matches the pattern `[A-Z][A-Z0-9]+-\d+` (uppercase letter, then letters/digits, dash, one or more digits)

**Do NOT use when:**
- User provides a plain text feature description (no Jira key)
- The Jira environment variables are not configured (fall back to manual intake)
- User wants to create, update, or comment on a Jira ticket — this skill is **read-only**

## Prerequisites

### Environment Variable (Required)

| Variable | Description | Example |
|----------|-------------|------|
| `JIRA_PAT` | Jira Personal Access Token (Bearer auth) | `NjY2...` |

**Security**: Store these as environment variables or IDE-level secrets. Never commit tokens to the repository.

### Runtime

- **Python 3.6+** (uses only standard library — no `pip install` needed)

> **First-time setup**: Credentials require a one-time manual provisioning process (service account → Jira group → PAT → GitHub secret). See [docs/how-tos/jira-service-account-setup.md](../../../docs/how-tos/jira-service-account-setup.md).

## Usage

### Get a Single Issue (Primary Use Case)

```bash
# JSON output for agent consumption
python3 .github/skills/fetch-jira-story/jira.py get DEALS-1234 --json

# Human-readable output for debugging
python3 .github/skills/fetch-jira-story/jira.py get DEALS-1234
```

### Search Issues via JQL

```bash
# Find stories in a specific epic
python3 .github/skills/fetch-jira-story/jira.py search "project = DEALS AND type = Story AND sprint in openSprints()"

# Find issues by component
python3 .github/skills/fetch-jira-story/jira.py search "project = FULFILL AND component = 'order-tracking'" --limit 10
```

## JSON Output Format

When invoked with `get <KEY> --json`, the script outputs the full Jira API response. Agents should extract these fields:

```json
{
  "key": "DEALS-1234",
  "fields": {
    "summary": "Add real-time price matching for online orders",
    "description": "As a customer, I want to see competitor prices...",
    "issuetype": { "name": "Story" },
    "status": { "name": "To Do" },
    "priority": { "name": "High" },
    "labels": ["pricing", "customer-facing"],
    "components": [{ "name": "price-engine" }],
    "assignee": { "displayName": "Jane Doe" },
    "reporter": { "displayName": "John Smith" },
    "subtasks": [
      { "key": "DEALS-1235", "fields": { "summary": "Create price comparison API" } },
      { "key": "DEALS-1236", "fields": { "summary": "Add UI for price match display" } }
    ],
    "attachment": [ ... ]
  }
}
```

For agent-specific field mapping and orchestration patterns, see [docs/jira-agent-integration.md](../../../docs/jira-agent-integration.md).

## Error Handling

| Error | Agent Behavior |
|-------|---------------|
| `JIRA_PAT` not set | Warn user: "Jira token not configured. Set the `JIRA_PAT` environment variable. Falling back to manual intake." |
| HTTP 401 (Unauthorized) | Warn: "Jira token is invalid or expired. Regenerate your PAT." |
| HTTP 404 (Not Found) | Warn: "Ticket {KEY} not found. Verify the ticket key and try again." |
| Network error | Warn: "Cannot reach Jira server. Check VPN connection. Falling back to manual intake." |
| Python not available | Warn: "Python 3 is required for Jira integration. Install Python 3.6+ or provide a text description instead." |

**Critical**: On any error, the agent must **fall back to manual intake** — never block the workflow because Jira is unavailable.

## Examples

### Example 1: Fetch a Story

```bash
$ python3 .github/skills/fetch-jira-story/jira.py get DEALS-1234

Key:     DEALS-1234
Type:    Story
Summary: Add real-time price matching for online orders
Status:  To Do
Assignee: Jane Doe
Reporter: John Smith
Priority: High
Created: 2026-02-15T10:30:00.000-0600
Updated: 2026-02-28T14:22:00.000-0600

Description:
As a customer, I want to see competitor prices when browsing products so that I can be confident I'm getting the best deal...
--------------------------------------------------------------------------------
```

### Example 2: Search for Sprint Stories

```bash
$ python3 .github/skills/fetch-jira-story/jira.py search "project = DEALS AND sprint in openSprints() AND type = Story" --limit 5

Total tickets found: 12
================================================================================
Key:     DEALS-1234
Type:    Story
Summary: Add real-time price matching for online orders
Status:  To Do
--------------------------------------------------------------------------------
Key:     DEALS-1240
Type:    Story
Summary: Implement deal expiration notifications
Status:  In Progress
--------------------------------------------------------------------------------
```

### Example 3: Error — Missing Credentials

```bash
$ python3 .github/skills/fetch-jira-story/jira.py get DEALS-1234

Error: JIRA_PAT is not set. Set it in the OS environment or in a .env file located next to jira.py.
```

## Security Notes

- **Never commit** `JIRA_PAT` to the repository
- **Never log** the full PAT value in agent output
- The script uses **Bearer token** authentication over HTTPS
- All requests go directly to your Jira Server instance — no third-party services involved
- The `.env` file fallback is for local development only — prefer environment variables

## Testing

```bash
# Verify Python is available
python3 --version

# Verify credentials are set
echo ${JIRA_PAT:0:5}...  # Show only first 5 chars

# Test fetch
python3 .github/skills/fetch-jira-story/jira.py get YOUR-TICKET-123

# Test search
python3 .github/skills/fetch-jira-story/jira.py search "project = YOUR_PROJECT AND type = Story" --limit 3
```
