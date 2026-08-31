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
DATE    = 'August 2026'
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


def table(rows):
    hdr = [c.strip() for c in rows[0].strip('|').split('|')]
    o = ['<table><thead><tr>' + ''.join('<th>%s</th>' % inline(c) for c in hdr) +
         '</tr></thead><tbody>']
    for r in rows[2:]:
        cs = [c.strip() for c in r.strip('|').split('|')]
        o.append('<tr>' + ''.join('<td>%s</td>' % inline(c) for c in cs) + '</tr>')
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

    # --- index entry + numbering ---
    if 'data-target="%s"' % SLUG not in s:
        m = re.search(r'<ol id="articleIndex" style="--art-start: (\d+)">\n', s)
        n = int(m.group(1))
        s = (s[:m.start()] + '<ol id="articleIndex" style="--art-start: %d">\n' % (n + 1) +
             '          <li><a href="#%s" data-target="%s">%s</a></li>\n' % (SLUG, SLUG, html.escape(title)) +
             s[m.end():])
    else:
        s = re.sub(r'(<li><a href="#%s" data-target="%s">).*?(</a></li>)' % (SLUG, SLUG),
                   lambda m: m.group(1) + html.escape(title) + m.group(2), s, count=1)

    io.open(p, 'w', encoding='utf-8').write(s)
    print('articles.html updated: %s' % SLUG)


if __name__ == '__main__':
    main()
