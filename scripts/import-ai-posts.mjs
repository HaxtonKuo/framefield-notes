import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const postsDir = join(root, "src/content/posts");
const defaultLinksFile = join(root, "data/import-links.txt");
const envFile = join(root, ".env");

const args = process.argv.slice(2);
const options = {
  file: defaultLinksFile,
  model: "gpt-4.1-mini",
  author: "郭豪",
  authorInitials: "KH",
  dryRun: false,
};

const directLinks = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--file") {
    options.file = join(root, args[index + 1] || "");
    index += 1;
  } else if (arg === "--model") {
    options.model = args[index + 1] || options.model;
    index += 1;
  } else if (arg === "--dry-run") {
    options.dryRun = true;
  } else {
    directLinks.push(arg);
  }
}

async function loadEnv() {
  const content = await readFile(envFile, "utf8").catch(() => "");

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!process.env[key]) process.env[key] = value.replace(/^["']|["']$/g, "");
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
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
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

function getArticleText(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] || "";
  const source = article || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
  return stripTags(source).slice(0, 8000);
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
  return `${Math.max(2, Math.ceil(compact.length / 600))} 分鐘閱讀`;
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

function titleFromUrl(url) {
  const { hostname, pathname } = new URL(url);
  const lastPath = pathname
    .split("/")
    .filter(Boolean)
    .pop();

  if (!lastPath) return hostname;

  return decodeURIComponent(lastPath)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(value) {
  const cleaned = value.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response did not contain JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
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

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "FramefieldBot/1.0 (+https://framefield-notes.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  return {
    title: getTitle(html) || new URL(url).hostname,
    description: getDescription(html),
    articleText: getArticleText(html),
  };
}

function fallbackSource(url, reason) {
  return {
    title: titleFromUrl(url),
    description: `來源頁面無法自動讀取（${reason}），此草稿先依網址主題建立，需人工補充與校對。`,
    articleText: "",
  };
}

async function generateDraft({ url, title, description, articleText }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in .env");
  if (!/^sk-/.test(apiKey)) {
    throw new Error("OPENAI_API_KEY in .env looks incorrect. It should start with sk-");
  }

  const prompt = [
    "你是 Framefield Notes 的中文內容編輯。",
    "根據來源資訊，產生一篇繁體中文原創草稿，但不要寫成原文摘要。",
    "請把來源文章當成選題靈感，改寫成 2026 年視角的趨勢觀察、內容策略或設計工作流文章。",
    "可以使用 2026 作為標題年份，但只能寫趨勢、方法、選題角度與可執行建議；不要編造 2026 真實新品、品牌排名、價格或實際上市資訊。",
    "不要翻譯或複製原文全文；不要照抄原文產品清單。",
    "如果來源是舊文章，請明確轉化為『從舊選題延伸出的 2026 內容方向』。",
    "保留來源連結，語氣專業、清楚、適合 AI 設計/創作工具內容站。",
    "請只輸出 JSON，格式如下：",
    "{",
    '  "title": "中文 SEO 標題，28 字內，可含 2026",',
    '  "description": "SEO 摘要，80 字內",',
    '  "categories": ["2026 趨勢", "AI 設計"],',
    '  "body": "Markdown 正文，包含 ## 2026 選題角度、## 設計與內容趨勢、## 可以怎麼用、## 發佈前校對、## 來源",',
    '  "coverPrompt": "英文封面圖生成提示詞，無品牌、無文字、適合 16:9 editorial cover"',
    "}",
    "",
    `來源網址：${url}`,
    `來源標題：${title}`,
    `來源摘要：${description || "無"}`,
    `來源文字節錄：${articleText || "無"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      input: prompt,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 240)}`);
  }

  const json = await response.json();
  const text = json.output_text || json.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n");
  if (!text) throw new Error("OpenAI response was empty.");

  const draft = extractJson(text);

  return {
    title: String(draft.title || title),
    description: String(draft.description || description || ""),
    categories: Array.isArray(draft.categories) && draft.categories.length ? draft.categories.map(String) : ["每日精選"],
    body: String(draft.body || ""),
    coverPrompt: String(draft.coverPrompt || ""),
  };
}

async function createPost(url, source, draft) {
  await mkdir(postsDir, { recursive: true });

  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  const slug = `${slugify(draft.title || source.title)}-${hash}`;
  const filename = await uniquePostFilename(slug);
  const body = `${draft.body.trim()}\n\n## 封面圖提示詞\n\n\`\`\`text\n${draft.coverPrompt.trim()}\n\`\`\`\n`;
  const content = [
    "---",
    `title: ${quoteYaml(draft.title)}`,
    `description: ${quoteYaml(draft.description)}`,
    `pubDate: ${new Date().toISOString().slice(0, 10)}`,
    `author: ${quoteYaml(options.author)}`,
    `authorInitials: ${quoteYaml(options.authorInitials)}`,
    `readingTime: ${quoteYaml(estimateReadingTime(body))}`,
    `categories: [${draft.categories.map(quoteYaml).join(", ")}]`,
    `sourceUrl: ${quoteYaml(url)}`,
    "featured: false",
    "---",
    "",
    body,
  ].join("\n");

  if (!options.dryRun) {
    await writeFile(join(postsDir, filename), content);
  }

  return filename;
}

async function main() {
  await loadEnv();

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
      let source;
      let sourceWarning = "";

      try {
        source = await fetchSource(url);
      } catch (error) {
        sourceWarning = error.message;
        source = fallbackSource(url, error.message);
      }

      if (options.dryRun) {
        console.log(`Would import: ${source.title}${sourceWarning ? " (fallback)" : ""}`);
        console.log(`  ${url}`);
        if (source.description) {
          console.log(`  ${source.description}`);
        }
        created += 1;
        continue;
      }

      const draft = await generateDraft({ url, ...source });
      const filename = await createPost(url, source, draft);
      console.log(`Created ${filename}${sourceWarning ? ` (source fallback: ${sourceWarning})` : ""}`);
      created += 1;
    } catch (error) {
      console.log(`Failed ${url}: ${error.message}`);
    }
  }

  console.log(`${options.dryRun ? "Previewed" : "Imported"} ${created} AI article(s).`);
}

await main();
