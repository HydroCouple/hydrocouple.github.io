"""Render this article using the site's existing article renderer and index rules."""
from __future__ import annotations
import argparse
import html
import importlib.util
from pathlib import Path
import re
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
SLUG='uk-2d-benchmark-assessment'


def renderer():
    path=HERE.parent/'lid-storage-node/build.py'
    spec=importlib.util.spec_from_file_location('hydrocouple_article_renderer',path)
    mod=importlib.util.module_from_spec(spec)
    previous=sys.dont_write_bytecode;sys.dont_write_bytecode=True
    try:spec.loader.exec_module(mod)
    finally:sys.dont_write_bytecode=previous
    mod.SLUG=SLUG;mod.ROOT=str(ROOT);mod.AUTHORS=['Codex'];mod.DATE='10-22-2026'
    mod.SRCLINK=('articles/'+SLUG+'/evidence/report.html','Read the technical evidence report →')
    if (HERE/'evidence/g2-reconstruction/publication-manifest.json').is_file():
        mod.SRCLINK=('articles/'+SLUG+'/evidence/g2-reconstruction/report.html','Read the latest reconstruction qualification →')
    mod.ANIMATION_SUPPORT=''
    return mod


def build(preview_only=False):
    mod=renderer();md=(HERE/'article.md').read_text(encoding='utf-8')
    title,block=mod.render(md)
    # The established renderer creates website-root-relative asset paths.
    preview=mod.linkedin_page(title,block)
    (HERE/'preview.html').write_text(preview,encoding='utf-8')
    if preview_only:return
    target=ROOT/'articles.html';text=target.read_text(encoding='utf-8')
    pattern=re.compile(r'([ \t]*<!-- [^\n]*ARTICLE[^\n]*-->\n)?[ \t]*<article id="'+SLUG+r'">.*?</article>\n\n?',re.S)
    if pattern.search(text):text=pattern.sub(lambda m:block,text,count=1)
    else:
        first=re.search(r'[ \t]*<!-- [^\n]*ARTICLE[^\n]*-->\n[ \t]*<article id="',text)
        if not first:raise ValueError('Missing existing article insertion anchor')
        text=text[:first.start()]+block+text[first.start():]
    entry=('          <li><a href="#'+SLUG+'" data-target="'+SLUG+'"><span class="art-date">'+mod.DATE+
           '</span><span class="art-title">'+html.escape(title)+'</span></a></li>\n')
    text=re.sub(r'[ \t]*<li><a href="#'+SLUG+'" data-target="'+SLUG+r'">.*?</a></li>\n','',text)
    opening=re.search(r'<ol id="articleIndex"[^>]*>\n',text)
    if not opening:raise ValueError('Missing article index')
    start=opening.end();end=text.index('</ol>',start);region=text[start:end]
    tail=re.search(r'[ \t]*\Z',region).group(0)
    content=region[:-len(tail)] if tail else region
    items=re.findall(r'[ \t]*<li>.*?</li>\n',content,re.S)
    dates=[re.search(r'class="art-date">([^<]+)<',x) for x in items]
    key=mod._mdY_to_sortkey(mod.DATE)
    index=next((i for i,d in enumerate(dates) if d and mod._mdY_to_sortkey(d[1])<key),len(items))
    items.insert(index,entry);text=text[:start]+''.join(items)+tail+text[end:]
    target.write_text(text,encoding='utf-8')

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--preview-only',action='store_true')
    args=ap.parse_args();build(args.preview_only)
