import { Link, ViteClient } from "vite-ssr-components/hono";

export interface AdminLayoutProps {
  title: string;
  description: string;
  children: unknown;
}

export function AdminLayout(props: AdminLayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <link
          rel="icon"
          sizes="64x64"
          type="image/svg+xml"
          href="https://icon.tools.tf/icon/64?type=tabler&fg=%23328ec8&bg=transparent&textGlyph=100&iconGlyph=100&radius=0&icon=transfer"
        />
        <ViteClient />
        <Link href="/src/admin.css" rel="stylesheet" />
      </head>
      <body>{props.children}</body>
    </html>
  );
}
