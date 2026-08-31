# Article sources

`articles.html` is the published page: it carries every article inline, newest
first, with a numbered index down the left and a per-article giscus thread.
This directory holds the **sources** those blocks are generated from, one
directory per article, named by the article's slug (which is also its
`<article id>`, its `#anchor`, and the giscus discussion key — changing a slug
orphans that article's comment thread).

```
articles/<slug>/
  article.md      the article, in markdown
  build.py        renders article.md into ../../articles.html, in place
  figures/        scripts that generate the published figures
  drafts/         superseded drafts, kept for provenance (not published)
img/articles/<slug>/figN.png    the published figures themselves
```

## Adding or updating an article

```
cd articles/<slug> && python3 build.py
```

`build.py` is idempotent: it replaces its own article's block and leaves every
other article, the index numbering and the giscus wiring untouched. On first
run it also inserts the index entry and bumps `--art-start` (which must equal
the article count + 1, since the index counts downward so that article 1 is the
earliest published).

To start a new article, copy an existing directory, change the slug, and edit
the constants at the top of its `build.py` (author, date, source link, and the
commit SHA that code links are pinned to).

**Byline convention: the article is credited to whoever wrote it, and to no one
else.** Contributions to the underlying work are acknowledged in the text where
they are relevant, not by adding names to the byline.

## Conventions worth knowing

- **The site loads no MathJax.** Math is converted to Unicode at build time.
  Adding a new expression means adding it to that script's `MATH` table.
- **Links into a code repository are pinned to a commit SHA**, not a branch.
  Branches on these projects get deleted when their pull request merges, and a
  published article should not rot with them.
- **Figures are the only binary artifact.** They live under `img/articles/<slug>/`
  and are referenced from `article.md` by a relative path, so the markdown
  renders correctly on GitHub and the HTML renders correctly on the site,
  from one copy of each image.
