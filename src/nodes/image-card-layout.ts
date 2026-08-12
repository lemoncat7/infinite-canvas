export const IMAGE_CARD_LAYOUT = {
  padding: 18,
  iconSize: 46,
  iconRadius: 12,
  iconOffsetY: -48,
  titleOffsetY: -8,
  descriptionOffsetY: 17,
  actionsOffsetY: 48,
  actionHeight: 30,
  actionGap: 8,
  uploadWidth: 64,
  libraryWidth: 72,
} as const;

export function imageEmptyLayout(width: number, height: number) {
  const centerX = width / 2;
  const centerY = height / 2 - 5;
  const actionsWidth =
    IMAGE_CARD_LAYOUT.uploadWidth +
    IMAGE_CARD_LAYOUT.actionGap +
    IMAGE_CARD_LAYOUT.libraryWidth;
  return {
    centerX,
    centerY,
    iconX: centerX,
    iconY: centerY + IMAGE_CARD_LAYOUT.iconOffsetY,
    titleY: centerY + IMAGE_CARD_LAYOUT.titleOffsetY,
    descriptionY: centerY + IMAGE_CARD_LAYOUT.descriptionOffsetY,
    actionsX: centerX - actionsWidth / 2,
    actionsY: centerY + IMAGE_CARD_LAYOUT.actionsOffsetY,
  };
}
