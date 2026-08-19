import { redirect } from "next/navigation";
import { adminExists, ensureAdminBootstrap, getCurrentAdmin } from "@/lib/auth";
import { seedIfEmpty } from "@/lib/seed";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  seedIfEmpty();
  ensureAdminBootstrap();

  if (await getCurrentAdmin()) redirect("/admin");
  const hasAdmin = adminExists();

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-20">
      <div className="w-full max-w-sm">
        <p className="label text-ember">Patagonia Underground</p>
        <h1 className="mt-4 font-display text-3xl text-snow">Admin</h1>

        {hasAdmin ? (
          <LoginForm />
        ) : (
          <div className="card-stone mt-8 p-5 text-sm leading-relaxed text-fog">
            <p className="text-snow">No administrator account exists yet.</p>
            <p className="mt-3">
              Set <code className="text-ember">ADMIN_EMAIL</code> and{" "}
              <code className="text-ember">ADMIN_PASSWORD_HASH</code> in the environment, then
              reload this page. Generate the hash with:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-sm bg-basalt p-3 text-xs text-mist">
              npm run admin:password
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
