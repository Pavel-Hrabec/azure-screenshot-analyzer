import { chromium } from "playwright";
import { BlobServiceClient } from "@azure/storage-blob";

export default async function (context, req) {
  const bad = (status, msg) => ({
    status,
    headers: { "Content-Type": "application/json" },
    body: { ok: false, error: msg },
  });

  try {
    const url = (req.query?.url || req.body?.url || "").trim();
    if (!url) return bad(400, "Missing 'url'.");

    let target;
    try { target = new URL(url); } catch { return bad(400, "Invalid URL."); }
    if (target.protocol !== "https:") return bad(400, "Only https URLs are allowed.");

    // Take screenshot
    const browser = await chromium.launch({ args: ["--no-sandbox"], headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.goto(target.href, { waitUntil: "networkidle", timeout: 30000 });
    const png = await page.screenshot({ fullPage: true, type: "png" });
    await browser.close();

    // Upload
    const conn = process.env.BLOB_CONN || process.env.AzureWebJobsStorage;
    if (!conn) return bad(500, "Storage connection not configured.");
    const containerName = process.env.SCREENSHOT_CONTAINER || "screenshots";
    const fileNameSafeHost = target.hostname.replace(/[^a-z0-9.-]/gi, "-");
    const blobName = `${Date.now()}_${fileNameSafeHost}.png`;

    const svc = BlobServiceClient.fromConnectionString(conn);
    const container = svc.getContainerClient(containerName);

    // If you want public URLs (no SAS), use access: 'blob'
    await container.createIfNotExists({ access: "blob" }); // change to 'private' if you don’t want public
    const blob = container.getBlockBlobClient(blobName);
    await blob.uploadData(png, { blobHTTPHeaders: { blobContentType: "image/png" } });

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, blobUrl: blob.url },
    };
  } catch (err) {
    context.log.error(err);
    return { status: 500, headers: { "Content-Type": "application/json" }, body: { ok: false, error: err.message } };
  }
}
