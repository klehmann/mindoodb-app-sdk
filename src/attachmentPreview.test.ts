import { describe, expect, it } from "vitest";

import { canPreviewAttachment } from "./attachmentPreview";

describe("canPreviewAttachment", () => {
  it("detects pptx files by mime type and extension", () => {
    expect(
      canPreviewAttachment(
        "slides.bin",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("pptx");
    expect(
      canPreviewAttachment(
        "slides.pptx",
        "application/octet-stream",
      ),
    ).toBe("pptx");
  });
});
