// In-browser OCR with tesseract.js: free, runs on the device, the image never
// goes to an AI service. The language data (~10 MB) downloads once and is cached.

export type Progress = (pct: number, label: string) => void;

export const MAX_UPLOAD = 10 * 1024 * 1024; // bucket limit

/**
 * The original file is what gets stored. A smaller copy is made only when OCR
 * needs it (very large images) or when the original is over the 10 MB bucket limit.
 * Tall screenshots are scaled by width, so text stays readable.
 */
export async function prepareImage(file: File): Promise<{ original: Blob; ext: string; forOcr: Blob }> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't an image.");
  const ext = /hei[cf]/i.test(file.type) ? "heic" : extOf(file);
  const small = await shrink(file, 2400).catch(() => null);
  if (file.size > MAX_UPLOAD) {
    if (!small) throw new Error("That image is over 10 MB and couldn't be shrunk. Try a screenshot instead.");
    return { original: small, ext: "jpg", forOcr: small };
  }
  return { original: file, ext, forOcr: small ?? file };
}

async function shrink(file: File, maxWidth: number): Promise<Blob | null> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return null;
  const scale = Math.min(1, maxWidth / bmp.width, 12000 / bmp.height);
  if (scale === 1 && file.size <= MAX_UPLOAD) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.9));
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
