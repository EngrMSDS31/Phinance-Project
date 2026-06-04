const LS_KEY = "folio_settings_v1";

export interface AppSettings {
  defaultFeeRate: number;
  defaultTaxRate: number;
}

const DEFAULTS: AppSettings = { defaultFeeRate: 0, defaultTaxRate: 0 };

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(patch: Partial<AppSettings>): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ ...getSettings(), ...patch }));
}
