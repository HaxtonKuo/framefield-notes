# Framefield Notes

This Astro content site keeps article writing in Markdown and generates the homepage,
archive, and long-form article pages from the same post data.

## Run

```sh
npm install
npm run dev
```

## Local Admin

Start the article admin in another terminal:

```sh
npm run admin
```

Then open:

```text
http://127.0.0.1:8787/admin
```

The admin form writes Markdown posts into `src/content/posts/` and copies uploaded
cover images into `public/assets/images/`.

## Online Admin

The site also includes a Vercel-hosted admin page at:

```text
https://your-domain.com/admin
```

The online admin is password protected and uses the GitHub API to commit article
changes back into `src/content/posts/`. After each save or delete, Vercel
redeploys from GitHub automatically.

Set these Vercel environment variables before using it:

```text
ADMIN_PASSWORD=your-login-password
ADMIN_SECRET=a-long-random-session-secret
GITHUB_TOKEN=github-token-with-repo-access
GITHUB_OWNER=HaxtonKuo
GITHUB_REPO=framefield-notes
GITHUB_BRANCH=main
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-4.1-mini
```

Use a fine-grained GitHub token limited to this repository with **Contents:
Read and write** permission. Do not commit real secrets into GitHub.

`OPENAI_API_KEY` is required only for the online **AI 匯入連結** feature.

## Import Links

Paste article URLs into `data/import-links.txt`, one URL per line, then run:

```sh
npm run import:links
```

The importer creates Markdown draft posts in `src/content/posts/` with title,
description, source URL, and a short source note. It does not copy full articles.

Preview without writing files:

```sh
npm run import:links:dry
```

You can also pass URLs directly:

```sh
npm run import:links -- https://example.com/article
```

The GitHub Actions workflow `.github/workflows/daily-links.yml` can run the same
importer manually or on a daily schedule after these changes are pushed to GitHub.

## AI Draft Import

Create `.env` from `.env.example` and set `OPENAI_API_KEY`.

Paste article URLs into `data/import-links.txt`, then preview AI-generated
drafts:

```sh
npm run import:ai:dry
```

Write AI-generated Markdown drafts:

```sh
npm run import:ai
```

The AI importer creates original Chinese drafts with:

- SEO title and description
- categories
- Markdown body
- `sourceUrl`
- a cover image prompt saved inside the article

It does not generate images yet. Review drafts before publishing.

## Content Asset Rules

Read [CONTENT_ASSETS.md](./CONTENT_ASSETS.md) before uploading many articles,
images, prompt packs, videos, or downloadable files.

Short version:

- GitHub stores code, Markdown articles, and compressed web images.
- External storage stores original AI images, videos, ZIP files, prompt packs,
  and client/source files.
- Use `sourceUrl` for imported or referenced external articles.
- Do not copy full external articles into this site.

## Main Pages

- `src/pages/index.astro`: homepage and featured story layout
- `src/pages/articles/index.astro`: article archive with keyword filtering
- `src/pages/articles/[id].astro`: Markdown article route
- `src/pages/downloads.astro`: Google Drive/download resource page
- `src/pages/about.astro`: publication and author page

## Download Resources

Edit `src/data/downloads.ts` to add Google Drive, Dropbox, Cloudflare R2,
Gumroad, Lemon Squeezy, or other download links.

Keep large files outside GitHub. The site should only store the download title,
description, category, update date, and external URL.

## Add A Post

Create a Markdown file in `src/content/posts/` with frontmatter like:

```md
---
title: "Article title"
description: "Short summary for lists and SEO."
pubDate: 2026-05-22
author: "Author name"
authorInitials: "AN"
readingTime: "6 分鐘閱讀"
categories: ["影像生成", "教學"]
cover: "/assets/images/cover.jpg"
coverAlt: "Cover description"
---
```

The first post with `featured: true` becomes the homepage lead story.

## Replace First

1. Change the site name and footer copy in `src/components/`.
2. Replace sample covers in `public/assets/images/`.
3. Replace sample Markdown posts in `src/content/posts/`.
4. Update navigation links when real sections are ready.

## Shared Files

- `src/content.config.ts`: post field validation
- `src/styles/global.css`: layout, color, typography, and responsive styling
- `public/scripts/site.js`: mobile menu and article search behavior

## Deploy To Vercel

1. Push this project to GitHub.
2. Open Vercel and choose **Add New Project**.
3. Import the GitHub repository.
4. Use these settings:

```text
Framework Preset: Astro
Install Command: npm install
Build Command: npm run build
Output Directory: dist
```

The local admin at `http://127.0.0.1:8787/admin` is for editing on your computer.
After it creates or updates Markdown posts and images, commit and push those files
to GitHub. Vercel will redeploy the public website automatically.
