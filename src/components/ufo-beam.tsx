/** Slim UFO with a soft downward light cone — used in empty run states. */
export function UfoBeam({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Soft light cone */}
      <defs>
        <linearGradient id="ufo-beam" x1="32" y1="28" x2="32" y2="68" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.08" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M22 28 L10 68 H54 L42 28 Z" fill="url(#ufo-beam)" />

      {/* Thin saucer outline */}
      <ellipse cx="32" cy="22" rx="20" ry="6.5" stroke="currentColor" strokeWidth="1.25" opacity="0.85" />
      <path
        d="M18 20 C20 14 26 11 32 11 C38 11 44 14 46 20"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.85"
      />
      {/* Dome highlight */}
      <path
        d="M26 16 C28 13.5 30.5 12.5 32 12.5 C33.5 12.5 36 13.5 38 16"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* Three soft landing lights */}
      <circle cx="22" cy="26.5" r="1.1" fill="currentColor" opacity="0.55" />
      <circle cx="32" cy="27.5" r="1.1" fill="currentColor" opacity="0.7" />
      <circle cx="42" cy="26.5" r="1.1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}
