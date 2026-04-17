import type { MindooDBAppAttachmentPreviewMode } from "./types";

/**
 * Resolves whether Haven can render a built-in preview for an attachment.
 *
 * Apps can use this as a fast local check before calling
 * `attachments.openPreview()`.
 */
export function canPreviewAttachment(
  fileName: string,
  mimeType: string,
): MindooDBAppAttachmentPreviewMode | null {
  const normalizedMimeType = mimeType.toLowerCase();
  const normalizedFileName = fileName.toLowerCase();
  if (
    normalizedMimeType === "text/markdown"
    || normalizedMimeType === "text/x-markdown"
    || normalizedMimeType === "application/markdown"
    || normalizedMimeType === "application/x-markdown"
    || normalizedFileName.endsWith(".md")
    || normalizedFileName.endsWith(".markdown")
    || normalizedFileName.endsWith(".mdown")
    || normalizedFileName.endsWith(".mkd")
    || normalizedFileName.endsWith(".mkdn")
  ) {
    return "markdown";
  }
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }
  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }
  if (normalizedMimeType.startsWith("audio/")) {
    return "audio";
  }
  if (
    normalizedFileName.endsWith(".mp4")
    || normalizedFileName.endsWith(".m4v")
    || normalizedFileName.endsWith(".webm")
    || normalizedFileName.endsWith(".ogv")
    || normalizedFileName.endsWith(".ogg")
  ) {
    return "video";
  }
  if (
    normalizedFileName.endsWith(".m4a")
    || normalizedFileName.endsWith(".mp3")
    || normalizedFileName.endsWith(".wav")
    || normalizedFileName.endsWith(".aac")
    || normalizedFileName.endsWith(".oga")
  ) {
    return "audio";
  }
  if (normalizedMimeType === "application/pdf" || normalizedFileName.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    normalizedMimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || normalizedMimeType === "application/vnd.ms-excel"
    || normalizedMimeType === "application/vnd.ms-excel.sheet.macroenabled.12"
    || normalizedMimeType === "application/vnd.ms-excel.sheet.binary.macroenabled.12"
    || normalizedFileName.endsWith(".xlsx")
    || normalizedFileName.endsWith(".xls")
    || normalizedFileName.endsWith(".xlsm")
    || normalizedFileName.endsWith(".xlsb")
  ) {
    return "spreadsheet";
  }
  if (
    normalizedMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || normalizedFileName.endsWith(".docx")
  ) {
    return "docx";
  }
  if (
    normalizedMimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    || normalizedFileName.endsWith(".pptx")
  ) {
    return "pptx";
  }
  if (
    normalizedMimeType.startsWith("text/")
    || normalizedMimeType === "application/json"
    || normalizedMimeType === "application/xml"
    || normalizedMimeType === "image/svg+xml"
    || normalizedFileName.endsWith(".json")
    || normalizedFileName.endsWith(".txt")
    || normalizedFileName.endsWith(".csv")
    || normalizedFileName.endsWith(".log")
    || normalizedFileName.endsWith(".xml")
    || normalizedFileName.endsWith(".yaml")
    || normalizedFileName.endsWith(".yml")
    || normalizedFileName.endsWith(".svg")
  ) {
    return "text";
  }
  return null;
}
