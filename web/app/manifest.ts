import type { MetadataRoute } from "next";

// Installable web app manifest. No service worker on purpose.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TapRush",
    short_name: "TapRush",
    description: "Five taps, one score in milliseconds. A weekly G$ reaction duel on Celo.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#e8edf4",
    theme_color: "#10213b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
