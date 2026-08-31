'use client';

/** Keep the object URL only long enough for the browser to start the download. */
export async function downloadBlob(
  blob: Blob,
  filename: string,
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}
