SEO Audit Skill

This skill provides a local script to run an automated SEO audit for a site (same-domain crawling). It inspects on-page and technical SEO signals and outputs a human-readable report and a JSON file for integrations.

Installation

Install the Python dependencies (recommend using a virtualenv):

pip install requests beautifulsoup4 tldextract

If you want to run faster / concurrent requests, the script uses concurrent.futures (part of the standard library).

Quick start

python3 seo_audit.py --url https://example.com --depth 1 --max-pages 50 --output report.json

Key flags

--url: Starting URL to audit (required)
--depth: Crawl depth (default 1). 0 = only the root URL, 1 = root + links from root, etc.
--max-pages: Maximum number of pages to crawl (default 200)
--output: Path to save JSON output (optional)
--verbose: Print per-page debug information

Limitations

- No JS rendering. This script fetches HTML only.
- No live keyword volume or SERP difficulty data — suggestions are internal, frequency-based candidates.
- Avoid running at high depth on large sites — keep max-pages reasonable.

Next steps I can help with

- Add GSC integration (requires credentials)
- Add Lighthouse performance checks (needs Chromium)
- Schedule periodic audits and email or Slack the results
- Build a front-end dashboard to visualize trends

