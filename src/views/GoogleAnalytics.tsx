import { html } from "hono/html";

const MEASUREMENT_ID = "G-K8QNWFNXLL";

export function GoogleAnalytics() {
  if (!import.meta.env.PROD) return null;

  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`} />
      <script>{html`
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        gtag('js', new Date());
        gtag('config', '${MEASUREMENT_ID}');
      `}</script>
    </>
  );
}
