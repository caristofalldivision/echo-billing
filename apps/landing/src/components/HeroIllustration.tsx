export function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 400 260"
      className="h-full w-full"
      role="img"
      aria-label="A router broadcasting a signal, stepping up toward three people standing on a network line"
    >
      {/* baseline */}
      <line x1="0" y1="230" x2="400" y2="230" stroke="#000" strokeWidth="3" />

      {/* router */}
      <rect x="24" y="196" width="76" height="30" fill="#000" />
      <rect x="34" y="188" width="10" height="10" fill="#ff0000" />
      <rect x="54" y="182" width="10" height="16" fill="#ff0000" />
      <rect x="74" y="188" width="10" height="10" fill="#ff0000" />

      {/* signal — stepped rectangles climbing toward the people */}
      <rect x="118" y="176" width="22" height="22" fill="#0000ff" />
      <rect x="156" y="150" width="30" height="30" fill="#0000ff" />
      <rect x="202" y="118" width="38" height="38" fill="#0000ff" />
      <rect x="256" y="80" width="46" height="46" fill="#ffd500" />

      {/* connecting rule from router to signal */}
      <line x1="100" y1="211" x2="330" y2="60" stroke="#000" strokeWidth="2" strokeDasharray="1 9" />

      {/* three people on the baseline */}
      <g>
        <rect x="290" y="176" width="16" height="16" fill="#ff0000" />
        <rect x="286" y="196" width="24" height="34" fill="#ff0000" />
      </g>
      <g>
        <rect x="326" y="168" width="18" height="18" fill="#0000ff" />
        <rect x="321" y="190" width="28" height="40" fill="#0000ff" />
      </g>
      <g>
        <rect x="362" y="178" width="15" height="15" fill="#ffd500" />
        <rect x="358" y="197" width="23" height="33" fill="#ffd500" />
      </g>
    </svg>
  );
}
