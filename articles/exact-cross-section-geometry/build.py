# -*- coding: utf-8 -*-
"""Render article.md into the <article> block inside ../../articles.html.

Idempotent: re-running replaces this article's block and leaves every other
article, the index numbering and the giscus wiring untouched.

    cd articles/exact-cross-section-geometry && python3 build.py

The site loads no MathJax, so the handful of LaTeX spans in the source are
mapped to Unicode here rather than left for a renderer that does not exist.
Repo links in the source are relative to the openswmm.engine checkout the
article was written against; they are rewritten to permalinks pinned to SHA
below, so they keep resolving after the branch is merged and deleted.
"""
import io, os, re, html, sys

HERE  = os.path.dirname(os.path.abspath(__file__))
SLUG  = os.path.basename(HERE)
ROOT  = os.path.abspath(os.path.join(HERE, '..', '..'))
SHA   = '7ff727be74f0f85661b0b8fc09a32401964c0f36'
BASE  = 'https://github.com/HydroCouple/openswmm.engine/blob/%s/' % SHA
AUTHORS = ['Corinne Wiesner-Friedman']   # byline credits the article's author only
DATE    = '08-30-2026'  # MM-DD-YYYY, matches the site's date-badge index (added 2026-08-31
                         # after articles.html was independently rebuilt and lost this block —
                         # see the note in the article's own README)
SRCLINK = ('https://github.com/HydroCouple/openswmm.engine/tree/feature/xsect-geometry',
           'Code and branch on GitHub →')

MATH = [('$\\partial A/\\partial t +\n> \\partial Q/\\partial x = q$', '∂A/∂t + ∂Q/∂x = q'),
        ('$\\partial A/\\partial t =\n> T\\,\\partial y/\\partial t$', '∂A/∂t = T·∂y/∂t'),
        ('$T = dA/dy$', 'T = dA/dy'), ('$|dA/dy - T|/T$', '|dA/dy − T|/T'),
        ('$1\\times10^{-8}$', '1×10⁻⁸'), ('$1.5\\times10^{-7}$', '1.5×10⁻⁷'),
        ('$10^{-8}$', '10⁻⁸'), ('$T$', 'T'), ('$A$', 'A')]


def url_of(u):
    if u.startswith('http'):      return u
    if u.startswith('../../img/'): return u[6:]        # site asset, already published
    if u.startswith('../../'):    return BASE + u[6:]  # engine repo, root-relative
    if u.startswith('../'):       return BASE + 'docs/' + u[3:]
    return BASE + u


def fmt(t):
    t = html.escape(t)
    t = re.sub(r'`([^`]+)`', lambda m: '<code>' + m.group(1) + '</code>', t)
    t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'(?<!\*)\*([^*]+)\*(?!\*)', r'<em>\1</em>', t)
    return t


def inline(t):
    links = []
    def grab(m):
        links.append((m.group(1), url_of(m.group(2))))
        return '\x00%d\x00' % (len(links) - 1)
    t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', grab, t)
    t = fmt(t)
    for i, (txt, u) in enumerate(links):
        t = t.replace('\x00%d\x00' % i,
                      '<a href="%s">%s</a>' % (html.escape(u, quote=True), fmt(txt)))
    return t


NUM_CELL = re.compile(r'^[~−\-+]?\d')  # leading digit, optionally signed/approx


def table(rows):
    """A column is right-aligned (class="num") only when EVERY data cell in it
    starts with a digit (allowing a leading ~/-/+/−) — so a prose table (all
    text) stays fully left-aligned, a numeric table right-aligns its data columns
    against a left-aligned label column, and a column mixing numbers with a text
    verdict (e.g. "no meaningful change") also stays left, which is the reading
    that column actually wants."""
    hdr = [c.strip() for c in rows[0].strip('|').split('|')]
    body = [[c.strip() for c in r.strip('|').split('|')] for r in rows[2:]]
    ncol = len(hdr)
    numeric = [bool(body) and all(NUM_CELL.match(r[i]) for r in body if i < len(r) and r[i])
              for i in range(ncol)]
    def cls(i):
        return ' class="num"' if numeric[i] else ''
    o = ['<table><thead><tr>' +
         ''.join('<th%s>%s</th>' % (cls(i), inline(c)) for i, c in enumerate(hdr)) +
         '</tr></thead><tbody>']
    for r in body:
        o.append('<tr>' + ''.join('<td%s>%s</td>' % (cls(i), inline(c)) for i, c in enumerate(r)) + '</tr>')
    return ''.join(o) + '</tbody></table>'


def render(md):
    lines = md.split('\n')
    title, subtitle = lines[0][2:].strip(), lines[2][4:].strip()
    body = '\n'.join(lines[6:])
    for a, b in MATH:
        body = body.replace(a, b)
    if '$' in body:
        sys.exit('unconverted math: %s' % [l for l in body.split('\n') if '$' in l][:3])

    out, L, i = [], body.split('\n'), 0
    while i < len(L):
        st = L[i].strip()
        if not st or st == '---':
            i += 1; continue
        if st.startswith('## '):
            out.append('<h3>%s</h3>' % inline(st[3:])); i += 1; continue
        if st.startswith('### '):
            out.append('<h4>%s</h4>' % inline(st[4:])); i += 1; continue
        if st.startswith('!['):
            m = re.match(r'!\[([^\]]*)\]\(([^)]+)\)', st)
            out.append('<figure><img src="%s" alt="%s" loading="lazy"></figure>'
                       % (url_of(m.group(2)), html.escape(m.group(1), quote=True)))
            i += 1; continue
        if st.startswith('|'):
            rows = []
            while i < len(L) and L[i].strip().startswith('|'):
                rows.append(L[i].strip()); i += 1
            out.append('<div class="table-scroll">' + table(rows) + '</div>'); continue
        if st.startswith('> ') or st == '>':
            buf = []
            while i < len(L) and (L[i].strip().startswith('> ') or L[i].strip() == '>'):
                buf.append(L[i].strip()[2:] if L[i].strip() != '>' else ''); i += 1
            ps = [p.strip() for p in '\n'.join(buf).split('\n\n') if p.strip()]
            out.append('<blockquote>' +
                       ''.join('<p>%s</p>' % inline(' '.join(p.split('\n'))) for p in ps) +
                       '</blockquote>')
            continue
        if st.startswith('- '):
            items = []
            while i < len(L) and (L[i].strip().startswith('- ') or
                                  (L[i].startswith('  ') and L[i].strip() and items)):
                if L[i].strip().startswith('- '): items.append(L[i].strip()[2:])
                else:                             items[-1] += ' ' + L[i].strip()
                i += 1
            out.append('<ul>' + ''.join('<li>%s</li>' % inline(x) for x in items) + '</ul>')
            continue
        buf = []
        while i < len(L) and L[i].strip() and \
                not L[i].strip().startswith(('#', '|', '>', '- ', '!', '---')):
            buf.append(L[i].strip()); i += 1
        out.append('<p>%s</p>' % inline(' '.join(buf)))

    meta = ''.join('              <span>%s</span>\n              <span>·</span>\n' % a
                   for a in AUTHORS)
    block = ('        <!-- ─────────── ARTICLE ─────────── -->\n'
             '        <article id="%s">\n'
             '          <div class="article-head">\n'
             '            <h2>%s</h2>\n'
             '            <div class="article-meta">\n%s'
             '              <span>%s</span>\n'
             '              <a class="src-link" href="%s">%s</a>\n'
             '            </div>\n'
             '          </div>\n'
             '          <div class="article-body">\n'
             '            <p><em>%s</em></p>\n%s\n'
             '          </div>\n'
             '        </article>\n\n'
             ) % (SLUG, html.escape(title), meta, DATE, SRCLINK[0], SRCLINK[1],
                  html.escape(subtitle),
                  '\n'.join('            ' + l for l in out))
    return title, block


def _mdY_to_sortkey(mdY):
    m, d, y = mdY.split('-')
    return (y, m, d)


def main():
    title, block = render(io.open(os.path.join(HERE, 'article.md'), encoding='utf-8').read())
    p = os.path.join(ROOT, 'articles.html')
    s = io.open(p, encoding='utf-8').read()

    # --- article block: replace in place, or insert as the newest ---
    pat = re.compile(r'([ \t]*<!-- [^\n]*ARTICLE[^\n]*-->\n)?[ \t]*<article id="%s">.*?</article>\n\n?'
                     % re.escape(SLUG), re.S)
    if pat.search(s):
        s = pat.sub(block, s, count=1)
    else:
        m = re.search(r'[ \t]*<!-- [^\n]*ARTICLE[^\n]*-->\n[ \t]*<article id="', s)
        if not m:
            sys.exit('could not find the first <article> block in articles.html')
        s = s[:m.start()] + block + s[m.start():]

    # --- index entry ---
    # The index is <ol id="articleIndex"> with <li><a href="#slug" data-target="slug">
    # <span class="art-date">MM-DD-YYYY</span><span class="art-title">Title</span></a></li>
    # entries, newest first (no counter/--art-start any more — that scheme was replaced
    # 2026-08-31; see build.py's DATE comment). Insert/move this article into the correct
    # chronological slot rather than always prepending, since a future article added here
    # is not guaranteed to be the newest one on the page.
    li = ('          <li><a href="#%s" data-target="%s">'
          '<span class="art-date">%s</span><span class="art-title">%s</span></a></li>\n'
          % (SLUG, SLUG, DATE, html.escape(title)))

    s = re.sub(r'[ \t]*<li><a href="#%s" data-target="%s">.*?</a></li>\n' % (SLUG, SLUG), '', s)

    ol = re.search(r'<ol id="articleIndex"[^>]*>\n', s)
    if not ol:
        sys.exit('could not find <ol id="articleIndex"> in articles.html')
    body_start = ol.end()
    body_end = body_start + s[body_start:].index('</ol>')
    region = s[body_start:body_end]
    # Every <li> ends in its own trailing "\n"; only the pure-whitespace indent
    # of the closing tag itself (e.g. "        ") is left over after the last
    # one, and must be re-attached rather than dropped, or the reconstructed
    # </ol> loses its indentation. (An earlier version instead let an optional
    # leading \n in the close-tag pattern greedily eat the LAST <li>'s own
    # terminating newline, silently dropping that item from findall — caught
    # by diffing against the six pre-existing articles before pushing.)
    tail_ws = re.search(r'[ \t]*\Z', region).group(0)
    items = re.findall(r'[ \t]*<li>.*?</li>\n', region[:len(region) - len(tail_ws)], re.S)
    dates = [re.search(r'class="art-date">([^<]+)<', it) for it in items]
    key = _mdY_to_sortkey(DATE)
    idx = next((i for i, d in enumerate(dates) if d and _mdY_to_sortkey(d.group(1)) < key), len(items))
    items.insert(idx, li)
    s = s[:body_start] + ''.join(items) + tail_ws + s[body_end:]

    io.open(p, 'w', encoding='utf-8').write(s)
    print('articles.html updated: %s' % SLUG)


if __name__ == '__main__':
    main()
