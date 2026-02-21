---
name: seo-audit
description: "Perform automated SEO audits for websites. Crawls landing pages, blog, and other pages (same-domain), checks technical and on-page SEO issues, and produces a thorough audit with prioritized recommendations and candidate high-value keywords."
---

What this skill does

- Crawl a target website (same domain) to a configurable depth
- For each page, check HTTP status, title, meta description, canonical, meta robots, H1/H2 presence, image alt attributes, internal/external links (including broken links), word count, and common structured-data markers (JSON-LD schema, OpenGraph, Twitter Card)
- Produce a site-level summary: pages missing titles/descriptions, duplicate titles/descriptions, thin content pages, pages with many images missing alt text, broken links, and other technical issues
- Extract candidate keywords by computing simple term-frequency across crawled pages (stopword filtering) and surface high-frequency, page-title/H1-matching phrases as "high-value" candidates
- Output: human-readable report (stdout), and machine-readable JSON audit (for integration into other tooling)

Usage (quick)

- From the skills folder, run the bundled script:
  python3 seo_audit.py --url https://example.com --depth 1 --max-pages 50 --output report.json

Files created

- seo_audit.py — the main audit script
- README.md — usage notes, installation, and example prompts

Example prompts/triggers

- "Audit https://example.com and give me a thorough SEO report for the landing page and blog (depth 2)"
- "Run seo-audit on my site, export JSON, and list high priority fixes"
- "Find thin content pages and suggest keywords we should target for our blog"

Outputs and priorities

- Each issue is tagged with a priority: P0 (critical), P1 (high), P2 (medium), P3 (low)
- The report includes: Technical checks, On-page checks, Content quality summaries, Keyword candidates, Actionable next steps with owners and estimated effort levels

Notes & limits

- The script relies on fetching pages over HTTP(S). It only crawls links on the same domain as the starting URL.
- It does not perform JavaScript rendering (no headless browser). If your site is heavily JS-driven, provide server-rendered URLs or use a different approach (Lighthouse / Puppeteer).
- It cannot query external services (Google Search Console, Ads, or live keyword volumes). Keyword suggestions are based on term frequency and on-page signals.

If you want, I can:
- Add an optional integration to fetch keyword volumes (via an API you provide)
- Add Lighthouse-run steps for performance and accessibility metrics (requires Chromium and lighthouse installed)
- Wrap this into a CLI installer or a periodic cron job that emails results

