#!/usr/bin/env python3
"""
Jira CLI Tool - Read-Only
A single-file, portable script for fetching Jira issues and searching via JQL.
Part of the Agentic Development Toolkit (fetch-jira-story skill).

Usage:
  python3 jira.py get PROJ-1234 [--json]
  python3 jira.py search "project = PROJ AND type = Story" [--limit 10] [--verbose]

Environment:
  JIRA_PAT       - Jira Personal Access Token (Bearer auth)
  JIRA_TIMEOUT   - Request timeout in seconds (default: 15)
"""

import os
import sys
import json
import re
import socket
import argparse
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

JIRA_BASE_URL = 'https://jira.tools.bestbuy.com'

_JIRA_TIMEOUT_ENV = os.environ.get('JIRA_TIMEOUT')
try:
    DEFAULT_TIMEOUT = int(_JIRA_TIMEOUT_ENV) if _JIRA_TIMEOUT_ENV is not None else 15
except (TypeError, ValueError):
    print(
        f"Warning: Ignoring invalid JIRA_TIMEOUT value {repr(_JIRA_TIMEOUT_ENV)}; "
        "defaulting to 15 seconds.",
        file=sys.stderr,
    )
    DEFAULT_TIMEOUT = 15


class JiraClient:
    def __init__(self, base_url, token, timeout=DEFAULT_TIMEOUT):
        self.base_url = base_url.rstrip('/')
        self.token = token
        self.timeout = timeout

    def _make_request(self, endpoint, method='GET', data=None):
        """Make HTTP request to Jira API"""
        url = f"{self.base_url}{endpoint}"
        headers = {
            'Authorization': f'Bearer {self.token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        request_data = json.dumps(data).encode('utf-8') if data else None
        req = Request(url, data=request_data, headers=headers, method=method)

        try:
            with urlopen(req, timeout=self.timeout) as response:
                raw_body = response.read().decode('utf-8', errors='replace')
                try:
                    return json.loads(raw_body)
                except json.JSONDecodeError:
                    # Handle non-JSON responses (e.g., HTML SSO redirects or proxy errors)
                    status = getattr(response, "status", None) or getattr(response, "code", None) or response.getcode()
                    content_type = None
                    try:
                        # urllib responses typically expose headers via .headers or .getheader()
                        resp_headers = getattr(response, "headers", None)
                        if resp_headers is not None:
                            content_type = resp_headers.get("Content-Type")
                        elif hasattr(response, "getheader"):
                            content_type = response.getheader("Content-Type")
                    except Exception:
                        content_type = None
                    print(
                        f"Error: Failed to parse JSON response from {url} "
                        f"(status {status}, content-type {content_type or 'unknown'}).",
                        file=sys.stderr,
                    )
                    # Only include a truncated body when explicitly requested for debugging
                    if os.environ.get("JIRA_VERBOSE") == "1":
                        truncated = raw_body[:300]
                        if len(raw_body) > 300:
                            truncated += f"... [{len(raw_body) - 300} chars truncated]"
                        print("Response body preview (JIRA_VERBOSE=1):", file=sys.stderr)
                        print(truncated, file=sys.stderr)
                    sys.exit(1)
        except HTTPError as e:
            charset = e.headers.get_content_charset('utf-8') if getattr(e, 'headers', None) else 'utf-8'
            error_body = e.read().decode(charset, errors='replace')
            print(f"Error: HTTP {e.code} - {e.reason}", file=sys.stderr)
            # Only include a truncated body when explicitly requested for debugging
            if os.environ.get("JIRA_VERBOSE") == "1":
                truncated = error_body[:300]
                if len(error_body) > 300:
                    truncated += f"... [{len(error_body) - 300} chars truncated]"
                print("Response body preview (JIRA_VERBOSE=1):", file=sys.stderr)
                print(truncated, file=sys.stderr)
            else:
                print("Hint: Set JIRA_VERBOSE=1 to see a truncated response body preview.", file=sys.stderr)
            sys.exit(1)
        except URLError as e:
            if isinstance(e.reason, socket.timeout):
                print(f"Error: Request timed out after {self.timeout}s — check VPN/network connection", file=sys.stderr)
            else:
                print(f"Error: Connection failed - {e.reason}", file=sys.stderr)
            sys.exit(1)

    def search(self, jql, max_results=50, fields=None):
        """Search for issues using JQL"""
        params = {
            'jql': jql,
            'maxResults': max_results
        }
        if fields:
            params['fields'] = ','.join(fields)

        endpoint = f"/rest/api/2/search?{urlencode(params)}"
        return self._make_request(endpoint)

    def get_issue(self, issue_key):
        """Get a specific issue by key"""
        if not re.fullmatch(r'[A-Z][A-Z0-9]+-\d+', issue_key):
            print(
                f"Error: {issue_key!r} is not a valid Jira issue key. "
                "Expected format: PROJECT-123 (uppercase letters/digits, dash, digits).",
                file=sys.stderr,
            )
            sys.exit(1)
        endpoint = f"/rest/api/2/issue/{quote(issue_key, safe='')}"
        return self._make_request(endpoint)


def parse_issue_key(value):
    """Accept a bare issue key (DEALS-1234) or a full Jira browse URL and
    return the issue key string, or exit with an error if no valid key can be found.

    Supported input formats:
      - DEALS-1234
      - https://jira.tools.bestbuy.com/browse/DEALS-1234

    Any Jira host URL is accepted as long as the path ends with /browse/PROJECT-123.
    """
    # If it looks like a URL, extract the last path segment that matches
    if value.startswith('http://') or value.startswith('https://'):
        from urllib.parse import urlparse
        path = urlparse(value).path          # e.g. /browse/DEALS-1234
        # Take the last non-empty path segment
        segment = path.rstrip('/').rsplit('/', 1)[-1]
        match = re.fullmatch(r'[A-Z][A-Z0-9]+-\d+', segment)
        if match:
            return match.group()
        print(
            f"Error: Could not extract a Jira issue key from URL: {value!r}. "
            "Expected a URL ending in /browse/PROJECT-123.",
            file=sys.stderr,
        )
        sys.exit(1)
    # Bare key validation
    if re.fullmatch(r'[A-Z][A-Z0-9]+-\d+', value):
        return value
    print(
        f"Error: {value!r} is not a valid Jira issue key or URL. "
        "Expected formats: DEALS-1234 or https://jira.tools.bestbuy.com/browse/DEALS-1234.",
        file=sys.stderr,
    )
    sys.exit(1)


def load_env():
    """Load environment variables from OS environment and optionally .env file.

    OS environment variables take precedence over values in .env. Each required
    variable is resolved independently so that partial configuration is handled
    correctly, and any missing variables are reported explicitly.
    """
    env_vars = {}

    # Check OS environment first
    pat = os.environ.get('JIRA_PAT')
    if pat:
        env_vars['JIRA_PAT'] = pat

    # Fall back to .env file for missing values
    if 'JIRA_PAT' not in env_vars:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        key, _, value = line.partition('=')
                        key = key.strip()
                        if key == 'JIRA_PAT' and key not in env_vars:
                            env_vars[key] = value.strip()

    if 'JIRA_PAT' not in env_vars or not env_vars['JIRA_PAT']:
        print(
            "Error: JIRA_PAT is not set. "
            "Set it in the OS environment or in a .env file located next to jira.py.",
            file=sys.stderr,
        )
        sys.exit(1)

    return env_vars


def print_issue(issue, verbose=False):
    """Print issue information in human-readable format"""
    key = issue['key']
    fields = issue['fields']

    print(f"Key:     {key}")
    print(f"Type:    {fields['issuetype']['name']}")
    print(f"Summary: {fields['summary']}")
    print(f"Status:  {fields['status']['name']}")

    if verbose:
        assignee = fields.get('assignee')
        assignee_name = assignee['displayName'] if assignee else 'Unassigned'
        print(f"Assignee: {assignee_name}")

        reporter = fields.get('reporter')
        reporter_name = reporter['displayName'] if reporter else 'Unknown'
        print(f"Reporter: {reporter_name}")

        priority = fields.get('priority')
        priority_name = priority['name'] if priority else 'None'
        print(f"Priority: {priority_name}")

        created = fields.get('created', 'Unknown')
        updated = fields.get('updated', 'Unknown')
        print(f"Created: {created}")
        print(f"Updated: {updated}")

        labels = fields.get('labels', [])
        if labels:
            print(f"Labels:  {', '.join(labels)}")

        components = fields.get('components', [])
        if components:
            comp_names = [c['name'] for c in components]
            print(f"Components: {', '.join(comp_names)}")

        subtasks = fields.get('subtasks', [])
        if subtasks:
            print(f"Sub-tasks ({len(subtasks)}):")
            for st in subtasks:
                print(f"  - {st['key']}: {st['fields']['summary']}")

        description = fields.get('description', '')
        if description:
            print(f"\nDescription:\n{description}")

    print('-' * 80)


def cmd_get(client, args):
    """Get a specific issue"""
    issue_key = parse_issue_key(args.issue_key)
    issue = client.get_issue(issue_key)

    if args.json:
        # Output raw JSON for agent consumption
        print(json.dumps(issue, indent=2))
    else:
        # Human-readable output
        print_issue(issue, verbose=True)


def cmd_search(client, args):
    """Search for issues using JQL"""
    jql = args.jql
    result = client.search(jql, max_results=args.limit)

    total = result.get('total', 0)
    issues = result.get('issues', [])

    print(f"Total tickets found: {total}")
    print('=' * 80)

    if not issues:
        print('No tickets found.')
    else:
        for issue in issues:
            print_issue(issue, args.verbose)


def main():
    parser = argparse.ArgumentParser(
        description='Jira CLI Tool (Read-Only) - Fetch issues and search via JQL',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s get DEALS-1234              # Human-readable output
  %(prog)s get DEALS-1234 --json       # JSON output for agent consumption
  %(prog)s search "project = DEALS"    # Search with JQL
  %(prog)s search "assignee = currentUser() AND status != Closed" --limit 10

Environment variables:
  JIRA_PAT         Jira Personal Access Token
  JIRA_TIMEOUT     Request timeout in seconds (default: 15)
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Shared args inherited by all subcommands
    shared = argparse.ArgumentParser(add_help=False)
    shared.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT,
                        metavar='SECS',
                        help=f'Request timeout in seconds (default: {DEFAULT_TIMEOUT}, env: JIRA_TIMEOUT)')

    # get command
    get_parser = subparsers.add_parser('get', parents=[shared], help='Get a specific issue by key')
    get_parser.add_argument('issue_key',
                            help='Issue key (DEALS-1234) or full browse URL '
                                 '(https://jira.tools.bestbuy.com/browse/DEALS-1234)')
    get_parser.add_argument('--json', action='store_true',
                            help='Output raw JSON instead of formatted text')

    # search command
    search_parser = subparsers.add_parser('search', parents=[shared], help='Search issues using JQL')
    search_parser.add_argument('jql', help='JQL query string')
    search_parser.add_argument('-l', '--limit', type=int, default=50,
                               help='Max results (default: 50)')
    search_parser.add_argument('-v', '--verbose', action='store_true',
                               help='Show detailed information per issue')

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Load configuration
    env = load_env()
    client = JiraClient(JIRA_BASE_URL, env['JIRA_PAT'], timeout=args.timeout)

    # Execute command
    commands = {
        'get': cmd_get,
        'search': cmd_search,
    }

    commands[args.command](client, args)


if __name__ == '__main__':
    main()
