import { Settings, ISettings } from "../model/settings.model";
import { logActivity } from "../../activity-log/service/activity-log.service";

const SETTINGS_ID = "global";

export const getSettings = async (): Promise<ISettings> => {
  return Settings.findByIdAndUpdate(
    SETTINGS_ID,
    {},
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

interface UpdateSettingsInput {
  siteName?: string;
  matchThreshold?: number;
  allowSignups?: boolean;
  maxResumeSizeMB?: number;
}

export const updateSettings = async (
  adminId: string,
  input: UpdateSettingsInput
): Promise<ISettings> => {
  const settings = await getSettings();

  if (input.siteName !== undefined) settings.siteName = input.siteName;
  if (input.matchThreshold !== undefined) settings.matchThreshold = input.matchThreshold;
  if (input.allowSignups !== undefined) settings.allowSignups = input.allowSignups;
  if (input.maxResumeSizeMB !== undefined) settings.maxResumeSizeMB = input.maxResumeSizeMB;

  await settings.save();
  await logActivity(adminId, "admin", "settings.update", "Settings", SETTINGS_ID, { ...input });

  return settings;
};
