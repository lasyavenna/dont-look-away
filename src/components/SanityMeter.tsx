export interface SanityMeterProps {
  /** Integer 0..100. */
  value: number;
}

export function SanityMeter({ value }: SanityMeterProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="sanity-meter">
      <span className="sanity-meter__label" aria-hidden="true">
        SANITY
      </span>
      <div
        role="meter"
        aria-label="Sanity"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="sanity-meter__track"
      >
        <div className="sanity-meter__fill" style={{ width: `${v}%` }} />
      </div>
      <span className="sanity-meter__value" aria-hidden="true">
        {v}
      </span>
    </div>
  );
}
