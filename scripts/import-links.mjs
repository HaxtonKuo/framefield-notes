import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const postsDir = join(root, "src/content/posts");
const defaultLinksFile = join(root, "data/import-links.txt");

const args = process.argv.slice(2);
const options = {
  file: defaultLinksFile,
  author: "郭豪",
  authorInitials: "KH",
  category: "每日精選",
  dryRun: false,
};

const directLinks = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--file") {
    options.file = join(root, args[index + 1] || "");
    index += 1;
  } else if (arg === "--author") {
    options.author = args[index + 1] || options.author;
    index += 1;
  } else if (arg === "--initials") {
    options.authorInitials = args[index + 1] || options.authorInitials;
    index += 1;
  } else if (arg === "--category") {
    options.category = args[index + 1] || options.category;
    index += 1;
  } else if (arg === "--dry-run") {
    options.dryRun = true;
  } else {
    directLinks.push(arg);
  }
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function getMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }

  return "";
}

function getTitle(html) {
  return getMeta(html, "og:title") || stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
}

function getDescription(html) {
  return getMeta(html, "og:description") || getMeta(html, "description");
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || `daily-${Date.now()}`;
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

function estimateReadingTime(text) {
  const compact = text.replace(/\s+/g, "");
  return `${Math.max(1, Math.ceil(compact.length / 600))} 分鐘閱讀`;
}

function normalizeUrl(value) {
  try {
    const url = new URL(value.trim());
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

async function readLinks() {
  const fileLinks = await readFile(options.file, "utf8")
    .then((content) =>
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    )
    .catch(() => []);

  return [...new Set([...fileLinks, ...directLinks].map(normalizeUrl).filter(Boolean))];
}

async function existingSources() {
  const files = await readdir(postsDir).catch(() => []);
  const sources = new Set();

  for (const file of files.filter((item) => item.endsWith(".md"))) {
    const content = await readFile(join(postsDir, file), "utf8");
    const match = content.match(/^sourceUrl:\s*["']?([^"'\n]+)["']?\s*$/m);
    if (match?.[1]) sources.add(normalizeUrl(match[1]));
  }

  return sources;
}

async function uniquePostFilename(slug) {
  const existing = new Set(await readdir(postsDir).catch(() => []));
  let filename = `${slug}.md`;
  let count = 2;

  while (existing.has(filename)) {
    filename = `${slug}-${count}.md`;
    count += 1;
  }

  return filename;
}

async function fetchArticle(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "kouhanBot/1.0 (+https://framefield-notes.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const title = getTitle(html) || new URL(url).hostname;
  const description = getDescription(html) || `閱讀原文：${url}`;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const slug = slugify(`${host}-${title}`).slice(0, 64) || `daily-${hash}`;
  const summary = description.length > 220 ? `${description.slice(0, 217)}...` : description;
  const body = [
    "## 摘要",
    "",
    summary,
    "",
    "## 來源",
    "",
    `本文為連結整理與摘要草稿，請發布前確認內容與授權。`,
    "",
    `[閱讀原文](${url})`,
    "",
  ].join("\n");

  return {
    title,
    description: summary,
    slug: `${slug}-${hash}`,
    body,
  };
}

async function createPost(url, article) {
  await mkdir(postsDir, { recursive: true });

  const filename = await uniquePostFilename(article.slug);
  const content = [
    "---",
    `title: ${quoteYaml(article.title)}`,
    `description: ${quoteYaml(article.description)}`,
    `pubDate: ${new Date().toISOString().slice(0, 10)}`,
    `author: ${quoteYaml(options.author)}`,
    `authorInitials: ${quoteYaml(options.authorInitials)}`,
    `readingTime: ${quoteYaml(estimateReadingTime(article.body))}`,
    `categories: [${quoteYaml(options.category)}]`,
    `sourceUrl: ${quoteYaml(url)}`,
    "featured: false",
    "---",
    "",
    article.body,
  ].join("\n");

  if (!options.dryRun) {
    await writeFile(join(postsDir, filename), content);
  }

  return filename;
}

async function main() {
  const links = await readLinks();
  const existing = await existingSources();

  if (!links.length) {
    console.log(`No links found. Add URLs to ${basename(options.file)} or pass URLs as arguments.`);
    return;
  }

  let created = 0;

  for (const url of links) {
    if (existing.has(url)) {
      console.log(`Skipped existing: ${url}`);
      continue;
    }

    try {
      const article = await fetchArticle(url);
      const filename = await createPost(url, article);
      console.log(`${options.dryRun ? "Would create" : "Created"} ${filename}`);
      created += 1;
    } catch (error) {
      console.log(`Failed ${url}: ${error.message}`);
    }
  }

  console.log(`${options.dryRun ? "Previewed" : "Imported"} ${created} new article(s).`);
}

await main();
