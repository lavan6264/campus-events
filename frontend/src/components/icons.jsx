// A small set of inline icons, drawn by hand: 1.5px stroke, 20px grid.
const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 20 20",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

const make = (paths) =>
  function Icon({ size = 20, ...props }) {
    return (
      <svg {...base} width={size} height={size} {...props}>
        {paths}
      </svg>
    );
  };

export const CloseIcon = make(<path d="M5 5l10 10M15 5L5 15" />);
export const ChevronLeftIcon = make(<path d="M12 4l-6 6 6 6" />);
export const ChevronRightIcon = make(<path d="M8 4l6 6-6 6" />);
export const ChevronDownIcon = make(<path d="M4 8l6 6 6-6" />);
export const ArrowUpIcon = make(<path d="M10 16V4M5 9l5-5 5 5" />);
export const ArrowDownIcon = make(<path d="M10 4v12M5 11l5 5 5-5" />);
export const SearchIcon = make(
  <>
    <circle cx="9" cy="9" r="5" />
    <path d="M13 13l4 4" />
  </>,
);
export const CalendarIcon = make(
  <>
    <rect x="3" y="4.5" width="14" height="12" rx="2" />
    <path d="M3 8.5h14M7 3v3M13 3v3" />
  </>,
);
export const MenuIcon = make(<path d="M3 6h14M3 10h14M3 14h14" />);
export const DownloadIcon = make(<path d="M10 3v10M5.5 8.5L10 13l4.5-4.5M4 16h12" />);
