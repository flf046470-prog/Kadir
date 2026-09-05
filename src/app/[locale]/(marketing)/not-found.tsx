import { Link } from "@/i18n/navigation";

export default function NotFound() {
  return (
    <section className="container-fm flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="eyebrow">404</p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-ink">This page wandered off.</h1>
      <p className="mt-2 max-w-md text-ink/60">
        The page you are looking for does not exist, or it moved. Let us get you back to meeting
        people.
      </p>
      <Link href="/" className="btn-primary mt-8">
        Back to FioreMatch
      </Link>
    </section>
  );
}
