/**
 * What goes where in the Steam and Epic Coming Soon kit (`pack-pc-kit.mjs`). Data only, so
 * `copy.test.ts` can hold every heading it names against `docs/PC_LISTINGS.md` without packing.
 */

/** Kit path → file under that store's listing folder. Folder numbers are the portal's order. */
export const FILES = {
  steam: {
    '2-graphical-assets/header_capsule.png': 'store/header_capsule.png',
    '2-graphical-assets/small_capsule.png': 'store/small_capsule.png',
    '2-graphical-assets/main_capsule.png': 'store/main_capsule.png',
    '2-graphical-assets/vertical_capsule.png': 'store/vertical_capsule.png',
    '3-screenshots/01-kangaroo-chase.png': 'screenshots/01-kangaroo-chase.png',
    '3-screenshots/02-the-hunt.png': 'screenshots/02-the-hunt.png',
    '3-screenshots/03-roo-ball.png': 'screenshots/03-roo-ball.png',
    '3-screenshots/04-king-of-the-hill.png': 'screenshots/04-king-of-the-hill.png',
    '3-screenshots/05-conversion-duel.png': 'screenshots/05-conversion-duel.png',
    '4-trailer/kangaroo-chase-trailer.mp4': 'trailer/kangaroo-chase-trailer.mp4',
    '5-library-assets/library_capsule.png': 'library/library_capsule.png',
    '5-library-assets/library_header.png': 'library/library_header.png',
    '5-library-assets/library_hero.png': 'library/library_hero.png',
    '5-library-assets/library_logo.png': 'library/library_logo.png',
    '6-icons/app_icon.jpg': 'icons/app_icon.jpg',
    '6-icons/shortcut_icon.png': 'icons/shortcut_icon.png',
  },
  epic: {
    '2-offer/offer_landscape.png': 'offer_landscape.png',
    '2-offer/offer_portrait.png': 'offer_portrait.png',
    '2-offer/logo.png': 'logo.png',
    '3-product-home/carousel/00-trailer.mp4': 'carousel/00-trailer.mp4',
    '3-product-home/carousel/01-kangaroo-chase.jpg': 'carousel/01-kangaroo-chase.jpg',
    '3-product-home/carousel/02-the-hunt.jpg': 'carousel/02-the-hunt.jpg',
    '3-product-home/carousel/03-roo-ball.jpg': 'carousel/03-roo-ball.jpg',
    '3-product-home/carousel/04-king-of-the-hill.jpg': 'carousel/04-king-of-the-hill.jpg',
    '3-product-home/carousel/05-conversion-duel.jpg': 'carousel/05-conversion-duel.jpg',
    '3-product-home/social_preview.jpg': 'social_preview.jpg',
  },
};

/** Kit text file → the doc block it is cut from. */
export const TEXT = {
  steam: {
    '1-store-page-text/name.txt': 'Name',
    '1-store-page-text/short-description.txt': 'Short description',
    '1-store-page-text/about-this-game.txt': 'About this game',
    '1-store-page-text/tags.txt': 'Tags (Steam)',
  },
  epic: {
    '1-store-settings/name.txt': 'Name',
    '1-store-settings/short-description.txt': 'Short description',
    '1-store-settings/genres-and-features.txt': 'Tags (Steam)',
    '3-product-home/about.txt': 'About this game',
  },
};

/** CHECKLIST.md → the doc's own sections, in this order. */
export const CHECKLIST = {
  steam: [
    'Before the page goes up: the release blocker',
    "Putting the Steam page up, in Steamworks' own order",
    'Release date',
    'What this cannot produce, said plainly',
  ],
  epic: [
    'Before the page goes up: the release blocker',
    "Putting the Epic page up, in the portal's own order",
    'Release date',
    'Things these stores require that already hold',
    'What this cannot produce, said plainly',
  ],
};
