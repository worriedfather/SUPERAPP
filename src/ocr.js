import Tesseract from "tesseract.js";

/* Reads the odometer from a photograph. Digits only.
   For production, move this server-side and keep a confidence threshold. */
export async function readOdometer(blob) {
  const worker = await Tesseract.createWorker("eng");
  try {
    await worker.setParameters({ tessedit_char_whitelist: "0123456789" });
    const { data } = await worker.recognize(blob);
    const runs = (data.text.match(/\d{4,7}/g) || []).map(Number);
    if (!runs.length) return { state: "nodigits", text: data.text.trim().slice(0, 40) };
    return { state: "read", value: runs.sort((a, b) => b - a)[0], all: runs, conf: Math.round(data.confidence) };
  } finally { await worker.terminate(); }
}
