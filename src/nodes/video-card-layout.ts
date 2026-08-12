export const VIDEO_CARD_LAYOUT = {
  horizontalPadding: 18,
  frameTop: 62,
  frameHeight: 72,
  frameGap: 5,
  frameRadius: 10,
  summaryOffset: 85,
  footerHeight: 48,
} as const;

export function videoFrameLayout(
  cardWidth: number,
  requestedCount: number,
) {
  const { horizontalPadding, frameGap } = VIDEO_CARD_LAYOUT;
  // Keep one visual placeholder when no reference is connected. Once assets
  // exist, the slot count remains exactly equal to the real reference count.
  const frameCount = Math.max(1, requestedCount);
  const contentWidth = Math.max(1, cardWidth - horizontalPadding * 2);
  const frameWidth = Math.max(
    1,
    (contentWidth - frameGap * (frameCount - 1)) / frameCount,
  );
  return {
    frameCount,
    frameWidth,
    frameX: (index: number) =>
      horizontalPadding + index * (frameWidth + frameGap),
    contentRight: horizontalPadding + contentWidth,
  };
}
