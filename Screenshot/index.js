import { chromium } from "playwright";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions
} from "@azure/storage-blob";

// App settings v Function App:
// AzureWebJobsStorage  (automaticky nastaveno Function Appem)
// SCREENSHOT_CONTAINER (např. "screenshots")
// SAS_EXP_MINUTES      (volitelné, default 15)

export default async function (context, req) {
  try {
    const url = req.query.url || (req.body && req.body.url);
    if (!url) return { status: 400, body: "Missing ?url or body.url" };

    // 1) Screenshot
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const buffer = await page.screenshot({ fullPage: true, type: "png" });
    await browser.close();

    // 2) Upload to Blob
    const conn = process.env.AzureWebJobsStorage;
    const containerName = process.env.SCREENSHOT_CONTAINER || "screenshots";
    const bsc = BlobServiceClient.fromConnectionString(conn);
    const container = bsc.getContainerClient(containerName);
    await container.createIfNotExists();

    const blobName = `shot_${Date.now()}.png`;
    const blobClient = container.getBlockBlobClient(blobName);
    await blobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: "image/png" } });

    // 3) SAS (krátká platnost)
    const { accountName, accountKey } = BlobServiceClient.parseConnectionString(conn);
    const sharedKey = new StorageSharedKeyCredential(accountName, accountKey);
    const expiresOn = new Date(Date.now() + 1000 * 60 * (parseInt(process.env.SAS_EXP_MINUTES || "15", 10)));
    const sas = generateBlobSASQueryParameters(
      { containerName, blobName, permissions: BlobSASPermissions.parse("r"), startsOn: new Date(Date.now() - 60 * 1000), expiresOn },
      sharedKey
    ).toString();

    return {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, blobUrl: blobClient.url, sasUrl: `${blobClient.url}?${sas}`, expiresOn: expiresOn.toISOString() }
    };
  } catch (err) {
    context.log.error(err);
    return { status: 500, body: `Error: ${err.message}` };
  }
}