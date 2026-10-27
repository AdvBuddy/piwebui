import type { SVGProps } from "react";

export type IconName =
	| "send"
	| "stop"
	| "mic"
	| "image"
	| "plus"
	| "menu"
	| "close"
	| "sun"
	| "moon"
	| "chevron-down"
	| "chevron-right"
	| "copy"
	| "check"
	| "terminal"
	| "file"
	| "pencil"
	| "search"
	| "globe"
	| "refresh"
	| "settings"
	| "trash"
	| "brain"
	| "cpu"
	| "alert"
	| "plug"
	| "sparkles"
	| "arrow-down"
	| "logout"
	| "folder"
	| "clock"
	| "eye"
	| "list";

const PATHS: Record<IconName, React.ReactNode> = {
	send: <path d="M12 19V5M12 5l-6 6M12 5l6 6" />,
	stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" />,
	mic: (
		<>
			<rect x="9" y="3" width="6" height="11" rx="3" />
			<path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
		</>
	),
	image: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<circle cx="8.5" cy="9.5" r="1.6" />
			<path d="M4 17l4.5-4.5a2 2 0 0 1 2.8 0L20 20" />
		</>
	),
	plus: <path d="M12 5v14M5 12h14" />,
	menu: <path d="M4 7h16M4 12h16M4 17h16" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
	sun: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
		</>
	),
	moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
	"chevron-down": <path d="M6 9l6 6 6-6" />,
	"chevron-right": <path d="M9 6l6 6-6 6" />,
	copy: (
		<>
			<rect x="9" y="9" width="11" height="11" rx="2" />
			<path d="M5 15V6a2 2 0 0 1 2-2h9" />
		</>
	),
	check: <path d="M5 13l4 4L19 7" />,
	terminal: (
		<>
			<rect x="3" y="4" width="18" height="16" rx="2.5" />
			<path d="M7 10l2.5 2L7 14M12.5 14.5H16" />
		</>
	),
	file: (
		<>
			<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
			<path d="M14 3v5h5" />
		</>
	),
	pencil: (
		<>
			<path d="M4 20h4L20 8l-4-4L4 16z" />
			<path d="M13.5 6.5l4 4" />
		</>
	),
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="M16.5 16.5L21 21" />
		</>
	),
	globe: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
		</>
	),
	refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
	settings: (
		<>
			<circle cx="12" cy="12" r="3" />
			<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z" />
		</>
	),
	trash: <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />,
	brain: (
		<>
			<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8V20h3V4z" />
			<path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8V20h-3" />
		</>
	),
	cpu: (
		<>
			<rect x="7" y="7" width="10" height="10" rx="2" />
			<path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
		</>
	),
	alert: (
		<>
			<path d="M12 3.5L22 20H2z" />
			<path d="M12 10v4M12 17.2v.1" />
		</>
	),
	plug: <path d="M9 3v6M15 3v6M6 9h12v3a6 6 0 0 1-12 0zM12 18v3" />,
	sparkles: <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.3 2.1.7-2.1.7L18 21l-.9-2.3-2.1-.7 2.1-.7z" />,
	"arrow-down": <path d="M12 5v14M6 13l6 6 6-6" />,
	logout: <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />,
	folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
	clock: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M12 7v5.2l3.2 2" />
		</>
	),
	eye: (
		<>
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="2.8" />
		</>
	),
	list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
};

export function Icon({
	name,
	size = 18,
	strokeWidth = 1.7,
	...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			{PATHS[name]}
		</svg>
	);
}
