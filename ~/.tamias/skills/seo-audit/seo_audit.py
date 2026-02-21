#!/usr/bin/env python3
"""
seo_audit.py

A lightweight site crawler + SEO auditor.

Dependencies: requests, beautifulsoup4, tldextract

Usage:
  python3 seo_audit.py --url https://example.com --depth 1 --max-pages 50 --output report.json

Notes:
- Crawls same-domain links only
- No JavaScript rendering
- Produces a human-readable summary and optional JSON output
"""

import argparse
import json
import re
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
import tldextract

# Minimal stopword list to keep dependencies light
STOPWORDS = set("""
about above after again against all am an and any are aren't as at be because been before being below between both
but by can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had
hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd
i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once
only or other ought our ours ourselves out over own same shan't she she'd she'll she's should shouldn't so some such
than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those
through to too under until up very was wasn't we we'd we'll we're we've were weren't what what's when when's where
where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
""".split())

WORD_RE = re.compile(r"[a-zA-Z]{2,}")

session = requests.Session()
session.headers.update({
    'User-Agent': 'tamias-seo-audit/1.0 (+https://example.com)'
})


def is_same_domain(start_url, test_url):
    s = tldextract.extract(start_url)
    t = tldextract.extract(test_url)
    return (s.domain == t.domain and s.suffix == t.suffix)


def norm_url(base, link):
    if not link:
        return None
    link = link.strip()
    # skip javascript/mailto/tel
    if link.startswith('javascript:') or link.startswith('mailto:') or link.startswith('tel:'):
        return None
    joined = urljoin(base, link)
    parsed = urlparse(joined)
    # only http(s)
    if parsed.scheme not in ('http', 'https'):
        return None
    # remove fragments
    return parsed._replace(fragment='').geturl()


def fetch(url, timeout=15):
    try:
        start = time.time()
        r = session.get(url, timeout=timeout)
        elapsed = time.time() - start
        return {
            'url': url,
            'status_code': r.status_code,
            'elapsed': elapsed,
            'text': r.text if r.status_code == 200 else '',
            'final_url': r.url,
            'headers': dict(r.headers)
        }
    except Exception as e:
        return {'url': url, 'error': str(e)}


def extract_onpage(url, html):
    soup = BeautifulSoup(html, 'html.parser')
    title = soup.title.string.strip() if soup.title and soup.title.string else ''
    meta_desc = ''
    meta_robots = ''
    canonical = ''
    og = {}
    twitter = {}

    for tag in soup.find_all('meta'):
        if tag.get('name', '').lower() == 'description' and tag.get('content'):
            meta_desc = tag.get('content').strip()
        if tag.get('name', '').lower() == 'robots' and tag.get('content'):
            meta_robots = tag.get('content').strip()
        # open graph
        if tag.get('property', '').lower().startswith('og:'):
            og[tag.get('property')] = tag.get('content', '')
        if tag.get('name', '').lower().startswith('twitter:'):
            twitter[tag.get('name')] = tag.get('content', '')
    link_can = soup.find('link', rel=lambda x: x and 'canonical' in x.lower())
    if link_can and link_can.get('href'):
        canonical = link_can.get('href').strip()

    h1s = [h.get_text(strip=True) for h in soup.find_all('h1')]
    h2s = [h.get_text(strip=True) for h in soup.find_all('h2')]

    images = []
    for img in soup.find_all('img'):
        images.append({'src': img.get('src', ''), 'alt': img.get('alt', '')})

    links = []
    for a in soup.find_all('a'):
        href = a.get('href')
        text = a.get_text(strip=True)
        links.append({'href': href, 'text': text})

    # structured data: JSON-LD
    jsonld = []
    for s in soup.find_all('script', type='application/ld+json'):
        try:
            jsonld.append(json.loads(s.string))
        except Exception:
            pass

    # text for word counts
    for s in soup(['script', 'style', 'noscript']):
        s.extract()
    body_text = soup.get_text(separator=' ', strip=True)
    words = WORD_RE.findall(body_text.lower())

    return {
        'title': title,
        'meta_description': meta_desc,
        'meta_robots': meta_robots,
        'canonical': canonical,
        'og': og,
        'twitter': twitter,
        'h1s': h1s,
        'h2s': h2s,
        'images': images,
        'links': links,
        'jsonld': jsonld,
        'word_count': len(words),
        'words': words,
        'body_text': body_text
    }


def crawl(start_url, depth=1, max_pages=200, workers=8, verbose=False):
    start_url = start_url.rstrip('/')
    to_visit = [start_url]
    visited = set()
    results = {}
    domain = start_url
    pages_crawled = 0

    for d in range(depth + 1):
        if pages_crawled >= max_pages:
            break
        next_round = []
        futures = {}
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for url in to_visit:
                if pages_crawled >= max_pages:
                    break
                if url in visited:
                    continue
                visited.add(url)
                futures[ex.submit(fetch, url)] = url
                pages_crawled += 1

            for fut in as_completed(futures):
                url = futures[fut]
                res = fut.result()
                if verbose:
                    print('Fetched:', url, '->', res.get('status_code') if 'status_code' in res else 'ERR')
                if res.get('error'):
                    results[url] = {'error': res.get('error')}
                    continue
                if res.get('status_code') != 200:
                    results[url] = {'http': res.get('status_code'), 'final_url': res.get('final_url')}
                    continue
                html = res.get('text', '')
                onpage = extract_onpage(url, html)
                results[url] = {
                    'http': res.get('status_code'),
                    'final_url': res.get('final_url'),
                    'elapsed': res.get('elapsed'),
                    'headers': res.get('headers'),
                    'onpage': onpage
                }
                # collect same-domain links for next round
                for a in onpage['links']:
                    norm = norm_url(url, a['href'])
                    if not norm:
                        continue
                    if is_same_domain(start_url, norm):
                        if norm not in visited and norm not in next_round and len(next_round) + pages_crawled < max_pages:
                            next_round.append(norm)
        to_visit = next_round
    return results


def analyze(results):
    pages = list(results.keys())
    summary = {
        'total_pages': len(pages),
        'pages_missing_title': [],
        'pages_missing_meta_description': [],
        'pages_missing_h1': [],
        'thin_pages': [],
        'images_missing_alt': {},
        'broken_links': {},
        'duplicate_titles': {},
        'duplicate_meta_descriptions': {},
        'top_words': [],
        'per_page': {}
    }

    title_counts = Counter()
    meta_counts = Counter()
    word_counts = Counter()

    for url, r in results.items():
        page_report = {}
        if 'error' in r:
            page_report['error'] = r['error']
            summary['per_page'][url] = page_report
            continue
        if r.get('http') != 200:
            page_report['http'] = r.get('http')
            summary['per_page'][url] = page_report
            continue
        on = r['onpage']
        title = on.get('title', '')
        meta = on.get('meta_description', '')
        h1s = on.get('h1s', [])
        wc = on.get('word_count', 0)

        page_report['title'] = title
        page_report['title_length'] = len(title)
        page_report['meta_description'] = meta
        page_report['meta_description_length'] = len(meta)
        page_report['h1s'] = h1s
        page_report['word_count'] = wc
        page_report['num_images'] = len(on.get('images', []))

        # missing checks
        if not title:
            summary['pages_missing_title'].append(url)
        if not meta:
            summary['pages_missing_meta_description'].append(url)
        if not h1s:
            summary['pages_missing_h1'].append(url)
        if wc < 300:
            summary['thin_pages'].append(url)

        missing_alts = [img['src'] for img in on.get('images', []) if not img.get('alt')]
        if missing_alts:
            summary['images_missing_alt'][url] = missing_alts

        # links: check for broken/external
        broken = []
        extern = []
        for a in on.get('links', []):
            norm = norm_url(url, a['href'])
            if not norm:
                continue
            if is_same_domain(url, norm):
                # internal, see if in results and non-200
                if norm in results:
                    rr = results[norm]
                    if rr.get('http') and rr.get('http') != 200:
                        broken.append({'href': norm, 'http': rr.get('http')})
            else:
                extern.append(norm)
        if broken:
            summary['broken_links'][url] = broken

        # word frequency
        words = [w for w in on.get('words', []) if w not in STOPWORDS]
        word_counts.update(words)

        # duplicates
        if title:
            title_counts[title] += 1
        if meta:
            meta_counts[meta] += 1

        summary['per_page'][url] = page_report

    # duplicate titles / metas
    for t, c in title_counts.items():
        if c > 1:
            summary['duplicate_titles'][t] = c
    for m, c in meta_counts.items():
        if c > 1:
            summary['duplicate_meta_descriptions'][m] = c

    top_words = word_counts.most_common(80)
    summary['top_words'] = top_words

    # pick candidate keywords: top unigrams + simple phrase extraction from titles/h1s
    phrase_counts = Counter()
    for url, r in results.items():
        if 'onpage' not in r:
            continue
        on = r['onpage']
        # extract phrases from title and h1s
        candidates = []
        if on.get('title'):
            candidates.extend(re.findall(r"[a-zA-Z0-9\-\_ ]{2,}", on.get('title')))
        for h in on.get('h1s', []):
            candidates.extend(re.findall(r"[a-zA-Z0-9\-\_ ]{2,}", h))
        for c in candidates:
            words = [w for w in WORD_RE.findall(c.lower()) if w not in STOPWORDS]
            if 1 <= len(words) <= 5:
                phrase_counts[' '.join(words)] += 1

    top_phrases = [p for p in phrase_counts.most_common(40)]

    # heuristics: high value keywords are phrases that appear multiple times and also appear in top words
    high_value = []
    top_unigram_set = set([w for w, _ in top_words[:120]])
    for phrase, cnt in top_phrases:
        parts = phrase.split()
        overlap = sum(1 for p in parts if p in top_unigram_set)
        score = cnt + overlap
        high_value.append((phrase, cnt, overlap, score))
    high_value.sort(key=lambda x: (-x[3], -x[1]))

    summary['candidate_phrases'] = [{'phrase': p, 'count': c, 'overlap_with_top_unigrams': o, 'score': s} for p, c, o, s in high_value[:40]]

    # actionable checklist (priority heuristics)
    checklist = []
    for url in summary['pages_missing_title']:
        checklist.append({'issue': 'Missing title', 'url': url, 'priority': 'P0', 'why': 'Title is critical for ranking and CTR'})
    for url in summary['pages_missing_meta_description']:
        checklist.append({'issue': 'Missing meta description', 'url': url, 'priority': 'P1', 'why': 'Improve CTR in SERPs'})
    for url in summary['pages_missing_h1']:
        checklist.append({'issue': 'Missing H1', 'url': url, 'priority': 'P1', 'why': 'H1 signals page topic'})
    for url in summary['thin_pages']:
        checklist.append({'issue': 'Thin content (<300 words)', 'url': url, 'priority': 'P1', 'why': 'Create more useful, in-depth content'})
    for url, imgs in summary['images_missing_alt'].items():
        checklist.append({'issue': f'{len(imgs)} images missing alt', 'url': url, 'priority': 'P2', 'why': 'Accessibility and image search'})
    for url, broken in summary['broken_links'].items():
        checklist.append({'issue': f'Broken links ({len(broken)})', 'url': url, 'priority': 'P1', 'why': 'Fix or remove broken links'})
    if summary['duplicate_titles']:
        checklist.append({'issue': f'{len(summary["duplicate_titles"])} duplicate titles', 'priority': 'P2', 'why': 'Unique titles improve clarity'})
    if summary['duplicate_meta_descriptions']:
        checklist.append({'issue': f'{len(summary["duplicate_meta_descriptions"])} duplicate meta descriptions', 'priority': 'P2', 'why': 'Unique meta descriptions improve SERP snippets'})

    # simple recommendations
    recommendations = [
        'Ensure every important page has a unique, descriptive title (50-60 chars) and meta description (120-160 chars).',
        'Add or fix canonical tags where pages have duplicates or parameters.',
        'Fix broken internal links and reduce redirects where possible.',
        'Add meaningful H1 headings to topic pages and use H2/H3 to structure content.',
        'Add alt text to images and descriptive filenames for images used for content.',
        'Consolidate or expand thin pages (<300 words). Consider merging near-duplicate or low-value pages.',
        'Add structured data (JSON-LD) for products, articles, breadcrumbs, and organization where applicable.',
        'Improve page speed (defer to Lighthouse for detailed performance recommendations).',
    ]

    summary['checklist'] = checklist
    summary['recommendations'] = recommendations
    return summary


def print_summary(start_url, results, summary):
    print('\nSEO Audit Summary for:', start_url)
    print('Total pages crawled:', summary['total_pages'])
    print('\nHigh priority issues:')
    for item in summary['checklist'][:10]:
        print('-', item['priority'], item.get('url', ''), item['issue'], '-', item.get('why', ''))

    print('\nTop candidate keywords (phrases):')
    for p in summary['candidate_phrases'][:20]:
        print('-', p['phrase'], f"(count={p['count']}, score={p['score']})")

    print('\nTop words across site:')
    for w, c in summary['top_words'][:30]:
        print('-', w, c)

    print('\nPages missing titles:', len(summary['pages_missing_title']))
    if summary['pages_missing_title']:
        for u in summary['pages_missing_title'][:10]:
            print('  -', u)

    print('\nPages with thin content (<300 words):', len(summary['thin_pages']))
    if summary['thin_pages']:
        for u in summary['thin_pages'][:10]:
            print('  -', u)

    print('\nImages missing alt (sample):')
    for u, imgs in list(summary['images_missing_alt'].items())[:8]:
        print('  -', u, '->', len(imgs), 'images missing alt')

    print('\nBroken links (sample):')
    for u, br in list(summary['broken_links'].items())[:8]:
        print('  -', u, '->', br)

    print('\nQuick recommendations:')
    for r in summary['recommendations']:
        print('-', r)


def main():
    parser = argparse.ArgumentParser(description='SEO Audit for a website (same-domain crawling)')
    parser.add_argument('--url', required=True)
    parser.add_argument('--depth', type=int, default=1)
    parser.add_argument('--max-pages', type=int, default=200)
    parser.add_argument('--output', type=str, default='')
    parser.add_argument('--verbose', action='store_true')
    args = parser.parse_args()

    print('Starting crawl:', args.url)
    results = crawl(args.url, depth=args.depth, max_pages=args.max_pages, verbose=args.verbose)
    print('Analyzing results...')
    summary = analyze(results)
    print_summary(args.url, results, summary)

    if args.output:
        out = {'start_url': args.url, 'results': results, 'summary': summary}
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        print('\nJSON output saved to', args.output)


if __name__ == '__main__':
    main()
