import { primitives } from "../../primitives.js";

interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  describedBy?: string;
}

export function SettingsSwitch({ label, checked, disabled, onChange, describedBy }: SwitchProps) {
  const HostSwitch = primitives.Switch;
  if (HostSwitch) return <HostSwitch label={label} checked={checked} disabled={disabled}
    onChange={onChange} aria-describedby={describedBy} />;
  return <button type="button" role="switch" className="sk-repo-settings__switch"
    aria-label={label} aria-checked={checked} aria-describedby={describedBy} disabled={disabled}
    onClick={() => onChange(!checked)}>
    <span className="sk-repo-settings__switchThumb" aria-hidden="true" />
  </button>;
}
