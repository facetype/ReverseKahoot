// The sticker art lives in /public/elements/game/stickers. A player's sticker is
// derived from their id, so it needs no database column and stays the same on
// every screen. With more players than stickers some will share one.
export const StickerDrawing = [
    '/elements/game/stickers/drawing/Sticker-DrawingBird.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingBunny.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingButterfly.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingCastle.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingFlower.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingHeart.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingHorse.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingKing.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingQueen.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingRook.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingRose.svg',
    '/elements/game/stickers/drawing/Sticker-DrawingStar.svg',
];

export const StickerShape = [
    '/elements/game/stickers/shape/Sticker-ShapeCircle.svg',
    '/elements/game/stickers/shape/Sticker-ShapeSquare.svg',
];

export function shapeStickerFor(key: string): string {
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return StickerShape[hash % StickerShape.length];
}

export function drawingStickerFor(key: string): string {
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return StickerDrawing[hash % StickerDrawing.length];
}