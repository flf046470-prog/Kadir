import Link from "next/link";
import { logoutAction } from "./actions";

export const ADMIN_NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/settings", label: "Site content" },
  { href: "/admin/story", label: "Story" },
  { href: "/admin/progress", label: "Progress" },
  { href: "/admin/posts", label: "Journal & updates" },
  { href: "/admin/gallery", label: "Gallery" },
  { href: "/admin/ideas", label: "Ideas" },
  { href: "/admin/community", label: "Community" },
  { href: "/admin/account", label: "Account" },
];

export function AdminShell({
  title,
  intro,
  email,
  children,
}: {
  title: string;
  intro?: string;
  email: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-fog/10 bg-loam/50">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Link href="/admin" className="font-display text-lg text-snow">
            Patagonia Underground
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-fog/70">{email}</span>
            <Link href="/" className="text-xs text-fog transition-colors hover:text-snow">
              View site ↗
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-full border border-fog/20 px-3 py-1.5 text-xs text-fog transition-colors hover:border-ember hover:text-ember"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
        <nav className="mx-auto w-full max-w-6xl overflow-x-auto px-5">
          <ul className="flex gap-1 pb-2">
            {ADMIN_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-sm px-3 py-2 text-sm whitespace-nowrap text-fog transition-colors hover:bg-stone hover:text-snow"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-10">
        <h1 className="font-display text-3xl text-snow md:text-4xl">{title}</h1>
        {intro ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog">{intro}</p> : null}
        <div className="mt-10">{children}</div>
      </main>
    </div>
  );
}

export const inputClass =
  "w-full rounded-sm border border-fog/20 bg-basalt px-3 py-2.5 text-sm text-snow placeholder:text-fog/40 focus:border-ember";

export function Panel({
  title,
  children,
  meta,
}: {
  title: string;
  children: React.ReactNode;
  meta?: string;
}) {
  return (
    <section className="card-stone p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-xl text-snow">{title}</h2>
        {meta ? <span className="text-xs text-fog/60">{meta}</span> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
