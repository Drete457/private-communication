import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { launch } from "chrome-launcher";
import { createServer } from "node:http";
import { readFile, stat, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const websiteRoot = resolve(repoRoot, "website");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const audits = [
  { name: "mobile" },
  { name: "desktop", config: desktopConfig },
];

const categoryThresholds = {
  accessibility: 1,
  seo: 0.9,
};

const removeTemporaryDirectory = async (directoryPath) => {
  try {
    await rm(directoryPath, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 200,
    });
  } catch (error) {
    if (error?.code !== "EBUSY" && error?.code !== "EPERM") {
      throw error;
    }
  }
};

const closeServer = (server) =>
  new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });

const getContentType = (filePath) =>
  MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";

const resolveWebsitePath = async (pathname) => {
  let requestPath = decodeURIComponent(pathname);

  if (requestPath === "/") requestPath = "/index.html";
  if (requestPath.endsWith("/")) requestPath = `${requestPath}index.html`;

  const filePath = resolve(websiteRoot, `.${requestPath}`);
  const relativePath = relative(websiteRoot, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;

  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile() ? filePath : null;
  } catch {
    return null;
  }
};

const startStaticServer = () =>
  new Promise((resolveStart, rejectStart) => {
    const server = createServer((request, response) => {
      void (async () => {
        if (!request.url) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end("Bad request");
          return;
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
          response.end("Method not allowed");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        const filePath = await resolveWebsitePath(requestUrl.pathname);

        if (!filePath) {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const content = await readFile(filePath);

        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": getContentType(filePath),
        });

        if (request.method === "HEAD") {
          response.end();
          return;
        }

        response.end(content);
      })().catch((error) => {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end(`Server error: ${error.message}`);
      });
    });

    server.on("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        rejectStart(new Error("Could not resolve local website audit address."));
        return;
      }

      resolveStart({
        origin: `http://127.0.0.1:${address.port}`,
        server,
      });
    });
  });

const runAudit = async (origin, audit, reportDirectory) => {
  const profileDirectory = await mkdtemp(join(reportDirectory, `chrome-${audit.name}-`));
  const chrome = await launch({
    chromeFlags: ["--headless=new"],
    logLevel: "silent",
    userDataDir: profileDirectory,
  });

  try {
    const runnerResult = await lighthouse(
      `${origin}/index.html`,
      {
        logLevel: "error",
        onlyCategories: Object.keys(categoryThresholds),
        output: "json",
        port: chrome.port,
      },
      audit.config,
    );

    if (!runnerResult) {
      throw new Error(`No Lighthouse result returned for ${audit.name}.`);
    }

    return {
      name: audit.name,
      scores: Object.fromEntries(
        Object.keys(categoryThresholds).map((category) => [
          category,
          runnerResult.lhr.categories[category]?.score ?? 0,
        ]),
      ),
    };
  } finally {
    await Promise.resolve(chrome.kill());
    await removeTemporaryDirectory(profileDirectory);
  }
};

const formatScore = (score) => `${Math.round(score * 100)}`;

const main = async () => {
  const { origin, server } = await startStaticServer();
  const reportDirectory = await mkdtemp(join(tmpdir(), "pc-website-audit-"));

  try {
    const results = [];

    for (const audit of audits) {
      results.push(await runAudit(origin, audit, reportDirectory));
    }

    console.log("Website quality audit:");

    for (const result of results) {
      const categorySummary = Object.entries(result.scores)
        .map(([category, score]) => `${category} ${formatScore(score)}`)
        .join(", ");

      console.log(`- ${result.name}: ${categorySummary}`);
    }

    const failedAudit = results
      .flatMap((result) =>
        Object.entries(categoryThresholds).map(([category, threshold]) => ({
          category,
          name: result.name,
          score: result.scores[category],
          threshold,
        })),
      )
      .find((result) => result.score < result.threshold);

    if (failedAudit) {
      throw new Error(
        `${failedAudit.category} score below threshold on ${failedAudit.name}. Expected ${formatScore(failedAudit.threshold)}, got ${formatScore(failedAudit.score)}.`,
      );
    }
  } finally {
    await Promise.allSettled([closeServer(server), removeTemporaryDirectory(reportDirectory)]);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});