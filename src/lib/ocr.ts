// In-browser OCR with tesseract.js: free, runs on the device, the image never
// goes to an AI service. The language data (~10 MB) downloads once and is cached.

export type Progress = (pct: number, label: string) => void;

/** Shrink huge phone screenshots before OCR / upload (keeps text legible). */
export async function prepareImage(file: File, maxSide = 2400): Promise<{ blob: Blob; ext: string }> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  // HEIC can't be decoded by most browsers' canvas; upload it as-is.
  if (/hei[cf]/i.test(file.type)) return { blob: file, ext: "heic" };
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, ext: extOf(file) };
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 4_000_000) return { blob: file, ext: extOf(file) };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not process image"))), "image/jpeg", 0.9),
  );
  return { blob, ext: "jpg" };
}

function extOf(f: File): string {
  const m = f.type.split("/")[1] || "png";
  return m === "jpeg" ? "jpg" : m;
}

export async function readText(image: Blob, onProgress?: Progress): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) =>
      onProgress?.(Math.round((m.progress ?? 0) * 100), m.status === "recognizing text" ? "Reading text" : "Getting ready"),
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text.replace(/[ \t]+\n/g, "\n").trim();
  } finally {
    await worker.terminate();
  }
}
