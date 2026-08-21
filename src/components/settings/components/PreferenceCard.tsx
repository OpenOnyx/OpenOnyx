import React from "react";

export interface PreferenceCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function PreferenceCard({
  title,
  description,
  badge,
  children,
  className = "",
  onClick,
}: PreferenceCardProps) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between gap-6 py-3.5 border-b border-[var(--border-subtle)] last:border-b-0 ${
        onClick ? "cursor-pointer hover:bg-[var(--bg-hover)] px-2.5 rounded-lg" : ""
      } ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {title}
          </h4>
          {badge && (
            <span className="inline-flex items-center rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-muted)] border border-[var(--border-subtle)]">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-muted)]">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex shrink-0 items-center justify-end gap-3">
          {children}
        </div>
      )}
    </div>
  );
}

export interface SegmentedControlOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  description?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (val: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps<T>) {
  const activeIndex = options.findIndex((opt) => opt.value === value);

  return (
    <div
      className={`relative inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-0.5 ${className}`}
    >
      {/* Sliding Highlight Indicator */}
      {activeIndex !== -1 && (
        <div
          className="absolute bottom-0.5 top-0.5 rounded bg-[var(--bg-primary)] transition-all duration-200 ease-out z-0"
          style={{
            left: `calc(${(activeIndex * 100) / options.length}% + 2px)`,
            width: `calc(${100 / options.length}% - 4px)`,
          }}
        />
      )}

      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex flex-1 items-center justify-center rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
              isSelected
                ? "text-[var(--text-primary)] font-semibold"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
            style={{ minWidth: "60px" }}
            title={opt.description}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function CustomToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-[18px] w-[34px] shrink-0 cursor-pointer rounded-full border border-[var(--border-medium)] transition-colors duration-150 focus:outline-none ${
        disabled ? "opacity-30 cursor-not-allowed" : ""
      } ${checked ? "bg-[var(--accent-primary,var(--text-primary))]" : "bg-[var(--bg-tertiary)]"}`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full transition duration-150 ${
          checked
            ? "translate-x-4 bg-[var(--bg-primary)]"
            : "translate-x-0 bg-[var(--text-muted)]"
        }`}
      />
    </button>
  );
}

export function SliderControl({
  value,
  min,
  max,
  step = 1,
  unit = "",
  showValue = true,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  showValue?: boolean;
  onChange: (val: number) => void;
}) {
  const [localValue, setLocalValue] = React.useState(value);

  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setLocalValue(val);
    onChange(val);
  };

  return (
    <div className="flex items-center gap-3 w-full sm:w-auto">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleChange}
        className="h-1 w-32 cursor-pointer appearance-none rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] accent-[var(--accent-primary,var(--text-primary))] transition-all"
      />
      {showValue && (
        <span className="min-w-[36px] text-right font-mono text-[11px] font-semibold text-[var(--text-primary)]">
          {localValue}
          {unit}
        </span>
      )}
    </div>
  );
}
