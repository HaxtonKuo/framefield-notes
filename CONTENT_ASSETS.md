# Content Asset Rules

This project is designed to avoid future migration pain. Keep code, articles,
and lightweight web assets in GitHub. Keep large originals and commercial files
outside GitHub.

## Where Things Go

| Asset type | Store here | Notes |
| --- | --- | --- |
| Website code | GitHub | Astro files, components, styles, scripts |
| Markdown articles | `src/content/posts/` | Canonical article content |
| Web cover images | `public/assets/images/` | Compressed JPG/WebP/AVIF only |
| Inline article images | `public/assets/images/` | Use optimized web-size images |
| Original AI images | External storage | Google Drive, Dropbox, Cloudflare R2, Cloudinary |
| Videos | External storage | YouTube, Vimeo, Cloudflare Stream, R2/S3 |
| Prompt packs / downloads | External sales or storage | Gumroad, Lemon Squeezy, Drive, R2/S3 |
| Client files / source files | External private storage | Do not commit PSD, Figma exports, raw project files |

## GitHub Size Rules

GitHub should stay small and fast.

- Keep individual web images under 1 MB when possible.
- Avoid committing files over 10 MB.
- Never commit raw video, ZIP packs, PSD files, or large AI originals.
- Keep the repository ideally under 1 GB.

## Image Rules

Before adding images to `public/assets/images/`:

1. Resize to the largest display size needed by the page.
2. Export as `.webp`, `.avif`, or compressed `.jpg`.
3. Use semantic filenames:

```text
ai-packaging-workflow-cover.webp
prompt-example-before-after.webp
brand-case-study-hero.jpg
```

4. Add useful alt text in article frontmatter or Markdown.

Bad filenames:

```text
IMG_1234.png
final-final-v3.png
截圖 2026-05-28.png
```

## Article Frontmatter Rules

Every post should include:

```md
---
title: "Article title"
description: "Short SEO summary."
pubDate: 2026-05-28
author: "郭豪"
authorInitials: "KH"
readingTime: "6 分鐘閱讀"
categories: ["AI 設計", "工作流"]
cover: "/assets/images/example-cover.webp"
coverAlt: "Clear description of the cover image"
sourceUrl: "https://example.com/original"
featured: false
---
```

Use `sourceUrl` when the article is based on an external link or reference.

## External Source Rules

When importing outside articles:

- Do not copy full articles.
- Create short summaries, notes, or commentary.
- Always keep the original source link.
- Avoid using source images unless the license allows it.
- Prefer your own screenshots, generated images, or licensed assets.

## Future CMS Path

If the site later moves to a CMS, preserve these fields:

- `title`
- `description`
- `pubDate`
- `author`
- `authorInitials`
- `categories`
- `cover`
- `coverAlt`
- `sourceUrl`
- `featured`
- Markdown body

Because the content is already structured, migrating to Sanity, TinaCMS,
Contentful, or another Headless CMS should not require rewriting the articles.

## Upgrade Path

Current:

```text
Astro + Markdown + GitHub + Vercel
```

Later:

```text
Astro + Headless CMS + external media storage + Vercel
```

The key is to keep large media and downloads out of GitHub from the beginning.
