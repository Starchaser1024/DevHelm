/** DevHelm 品牌标记：舵轮（译自 "Helm"——舵盘），几何线稿风，跟随 currentColor */
export function HelmMark({
  size = 18,
  strokeWidth = 1.9,
  className
}: {
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      {/* 外圈 + 八辐条 + 四舵柄（对角辐条穿过外圈形成握柄） */}
      <circle cx="12" cy="12" r="7.3" />
      <path d="M4.86 4.86 L19.14 19.14 M19.14 4.86 L4.86 19.14 M12 4.7 V19.3 M4.7 12 H19.3" />
      {/* 轴心 */}
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
