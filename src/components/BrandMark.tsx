interface Props {
  subtitle?: string;
  logoSize?: number;
  titleClassName?: string;
  align?: 'start' | 'center';
}

export function BrandMark({
  subtitle,
  logoSize = 48,
  titleClassName = 'text-xl',
  align = 'start',
}: Props) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === 'center' ? 'flex-col text-center' : ''}`}>
      <img
        src="/osoul-logo.png"
        alt="أصول OSOUL"
        width={logoSize}
        height={logoSize}
        className="shrink-0 rounded-full object-cover shadow-md ring-1 ring-white/15"
        style={{ width: logoSize, height: logoSize }}
      />
      <div className="min-w-0">
        <h1 className={`font-extrabold leading-tight tracking-tight ${titleClassName}`}>
          <span className="text-white">أصول</span>
          <span className="ms-1.5 text-[#2eb4dc]" dir="ltr">OSOUL</span>
        </h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}
