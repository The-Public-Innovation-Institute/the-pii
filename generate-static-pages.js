#!/usr/bin/env node
/**
 * generate-static-pages.js
 *
 * Problem this solves:
 *   GitHub Pages has no server-side router. A shared link like
 *   /research/post-1783949262532 has no matching file, so GitHub's server
 *   returns a *real* HTTP 404 before any JavaScript runs. The existing
 *   404.html -> index.html redirect trick fixes this for humans in a
 *   browser (their JS runs and the app boots correctly), but it does
 *   nothing for bots that don't execute JavaScript — Facebook's, LinkedIn's,
 *   and most link-preview scrapers just read the raw HTML at that exact
 *   URL and see a 404 with no post-specific <title> or og: tags.
 *
 * What this script does:
 *   For every research/publications article, program, and CAIL post stored
 *   in Supabase, it writes a real static file to e.g.
 *     research/post-1783949262532/index.html
 *   That file is byte-for-byte the same app shell as the real index.html
 *   (same styles, same React app, same <script> that boots it) — the ONLY
 *   difference is the <head> block: title, meta description, canonical,
 *   Open Graph, and Twitter Card tags are hard-coded to that specific post.
 *
 *   Result:
 *     - Bots/crawlers/link-unfurlers get a real 200 response with correct
 *       per-post preview data, because it's sitting there as a plain file —
 *       no JS required.
 *     - Real visitors get the exact same experience as today: the file
 *       loads the same React app, which then re-renders/re-hydrates
 *       normally client-side.
 *
 * Run:
 *   node scripts/generate-static-pages.js
 *
 * Requires Node 18+ (built-in fetch). No dependencies.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const INDEX_HTML_PATH = path.join(REPO_ROOT, "index.html");
const SITE_URL = "https://www.thepii.org";
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`;

const SUPABASE_URL = "https://ztjghmxqlxtcxdhrivqe.supabase.co";
// Public anon key — same one already shipped in index.html client-side.
// Read-only for this table; safe to reuse here.
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0amdobXhxbHh0Y3hkaHJpdnFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTkyNTcsImV4cCI6MjA5Nzk3NTI1N30.KEFy4vd__n5v8QJ-Ui57_YSFb6xsVeng8OPlXXEHFVM";

async function fetchSiteContent() {
  const url = `${SUPABASE_URL}/rest/v1/pii_site_content?id=eq.main&select=data`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Supabase fetch failed: ${res.status} ${res.statusText}`);
  }
  const rows = await res.json();
  if (!rows.length) throw new Error("pii_site_content row 'main' not found");
  return rows[0].data;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Matches the <title> ... last <meta name="twitter:image" ...> block
// (lines 16-34 in the current index.html). If this block's shape changes,
// update this regex to match.
const HEAD_BLOCK_RE =
  /<title>[\s\S]*?<meta name="twitter:image"[^>]*>/;

function buildHeadBlock({ title, description, url, image }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const img = escapeHtml(image || DEFAULT_OG_IMAGE);
  return `<title>${t}</title>
<meta name="description" content="${d}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${u}">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:site_name" content="The Public Innovation Institute">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:url" content="${u}">
<meta property="og:image" content="${img}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@thepii_org">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">`;
}

function writeStaticPage(template, urlPath, meta) {
  const headBlock = buildHeadBlock(meta);
  if (!HEAD_BLOCK_RE.test(template)) {
    throw new Error(
      "Could not find the expected <title>...twitter:image meta block in index.html. " +
        "The head layout may have changed — update HEAD_BLOCK_RE in generate-static-pages.js."
    );
  }
  const html = template.replace(HEAD_BLOCK_RE, headBlock);

  const outDir = path.join(REPO_ROOT, urlPath.replace(/^\/+/, ""));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  console.log(`  wrote ${urlPath}/index.html`);
}

async function main() {
  console.log("Fetching site content from Supabase...");
  const data = await fetchSiteContent();
  const template = fs.readFileSync(INDEX_HTML_PATH, "utf8");

  let count = 0;

  // Research + Publications articles (both sections read from data.research,
  // matching the routing logic in index.html's App component).
  for (const article of data.research || []) {
    const meta = {
      title: `${article.title} — PII`,
      description:
        article.excerpt ||
        "Working at the intersection of AI, public policy, and urban systems.",
      image: article.media || article.image || DEFAULT_OG_IMAGE,
    };
    for (const section of ["research", "publications"]) {
      writeStaticPage(template, `/${section}/${article.id}`, {
        ...meta,
        url: `${SITE_URL}/${section}/${article.id}`,
      });
      count++;
    }
  }

  // Programs
  for (const program of data.programs || []) {
    writeStaticPage(template, `/programs/${program.id}`, {
      title: `${program.title || program.name} — PII`,
      description:
        program.excerpt ||
        program.description ||
        "Academic and professional programs at the intersection of AI, policy, and urban systems.",
      image: program.media || program.image || DEFAULT_OG_IMAGE,
      url: `${SITE_URL}/programs/${program.id}`,
    });
    count++;
  }

  // CAIL posts
  for (const post of data.cailPosts || []) {
    writeStaticPage(template, `/cail/${post.id}`, {
      title: `${post.title} — CAIL · PII`,
      description:
        post.excerpt ||
        "Transforming cities into real-world testbeds for public-interest innovation.",
      image: post.media || post.image || DEFAULT_OG_IMAGE,
      url: `${SITE_URL}/cail/${post.id}`,
    });
    count++;
  }

  // Fixed top-level content pages. These never had per-post dynamism, but
  // they suffer the exact same problem: nothing exists at these paths as a
  // real file, so any bot/crawler hitting them directly gets the generic
  // 404.html shell instead of real content. Same fix, static copies with
  // the right <head> baked in.
  const staticPages = [
    {
      path: "research",
      title: "Research — The Public Innovation Institute",
      description:
        "Publications, working papers, and data-driven policy research from PII.",
    },
    {
      path: "publications",
      title: "Publications — The Public Innovation Institute",
      description:
        "Articles, white papers, policy briefs, and news from PII.",
    },
    {
      path: "programs",
      title: "Programs — The Public Innovation Institute",
      description:
        "Academic and professional programs at the intersection of AI, policy, and urban systems.",
    },
    {
      path: "cail",
      title: "City as Innovation Lab — The Public Innovation Institute",
      description:
        "Transforming cities into real-world testbeds for public-interest innovation.",
    },
    {
      path: "hyperion",
      title: "Hyperion — The Public Innovation Institute",
      description: "PII's flagship urban resilience initiative.",
    },
    {
      path: "conference",
      title: "Change.Enabled — The Public Innovation Institute",
      description:
        "The annual conference on public-interest innovation and invention.",
    },
    {
      path: "about",
      title: "About — The Public Innovation Institute",
      description:
        "PII is a Boston-based nonprofit working at the intersection of AI, public policy, and urban systems.",
    },
    {
      path: "team",
      title: "People — The Public Innovation Institute",
      description:
        "Meet the team behind PII's research, programs, and initiatives.",
    },
    {
      path: "opportunities",
      title: "Opportunities — The Public Innovation Institute",
      description:
        "Fellowships, volunteer positions, city partnerships, and company partnerships at PII.",
    },
    {
      path: "contact",
      title: "Contact — The Public Innovation Institute",
      description:
        "Working at the intersection of AI, public policy, and urban systems.",
    },
  ];

  for (const page of staticPages) {
    writeStaticPage(template, `/${page.path}`, {
      title: page.title,
      description: page.description,
      image: DEFAULT_OG_IMAGE,
      url: `${SITE_URL}/${page.path}`,
    });
    count++;
  }

  console.log(`Done. Generated ${count} static page(s).`);

  writeSitemap(data);
}

function writeSitemap(data) {
  const staticUrls = [
    { loc: "/", freq: "weekly", priority: "1.0" },
    { loc: "/research", freq: "weekly", priority: "0.9" },
    { loc: "/programs", freq: "monthly", priority: "0.8" },
    { loc: "/cail", freq: "weekly", priority: "0.9" },
    { loc: "/hyperion", freq: "monthly", priority: "0.7" },
    { loc: "/conference", freq: "monthly", priority: "0.7" },
    { loc: "/about", freq: "monthly", priority: "0.6" },
    { loc: "/contact", freq: "yearly", priority: "0.5" },
  ];

  const researchUrls = (data.research || []).flatMap((a) => [
    { loc: `/research/${a.id}`, freq: "monthly", priority: "0.8" },
    { loc: `/publications/${a.id}`, freq: "monthly", priority: "0.8" },
  ]);
  const programUrls = (data.programs || []).map((p) => ({
    loc: `/programs/${p.id}`,
    freq: "monthly",
    priority: "0.7",
  }));
  const cailUrls = (data.cailPosts || []).map((p) => ({
    loc: `/cail/${p.id}`,
    freq: "monthly",
    priority: "0.7",
  }));

  const all = [...staticUrls, ...researchUrls, ...programUrls, ...cailUrls];

  const body = all
    .map(
      (u) =>
        `  <url>\n    <loc>${SITE_URL}${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n${body}\n\n</urlset>\n`;

  fs.writeFileSync(path.join(REPO_ROOT, "sitemap.xml"), xml, "utf8");
  console.log(`  wrote sitemap.xml (${all.length} URLs)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
