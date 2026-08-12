export const VIDEO_CARD_LAYOUT = {
  horizontalPadding: 18,
  frameTop: 62,
  frameHeight: 72,
  frameGap: 5,
  placeholderCount: 3,
  frameRadius: 10,
  summaryOffset: 85,
  footerHeight: 48,
} as const;

export function videoFrameLayout(
  cardWidth: number,
  requestedCount: number = VIDEO_CARD_LAYOUT.placeholderCount,
) {
  const { horizontalPadding, frameGap } = VIDEO_CARD_LAYOUT;
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
