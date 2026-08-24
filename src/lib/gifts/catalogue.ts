/**
 * Virtual gifts.
 *
 * A gift is a small, fixed gesture — not a message with decoration. There is
 * deliberately **no free-text note** attached to one: text sent to another
 * member goes through Scam Shield, and a note riding along with a gift would
 * be a text channel that quietly skips it. Anyone who wants to say something
 * can send a message, which is assessed like every other message.
 *
 * The catalogue is a closed set rather than arbitrary emoji for the same
 * reason a taxonomy is: an open field is an open channel. These twelve are
 * chosen to be warm and unambiguous across the cultures FioreMatch spans —
 * nothing with a gesture meaning that flips between regions, and nothing that
 * reads as a proposition.
 */

export type GiftId =
  | "rose"
  | "coffee"
  | "tea"
  | "cake"
  | "chocolate"
  | "sunflower"
  | "star"
  | "balloon"
  | "music"
  | "book"
  | "ticket"
  | "heart";

export type Gift = {
  id: GiftId;
  /** Rendered directly; the catalogue is the whole vocabulary. */
  emoji: string;
};

export const GIFTS: Gift[] = [
  { id: "rose", emoji: "🌹" },
  { id: "sunflower", emoji: "🌻" },
  { id: "coffee", emoji: "☕" },
  { id: "tea", emoji: "🍵" },
  { id: "cake", emoji: "🍰" },
  { id: "chocolate", emoji: "🍫" },
  { id: "star", emoji: "⭐" },
  { id: "balloon", emoji: "🎈" },
  { id: "music", emoji: "🎵" },
  { id: "book", emoji: "📖" },
  { id: "ticket", emoji: "🎫" },
  { id: "heart", emoji: "💛" }
];

export const giftIds: GiftId[] = GIFTS.map((gift) => gift.id);

export function isGiftId(value: string): value is GiftId {
  return (giftIds as string[]).includes(value);
}

export function giftById(id: GiftId): Gift {
  const gift = GIFTS.find((candidate) => candidate.id === id);
  // The id type makes this unreachable; the throw is so a bad cast fails loudly
  // rather than rendering an empty square in someone's conversation.
  if (!gift) throw new Error(`Unknown gift: ${id}`);
  return gift;
}
