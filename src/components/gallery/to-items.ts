import type { GalleryImage } from "@/lib/content";
import type { Translator } from "@/lib/i18n";
import type { GalleryItem, GalleryLabels } from "./editorial-gallery";

/** Maps a stored image onto what the gallery needs to show it honestly. */
export function toGalleryItems(images: GalleryImage[]): GalleryItem[] {
  return images.map((image) => ({
    id: image.id,
    src: image.file_path,
    alt: image.alt_text || image.title || image.subject || "Gallery image",
    title: image.title,
    description: image.description,
    location: image.location,
    photographer: image.photographer,
    license: image.license,
    sourceUrl: image.source_url,
    subject: image.subject,
    width: image.width,
    height: image.height,
  }));
}

export function galleryLabels(t: Translator): GalleryLabels {
  return {
    previous: t("gallery.previous"),
    next: t("gallery.next"),
    counter: t("gallery.counter"),
    drawing: t("gallery.drawing"),
  };
}
