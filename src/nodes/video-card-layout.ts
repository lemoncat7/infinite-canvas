export const VIDEO_CARD_LAYOUT = {
  horizontalPadding: 14,
  frameTop: 65,
  frameHeight: 72,
  frameGap: 8,
  frameCount: 3,
  frameRadius: 10,
  summaryOffset: 85,
  footerHeight: 48,
} as const;

export function videoFrameLayout(cardWidth: number) {
  const { horizontalPadding, frameGap, frameCount } = VIDEO_CARD_LAYOUT;
  const contentWidth = Math.max(1, cardWidth - horizontalPadding * 2);
  const frameWidth = Math.max(
    1,
    (contentWidth - frameGap * (frameCount - 1)) / frameCount,
  );
  return {
    frameWidth,
    frameX: (index: number) =>
      horizontalPadding + index * (frameWidth + frameGap),
    contentRight: horizontalPadding + contentWidth,
  };
}
