// The sticker art lives in /public/elements/game/stickers. A player's sticker is
// derived from their id, so it needs no database column and stays the same on
// every screen. With more players than stickers some will share one.
export const STICKERS = [
    '/elements/game/stickers/sticker-bird.svg',
    '/elements/game/stickers/sticker-horse.svg',
    '/elements/game/stickers/sticker-rose.svg',
];

export function stickerFor(key: string): string {
    let hash = 0;
    for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return STICKERS[hash % STICKERS.length];
}