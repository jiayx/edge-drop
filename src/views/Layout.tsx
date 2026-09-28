import { Link, ViteClient } from "vite-ssr-components/hono";

export interface LayoutProps {
  title: string;
  description: string;
  children: unknown;
  admin?: boolean;
}

export function Layout(props: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        {import.meta.env.PROD && !props.admin && (
          <>
            <script
              async
              src="https://www.googletagmanager.com/gtag/js?id=G-K8QNWFNXLL"
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-K8QNWFNXLL');`,
              }}
            />
          </>
        )}
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
        {props.admin
          ? <Link href="/src/admin.css" rel="stylesheet" />
          : <Link href="/src/app.css" rel="stylesheet" />}
      </head>
      <body>{props.children}</body>
    </html>
  );
}
