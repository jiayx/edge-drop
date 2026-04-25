export type IconName = "paperclip" | "upload" | "download" | "monitor" | "moon" | "sun" | "home";

type IconAttrs = Record<string, string | number>;
type IconNode = readonly ["path" | "circle" | "rect", IconAttrs];

const icons: Record<IconName, readonly IconNode[]> = {
  paperclip: [
    ["path", { d: "m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 1 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" }],
  ],
  upload: [
    ["path", { d: "M12 16V4" }],
    ["path", { d: "m7 9 5-5 5 5" }],
    ["path", { d: "M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" }],
  ],
  download: [
    ["path", { d: "M12 4v12" }],
    ["path", { d: "m7 11 5 5 5-5" }],
    ["path", { d: "M20 16v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2" }],
  ],
  monitor: [
    ["rect", { x: 3, y: 4, width: 18, height: 12, rx: 2 }],
    ["path", { d: "M8 20h8" }],
    ["path", { d: "M12 16v4" }],
  ],
  moon: [
    ["path", { class: "theme-moon-fill", d: "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" }],
  ],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: "M12 2v2" }],
    ["path", { d: "M12 20v2" }],
    ["path", { d: "m4.9 4.9 1.4 1.4" }],
    ["path", { d: "m17.7 17.7 1.4 1.4" }],
    ["path", { d: "M2 12h2" }],
    ["path", { d: "M20 12h2" }],
    ["path", { d: "m6.3 17.7-1.4 1.4" }],
    ["path", { d: "m19.1 4.9-1.4 1.4" }],
  ],
  home: [
    ["path", { d: "m3 10.5 9-7 9 7" }],
    ["path", { d: "M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" }],
    ["path", { d: "M9 21v-6h6v6" }],
  ],
};

function renderAttrs(attrs: IconAttrs): string {
  return Object.entries(attrs)
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
}

function renderIconNodeString([tag, attrs]: IconNode): string {
  return `<${tag}${renderAttrs(attrs)} />`;
}

function iconSvg(name: IconName, className: string): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]
    .map(renderIconNodeString)
    .join("")}</svg>`;
}

function IconNodeView(props: { node: IconNode }) {
  const [tag, attrs] = props.node;
  switch (tag) {
    case "circle":
      return <circle {...attrs} />;
    case "rect":
      return <rect {...attrs} />;
    case "path":
      return <path {...attrs} />;
  }
}

export function fileIcon(name: IconName): string {
  return iconSvg(name, "file-icon");
}

export function buttonIcon(name: IconName): string {
  return iconSvg(name, "btn-icon");
}

export function Icon(props: { name: IconName; className?: string }) {
  return (
    <svg
      class={props.className ?? "btn-icon"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {icons[props.name].map((node, index) => (
        <IconNodeView node={node} key={`${node[0]}-${index}`} />
      ))}
    </svg>
  );
}
