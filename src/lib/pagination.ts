/**
 * The page numbers a pager shows: the first and last always, the current page
 * with one neighbour either side, and an ellipsis standing in for each run in
 * between. The control keeps the same width whether there are three pages or
 * three hundred.
 *
 * Which list is being paged is none of this function's business -- it answers
 * "given where you are and how far there is to go, which page numbers get
 * drawn", and the caller decides what to do with them. That is the whole
 * reason it lives here rather than inline in each list, where four copies of it
 * would drift apart.
 */
export function pageWindow(
  current: number,
  total: number,
): Array<number | "gap"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const wanted = [1, total, current, current - 1, current + 1];
  const pages = [...new Set(wanted)]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);

  const out: Array<number | "gap"> = [];

  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1] > 1) {
      out.push("gap");
    }

    out.push(page);
  });

  return out;
}
