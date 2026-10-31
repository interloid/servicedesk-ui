import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

import { REPORT_RANGES, type ReportsData } from "../types/types";

/**
 * The Reports page as a PDF: the report body is captured as an image, as it
 * looks on screen, and laid onto A4 pages under a short text header.
 *
 * While it runs, body.exporting is set so the page can show everything the
 * capture needs (globals.css): the agent table's scroll box is opened up
 * (data-pdf-expand), and controls that mean nothing on paper are left out of
 * the capture (data-pdf-hide). Pages break between the report's cards
 * (data-pdf-block) wherever one fits, so a chart or a table row isn't cut in
 * half; a card taller than a page is the only thing ever split.
 */

const PAGE_MARGIN_MM = 12;
const HEADER_HEIGHT_MM = 18;
/** Capture resolution: sharp on paper without a huge file. */
const PIXEL_RATIO = 2;
/**
 * The width the report is laid out at while it is captured. On a wide monitor
 * the page is 2000px+ across, which shrinks every label to unreadable on A4;
 * this is a laptop's width, so text prints at about the size it reads on
 * screen, whatever monitor the export was made on.
 */
const CAPTURE_WIDTH_PX = 1100;
/** Long enough for the charts' grow-in animation to finish. */
const CHART_SETTLE_MS = 1600;
/** Room around the cards, so their borders and shadows aren't clipped. */
const CAPTURE_PADDING_PX = 6;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }),
    ),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Where pages may break, in CSS pixels from the top of `root`: the bottom of
 * any card, provided no other card spans that line (on a wide screen the
 * charts sit beside the agent table, so a chart's bottom can fall mid-table).
 */
function safeBreaks(root: HTMLElement): number[] {
  const top = root.getBoundingClientRect().top;
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("[data-pdf-block]"),
  ).map((el) => {
    const rect = el.getBoundingClientRect();
    return { top: rect.top - top, bottom: rect.bottom - top };
  });

  return [...new Set(blocks.map((b) => Math.ceil(b.bottom)))]
    .filter((y) => !blocks.some((b) => b.top < y - 1 && b.bottom > y + 1))
    .sort((a, b) => a - b);
}

/** Page slices [start, end) in CSS pixels, each at most `pageHeight` tall. */
function pageSlices(
  total: number,
  pageHeight: number,
  breaks: number[],
): [number, number][] {
  const slices: [number, number][] = [];
  let start = 0;

  while (start < total - 1) {
    const limit = start + pageHeight;
    if (limit >= total) {
      slices.push([start, total]);
      break;
    }
    // The lowest safe break that still fits; a card taller than a page is
    // cut at the page edge.
    const end =
      [...breaks].reverse().find((y) => y > start + 1 && y <= limit) ?? limit;
    slices.push([start, end]);
    start = end;
  }

  return slices;
}

function periodLabel(data: ReportsData): string {
  const label = REPORT_RANGES[data.range].label;
  const first = data.trend[0]?.title;
  const last = data.trend.at(-1)?.title;
  return first && last ? `${label} (${first} – ${last})` : label;
}

function fileName(data: ReportsData, at: Date): string {
  const range = REPORT_RANGES[data.range].label
    .toLowerCase()
    .replace(/\s+/g, "-");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `reports_${range}_${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.pdf`;
}

function drawHeader(pdf: jsPDF, data: ReportsData, at: Date, page: number) {
  const width = pdf.internal.pageSize.getWidth();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const exported = `${at.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  })} (${timeZone})`;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("Support report", PAGE_MARGIN_MM, PAGE_MARGIN_MM + 4);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(100, 116, 139);
  pdf.text(periodLabel(data), PAGE_MARGIN_MM, PAGE_MARGIN_MM + 10);
  pdf.text(`Exported ${exported}`, width - PAGE_MARGIN_MM, PAGE_MARGIN_MM + 4, {
    align: "right",
  });
  pdf.text(`Page ${page}`, width - PAGE_MARGIN_MM, PAGE_MARGIN_MM + 10, {
    align: "right",
  });
}

/** Captures `element` (the report body) and saves it as a PDF. */
export async function exportReportsPdf(
  element: HTMLElement,
  data: ReportsData,
): Promise<void> {
  const exportedAt = new Date();
  const previous = {
    width: element.style.width,
    maxWidth: element.style.maxWidth,
    padding: element.style.padding,
  };
  document.body.classList.add("exporting");
  element.style.width = `${CAPTURE_WIDTH_PX}px`;
  element.style.maxWidth = "none";
  element.style.padding = `${CAPTURE_PADDING_PX}px`;

  try {
    // Fonts, images and the layout change from body.exporting all settle
    // before the capture.
    await document.fonts.ready;
    await waitForImages(element);
    // The charts redraw at the capture width and animate their bars in
    // (Recharts' default is 1.5s); captured sooner, the bars come out short
    // or missing.
    await wait(CHART_SETTLE_MS);

    const cssWidth = element.offsetWidth;
    const cssHeight = element.scrollHeight;
    const breaks = safeBreaks(element);
    const background =
      getComputedStyle(document.body).backgroundColor || "#ffffff";

    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: PIXEL_RATIO,
      backgroundColor: background,
      width: cssWidth,
      height: cssHeight,
      filter: (node) =>
        !(node instanceof HTMLElement && node.dataset.pdfHide !== undefined),
    });
    const image = await loadImage(dataUrl);

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PAGE_MARGIN_MM * 2;
    const contentHeight = pageHeight - PAGE_MARGIN_MM * 2 - HEADER_HEIGHT_MM;
    const mmPerCssPx = contentWidth / cssWidth;
    const scale = image.width / cssWidth;

    const slices = pageSlices(cssHeight, contentHeight / mmPerCssPx, breaks);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't prepare the PDF page.");

    slices.forEach(([start, end], index) => {
      if (index > 0) pdf.addPage();
      drawHeader(pdf, data, exportedAt, index + 1);

      // One page's band of the capture, drawn on its own canvas.
      const sourceY = Math.round(start * scale);
      const sourceHeight = Math.max(1, Math.round((end - start) * scale));
      canvas.width = image.width;
      canvas.height = sourceHeight;
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(
        image,
        0,
        sourceY,
        image.width,
        sourceHeight,
        0,
        0,
        image.width,
        sourceHeight,
      );

      pdf.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        PAGE_MARGIN_MM,
        PAGE_MARGIN_MM + HEADER_HEIGHT_MM,
        contentWidth,
        (end - start) * mmPerCssPx,
        undefined,
        "FAST",
      );
    });

    pdf.save(fileName(data, exportedAt));
  } finally {
    element.style.width = previous.width;
    element.style.maxWidth = previous.maxWidth;
    element.style.padding = previous.padding;
    document.body.classList.remove("exporting");
  }
}
