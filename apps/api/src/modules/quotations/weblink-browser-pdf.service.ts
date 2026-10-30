import { chromium, type Browser } from 'playwright';

/**
 * Weblink PDF browser pipeline (third PDF style).
 *
 * Instead of reconstructing the quotation in PDFKit, this renders the ACTUAL
 * public quotation React view (`PublicQuotationView` in `?pdf=weblink` static
 * PDF mode) in headless Chromium and prints it to A4 portrait. Data, section
 * order, pricing, images, policies and links therefore come from the real
 * mobile weblink — the PDF differs only in pagination, print styling and the
 * discreet page-number footer.
 *
 * Concurrency is serialized through a module queue (one render at a time) so
 * simultaneous generations cannot exhaust memory. The browser singleton is
 * created lazily; every page/context is closed in a finally block.
 */

export interface WeblinkBrowserPdfOptions {
  /** Fully qualified `?pdf=weblink` public quotation URL to render. */
  url: string;
  /** Per-stage timeout in milliseconds (navigation + readiness). */
  timeoutMs?: number;
}

/**
 * Emulated iQOO Neo 9 Pro Android profile for Weblink PDF rendering.
 *
 * The phone's native panel is 1260 × 2800 physical pixels (20:9, 6.78 in);
 * the CSS viewport below approximates it at a 3x device scale (420 × 933 CSS
 * px × 3 ≈ 1260 × 2800). These are EMULATED values, not a physical-device
 * capture: no reliable real-device CSS-viewport/DPR measurement was
 * available, so the approximation from the reference mobile-PDF tooling is
 * used. The profile controls responsive layout only — the PDF paper format
 * stays A4 portrait regardless.
 *
 * Single source of truth: every render builds its browser context from this
 * object, never from scattered literals.
 */
export const IQOO_NEO_9_PRO_PROFILE = {
  viewport: { width: 420, height: 933 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
} as const;

const DEFAULT_TIMEOUT_MS = 60_000;
const OVERALL_TIMEOUT_MS = 240_000;

/**
 * Page-number footer for Weblink PDFs (Chromium header/footer template).
 *
 * Weblink-only: Classic PDFKit and Stylish PDFs have their own footers and
 * are untouched. Right-aligned near the bottom-right corner with the same
 * discreet system-ui grey style; shows only the current page number
 * (no total-page count). The size follows the Weblink PDF 25% typography
 * scale (9px -> 11.25px). The 32px right padding mirrors the content margin
 * so the number aligns with the quotation body and never touches the paper
 * edge. Chromium fills `.pageNumber` per page starting at 1.
 */
export const WEBLINK_PDF_FOOTER_TEMPLATE =
  '<div style="font-size:11.25px;color:#6b7280;width:100%;text-align:right;' +
  'font-family:system-ui,sans-serif;padding-right:32px;box-sizing:border-box;">' +
  '<span class="pageNumber"></span></div>';

let browserPromise: Promise<Browser> | null = null;
/** Serializes renders so concurrent generations queue instead of overlapping. */
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Public tokens ride in page URLs (`/q/<token>`), and browser errors echo the
 * failing URL — so raw automation errors must never reach logs or clients.
 * Keeps only the first line with any token-looking path segment redacted.
 */
export function sanitizeWeblinkPdfError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0] ?? '';
  return firstLine
    .replace(/\/q\/[A-Za-z0-9_-]{16,}/g, '/q/[redacted]')
    .slice(0, 500);
}

/** Runs one render stage, tagging failures so logs say WHERE it broke. */
async function renderStage<T>(
  stage: 'launch' | 'navigate' | 'ready' | 'print',
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`Weblink PDF failed at stage=${stage}: ${sanitizeWeblinkPdfError(error)}`);
  }
}

/** Public quotation PDF-mode URL for a token on the given web base URL. */
export function buildWeblinkPdfUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}/q/${encodeURIComponent(token)}?pdf=weblink`;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((error: unknown) => {
      browserPromise = null;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Weblink PDF browser could not start (${detail}). ` +
          `Install a compatible Chromium with: npx playwright install chromium`,
      );
    });
  }
  return browserPromise;
}

/** Close the shared browser (used by tests and graceful shutdown). */
export async function closeWeblinkPdfBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (pending) {
    const browser = await pending.catch(() => null);
    await browser?.close().catch(() => undefined);
  }
}

/**
 * Open a fresh browser context + page using the emulated device profile.
 * Exported so tests can verify the EFFECTIVE profile (viewport, DPR, mobile
 * and touch behavior) instead of trusting configuration literals.
 */
export async function createWeblinkPdfContext(browser: Browser) {
  const context = await browser.newContext({
    viewport: { ...IQOO_NEO_9_PRO_PROFILE.viewport },
    deviceScaleFactor: IQOO_NEO_9_PRO_PROFILE.deviceScaleFactor,
    isMobile: IQOO_NEO_9_PRO_PROFILE.isMobile,
    hasTouch: IQOO_NEO_9_PRO_PROFILE.hasTouch,
    userAgent: IQOO_NEO_9_PRO_PROFILE.userAgent,
  });
  const page = await context.newPage();
  return { context, page };
}

async function renderOnce({ url, timeoutMs = DEFAULT_TIMEOUT_MS }: WeblinkBrowserPdfOptions) {
  const browser = await renderStage('launch', getBrowser);
  const { context, page } = await createWeblinkPdfContext(browser);
  try {
    await renderStage('navigate', () =>
      page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs }),
    );
    // The PDF-mode view renders only after its public data loads; anything
    // else (error card, boot shell) means this token cannot produce a PDF.
    await renderStage('ready', () =>
      page.waitForSelector('main[data-pdf-mode="weblink"]', { timeout: timeoutMs }),
    );
    // Drive lazy-loaded images into view, then settle back at the top. Passed
    // as source strings (not closures): bundlers/transforms must never inject
    // helpers into code evaluated inside the page.
    await page.evaluate(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let previousHeight = 0;
      let stablePasses = 0;
      for (let i = 0; i < 120; i += 1) {
        const height = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        );
        window.scrollTo(0, Math.min(window.scrollY + window.innerHeight * 0.8, height));
        await sleep(300);
        const next = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const atBottom = window.scrollY + window.innerHeight >= next - 5;
        if (atBottom && next === previousHeight) stablePasses += 1;
        else stablePasses = 0;
        previousHeight = next;
        if (stablePasses >= 4) break;
      }
      window.scrollTo(0, 0);
      await sleep(800);
    })()`);
    // Fonts, decoded images and a stable layout before capture.
    await page.evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
      );
    })()`);
    await page.waitForTimeout(500);
    return await renderStage('print', () =>
      page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        // No website header in the PDF (avoids duplicating the quotation hero);
        // the discreet page-number footer is the only browser chrome.
        headerTemplate: '<div></div>',
        footerTemplate: WEBLINK_PDF_FOOTER_TEMPLATE,
        margin: { top: '36px', bottom: '72px', left: '32px', right: '32px' },
        preferCSSPageSize: false,
      }),
    );
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

/**
 * Render a public quotation PDF-mode URL to A4 portrait PDF bytes.
 * Renders serialize behind a queue; the whole operation is bounded by an
 * overall timeout and never leaves a page or context open.
 */
export async function renderWeblinkPdfFromUrl(options: WeblinkBrowserPdfOptions): Promise<Buffer> {
  const task = renderQueue.then(() =>
    Promise.race([
      renderOnce(options),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Weblink PDF generation timed out.')),
          OVERALL_TIMEOUT_MS,
        ),
      ),
    ]),
  );
  // A rejection must not wedge the queue for subsequent generations.
  renderQueue = task.catch(() => undefined);
  const pdf = await task;
  return Buffer.from(pdf);
}
