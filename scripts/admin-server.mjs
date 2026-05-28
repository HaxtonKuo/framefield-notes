import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { extname, join } from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const postsDir = join(root, "src/content/posts");
const imagesDir = join(root, "public/assets/images");
const port = Number(process.env.ADMIN_PORT || 8787);

function htmlPage(message = "") {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Framefield 後台</title>
    <style>
      :root {
        --ink: #101010;
        --muted: #6f6f6f;
        --line: #dedede;
        --paper: #f7f7f5;
        --accent: #ff4b1f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        background: #fff;
        font-family: Inter, "Noto Sans TC", "PingFang TC", system-ui, sans-serif;
        line-height: 1.55;
      }
      header, main {
        width: min(980px, calc(100% - 32px));
        margin-inline: auto;
      }
      header {
        min-height: 96px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        border-bottom: 1px solid var(--line);
      }
      h1 {
        margin: 0;
        font-size: clamp(32px, 5vw, 56px);
        line-height: 1;
      }
      header a {
        color: var(--muted);
        text-decoration: none;
      }
      main {
        padding-block: 42px 76px;
      }
      .notice {
        margin-bottom: 24px;
        border-left: 4px solid var(--accent);
        background: var(--paper);
        padding: 14px 16px;
      }
      form {
        display: grid;
        gap: 22px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      label {
        display: grid;
        gap: 8px;
        font-weight: 700;
      }
      small {
        color: var(--muted);
        font-weight: 400;
      }
      input, textarea {
        width: 100%;
        min-height: 48px;
        border: 1px solid var(--line);
        border-radius: 0;
        padding: 12px 14px;
        font: inherit;
      }
      textarea {
        min-height: 320px;
        resize: vertical;
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .checkbox input {
        width: 18px;
        min-height: 18px;
      }
      button {
        width: fit-content;
        min-height: 52px;
        border: 1px solid var(--ink);
        background: var(--ink);
        color: #fff;
        padding: 0 22px;
        font: inherit;
        cursor: pointer;
      }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
        header { align-items: flex-start; flex-direction: column; justify-content: center; }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>Framefield 後台</h1>
        <p>新增文章、封面圖與文章資料。</p>
      </div>
      <a href="http://127.0.0.1:4321/" target="_blank" rel="noreferrer">開啟網站</a>
    </header>
    <main>
      ${message ? `<div class="notice">${message}</div>` : ""}
      <form action="/admin/posts" method="post" enctype="multipart/form-data">
        <div class="grid">
          <label>
            文章標題
            <input name="title" required placeholder="例如：一週視覺筆記" />
          </label>
          <label>
            網址代稱
            <input name="slug" placeholder="留空會自動產生，例如 weekly-visual-notes" />
          </label>
        </div>
        <label>
          摘要
          <input name="description" required placeholder="會出現在首頁、文章列表與 SEO 描述" />
        </label>
        <div class="grid">
          <label>
            作者
            <input name="author" required value="郭豪" />
          </label>
          <label>
            作者縮寫
            <input name="authorInitials" value="KH" />
          </label>
        </div>
        <div class="grid">
          <label>
            發布日期
            <input name="pubDate" type="date" value="${new Date().toISOString().slice(0, 10)}" />
          </label>
          <label>
            閱讀時間
            <input name="readingTime" placeholder="留空會自動估算" />
          </label>
        </div>
        <label>
          分類標籤
          <input name="categories" required placeholder="用逗號分隔，例如 影像生成, 工作流, 評測" />
        </label>
        <div class="grid">
          <label>
            封面圖片
            <input name="cover" type="file" accept="image/*" />
            <small>可不放。請上傳壓縮後網頁圖；原始大圖請放外部雲端。</small>
          </label>
          <label>
            封面描述
            <input name="coverAlt" placeholder="給搜尋與無障礙使用" />
          </label>
        </div>
        <label class="checkbox">
          <input name="featured" type="checkbox" value="true" />
          設為首頁主打文章
        </label>
        <label>
          文章正文
          <textarea name="body" required placeholder="可直接貼 Markdown。小標用 ##，圖片可用 ![說明](/assets/images/file.jpg)"></textarea>
        </label>
        <button type="submit">發布文章</button>
      </form>
    </main>
  </body>
</html>`;
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary.");

  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(marker);

  while (start !== -1) {
    start += marker.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;

    const headers = buffer.slice(start, headerEnd).toString("utf8");
    let bodyStart = headerEnd + 4;
    let next = buffer.indexOf(marker, bodyStart);
    if (next === -1) break;
    let bodyEnd = next;
    if (buffer[bodyEnd - 2] === 13 && buffer[bodyEnd - 1] === 10) bodyEnd -= 2;

    parts.push({ headers, data: buffer.slice(bodyStart, bodyEnd) });
    start = next;
  }

  const fields = {};
  const files = {};

  for (const part of parts) {
    const disposition = part.headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const mime = part.headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();

    if (!name) continue;
    if (filename) {
      files[name] = { filename, mime, data: part.data };
    } else {
      fields[name] = part.data.toString("utf8").trim();
    }
  }

  return { fields, files };
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `post-${Date.now()}`;
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

function estimateReadingTime(body) {
  const compact = body.replace(/\s+/g, "");
  const minutes = Math.max(1, Math.ceil(compact.length / 600));
  return `${minutes} 分鐘閱讀`;
}

async function ensureUniqueFile(baseDir, baseName, extension) {
  let filename = `${baseName}${extension}`;
  let count = 2;
  const existing = new Set(await readdir(baseDir).catch(() => []));

  while (existing.has(filename)) {
    filename = `${baseName}-${count}${extension}`;
    count += 1;
  }

  return filename;
}

async function unsetOtherFeaturedPosts() {
  const files = await readdir(postsDir).catch(() => []);

  await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        const path = join(postsDir, file);
        const content = await readFile(path, "utf8");
        const next = content.replace(/^featured:\s*true\s*$/m, "featured: false");
        if (next !== content) await writeFile(path, next);
      }),
  );
}

async function createPost(fields, files) {
  await mkdir(postsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const title = fields.title || "未命名文章";
  const slug = slugify(fields.slug || title);
  const filename = await ensureUniqueFile(postsDir, slug, ".md");
  const postSlug = filename.replace(/\.md$/, "");
  const body = fields.body || "";
  const categories = (fields.categories || "")
    .split(/[,，]/)
    .map((category) => category.trim())
    .filter(Boolean);
  const featured = fields.featured === "true";
  let coverLine = "";
  let coverAltLine = "";

  if (files.cover?.data?.length) {
    const extension = extname(files.cover.filename).toLowerCase() || ".jpg";
    const imageName = await ensureUniqueFile(imagesDir, postSlug, extension);
    await writeFile(join(imagesDir, imageName), files.cover.data);
    coverLine = `cover: ${quoteYaml(`/assets/images/${imageName}`)}\n`;
    coverAltLine = `coverAlt: ${quoteYaml(fields.coverAlt || title)}\n`;
  } else if (fields.coverAlt) {
    coverAltLine = `coverAlt: ${quoteYaml(fields.coverAlt)}\n`;
  }

  if (featured) await unsetOtherFeaturedPosts();

  const frontmatter = [
    "---",
    `title: ${quoteYaml(title)}`,
    `description: ${quoteYaml(fields.description || "")}`,
    `pubDate: ${fields.pubDate || new Date().toISOString().slice(0, 10)}`,
    `author: ${quoteYaml(fields.author || "作者")}`,
    `authorInitials: ${quoteYaml(fields.authorInitials || (fields.author || "作者").slice(0, 2).toUpperCase())}`,
    `readingTime: ${quoteYaml(fields.readingTime || estimateReadingTime(body))}`,
    `categories: [${categories.map(quoteYaml).join(", ")}]`,
    coverLine.trimEnd(),
    coverAltLine.trimEnd(),
    `featured: ${featured ? "true" : "false"}`,
    "---",
    "",
  ].filter(Boolean);

  await writeFile(join(postsDir, filename), `${frontmatter.join("\n")}${body.trim()}\n`);

  return { filename, postSlug };
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && (request.url === "/" || request.url === "/admin")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(htmlPage());
      return;
    }

    if (request.method === "POST" && request.url === "/admin/posts") {
      const body = await collectRequestBody(request);
      const { fields, files } = parseMultipart(body, request.headers["content-type"] || "");
      const post = await createPost(fields, files);
      const message = `已建立文章：<strong>${post.filename}</strong>。<a href="http://127.0.0.1:4321/articles/${post.postSlug}/" target="_blank" rel="noreferrer">開啟文章</a>`;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(htmlPage(message));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    response.end(htmlPage(`發生錯誤：${String(error.message || error)}`));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Framefield admin is running at http://127.0.0.1:${port}/admin`);
});
