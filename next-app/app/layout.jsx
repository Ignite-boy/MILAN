import "../styles/globals.css";


export const metadata = {
  title: "Milan",
  description: "Your Space. Your People.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-US">
      <head>
        <link rel="stylesheet" href="/milan-core.css" />
        <link rel="stylesheet" href="/premium.css" />
        <link rel="stylesheet" href="/assets/css/app-layout.css" />
        <link rel="stylesheet" href="/assets/css/milan-visual-base.css" />
        <link rel="stylesheet" href="/assets/css/milan-web5-engine.css" />
        <link rel="stylesheet" href="/assets/css/milan-frontend-refresh-20260907.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
