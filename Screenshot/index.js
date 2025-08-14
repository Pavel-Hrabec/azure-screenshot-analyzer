import { chromium } from "playwright";
import { BlobServiceClient } from "@azure/storage-blob";

export default async function (context, req) {
  const bad = (status, msg) => {
    context.res = {
      status,
      headers: { "Content-Type": "application/json" },
      body: { ok: false, error: msg },
    };
    return;
  };

  try {
    // 1) Read & validate input
    const url = (req.query?.url || req.body?.url || "").trim();
    if (!url) return bad(400, "Missing 'url'.");
    let target;
    try { target = new URL(url); } catch { return bad(400, "Invalid URL."); }
    if (target.protocol !== "https:") return bad(400, "Only https URLs are allowed.");

    // 2) Screenshot with Playwright
    const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const ctxBw = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctxBw.newPage();
    await page.goto(target.href, { waitUntil: "networkidle", timeout: 30000 });
    const png = await page.screenshot({ fullPage: true, type: "png" });
    await browser.close();

    // 3) Upload to Blob Storage
    const conn = process.env.BLOB_CONN || process.env.AzureWebJobsStorage;
    if (!conn) return bad(500, "Storage connection not configured (BLOB_CONN/AzureWebJobsStorage).");

    const containerName = process.env.SCREENSHOT_CONTAINER || "screenshots";
    const safeHost = target.hostname.replace(/[^a-z0-9.-]/gi, "-");
    const blobName = `${Date.now()}_${safeHost}.png`;

    const svc = BlobServiceClient.fromConnectionString(conn);
    const container = svc.getContainerClient(containerName);
    await container.createIfNotExists(); // set container access level in Portal as needed (Blob/Private)

    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(png, { blobHTTPHeaders: { blobContentType: "image/png" } });

    // 4) Respond with the URL (no SAS)
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        ok: true,
        blobUrl: blob.url,        // e.g., https://<acct>.blob.core.windows.net/<container>/<blobName>
        container: containerName, // handy if Logic App wants to use connectors
        blobName: blobName
      },
    };
  } catch (err) {
    context.log.error(err);
    context.res = {
      status: 500,
      headers: { "Content-Type": "application/json" },
      body: { ok: false, error: err.message },
    };
  }
}
