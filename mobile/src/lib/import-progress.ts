export type ImportStage = "selecting" | "validating" | "selected" | "uploading" | "uploaded" | "reading" | "analysing" | "finishing" | "review" | "saving" | "completed" | "failed";

/** Only transfer callbacks can supply a percentage. Processing has no numeric progress. */
export function importProgress(stage: ImportStage, subject: string, fraction?: number) {
  const labels: Record<ImportStage, [string, string]> = {
    selecting: ["Choosing your file", "Choose a photo, PDF or text document."],
    validating: ["Checking your file", "Checking the file type, size and local copy."],
    selected: ["File ready", "Your file is selected. Start reading when you are ready."],
    uploading: ["Uploading your file", "Keep this screen open while the file transfers securely."],
    uploaded: ["Upload complete", "Your file is saved. Preparing it for reading."],
    reading: ["Reading your " + subject, "Extracting readable information from the PDF, image or text."],
    analysing: ["AI analysing your " + subject, "Checking the information. You will review the result before saving."],
    finishing: ["Preparing your result", "The analysis has finished. Checking and saving the result for review."],
    review: ["Ready for review", "Check the extracted information and make any changes before saving."],
    saving: ["Saving your changes", "Waiting for the server to confirm your reviewed information."],
    completed: ["Saved successfully", "The server has confirmed your changes."],
    failed: ["This step could not finish", "Your file and draft are kept. Retry the failed step when ready."],
  };
  const percent = stage === "uploading" && typeof fraction === "number" && Number.isFinite(fraction)
    ? Math.round(Math.max(0, Math.min(1, fraction)) * 100) : null;
  return { title: labels[stage][0], detail: labels[stage][1], percent,
    busy: !["selected", "review", "completed", "failed"].includes(stage) };
}
