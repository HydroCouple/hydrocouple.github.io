# Distributed LID article source

`article.md` is the website source; `build.py` updates this article and its
index entry in `../../articles.html`. Run `python3 build.py` from this folder.
GIFs, static posters and SVG sources live in `../../img/articles/lid-storage-node/`.

The LinkedIn article is an identical export of `article.md`; `build.py` keeps
its Markdown and HTML preview synchronized. The companion post is a separate
announcement draft. The standalone
`tutorial.html` documents the six chain models plus the supplementary
`models/lid_resaturation.inp` reversal/recession test; `validation.html`
and `validation.md` record the solver checks and interpretation limits.

The reproducible example generation and figure scripts, sampled CSVs and
native reports are maintained in the sibling openswmm.gui repository under
`docs/articles/lid-storage-node/`. GUI T10 is in `docs/manual/tutorials/`.

This local website update has not been pushed or published. GIFs include
static alternatives and website controls for reduced-motion viewing.
