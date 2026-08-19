import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/content";
import { SETTINGS, SETTING_GROUP_LABELS, type SettingGroup } from "@/lib/settings-schema";
import { saveSettingsAction } from "../actions";
import { SaveForm } from "../save-form";
import { AdminShell, Panel, inputClass } from "../ui";

export const dynamic = "force-dynamic";

const GROUP_ORDER: SettingGroup[] = [
  "brand",
  "project",
  "transparency",
  "community",
  "stay",
  "location",
  "social",
  "seo",
];

export default async function SettingsPage() {
  const admin = await requireAdmin();
  const settings = getSettings();

  return (
    <AdminShell
      title="Site content"
      intro="Every piece of text on the public site that is not a database record. Changes appear immediately."
      email={admin.email}
    >
      <SaveForm action={saveSettingsAction} submitLabel="Save all">
        <div className="grid gap-6">
          {GROUP_ORDER.map((group) => (
            <Panel key={group} title={SETTING_GROUP_LABELS[group]}>
              <div className="grid gap-5">
                {SETTINGS.filter((setting) => setting.group === group).map((setting) => (
                  <div key={setting.key}>
                    <label htmlFor={setting.key} className="label mb-2 block">
                      {setting.label}
                    </label>
                    {setting.type === "text" || setting.type === "url" ? (
                      <input
                        id={setting.key}
                        name={setting.key}
                        type={setting.type === "url" ? "url" : "text"}
                        defaultValue={settings[setting.key] ?? ""}
                        className={inputClass}
                      />
                    ) : (
                      <textarea
                        id={setting.key}
                        name={setting.key}
                        rows={setting.type === "longtext" ? 8 : 3}
                        defaultValue={settings[setting.key] ?? ""}
                        className={`${inputClass} resize-y`}
                      />
                    )}
                    {setting.help ? (
                      <p className="mt-1.5 text-xs text-fog/60">{setting.help}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      </SaveForm>
    </AdminShell>
  );
}
