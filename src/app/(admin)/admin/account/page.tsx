import { requireAdmin } from "@/lib/auth";
import { changePasswordAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

export default async function AdminAccountPage() {
  const admin = await requireAdmin();

  return (
    <AdminShell
      title="Account"
      intro="Changing the password signs out every session, including this one."
      email={admin.email}
    >
      <div className="max-w-md">
        <Panel title="Change password">
          <SaveForm action={changePasswordAction} submitLabel="Change password">
            <label htmlFor="currentPassword" className="label mb-2 block">
              Current password
            </label>
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
            />

            <label htmlFor="newPassword" className="label mt-4 mb-2 block">
              New password — at least 12 characters
            </label>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              className={inputClass}
            />
          </SaveForm>
        </Panel>
      </div>
    </AdminShell>
  );
}
