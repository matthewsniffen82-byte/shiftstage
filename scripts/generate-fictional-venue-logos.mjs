import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUTPUT_DIRECTORY = new URL("../public/venue-logos/fictional/", import.meta.url);

const venues = [
  { asset: "neon-ember.svg", name: "Neon Ember", monogram: "NE", accent: "#a855f7", accent2: "#22d3ee", symbol: "spark" },
  { asset: "velvet-orbit.svg", name: "Velvet Orbit", monogram: "VO", accent: "#ec4899", accent2: "#8b5cf6", symbol: "orbit" },
  { asset: "electric-mirage.svg", name: "Electric Mirage", monogram: "EM", accent: "#22d3ee", accent2: "#7c3aed", symbol: "prism" },
  { asset: "afterglow-social.svg", name: "Afterglow Social", monogram: "AS", accent: "#f97316", accent2: "#ec4899", symbol: "horizon" },
  { asset: "violet-hour.svg", name: "Violet Hour", monogram: "VH", accent: "#8b5cf6", accent2: "#c084fc", symbol: "hour" },
  { asset: "lunar-house.svg", name: "Lunar House", monogram: "LH", accent: "#e2e8f0", accent2: "#7c3aed", symbol: "lunar" },
  { asset: "prism-room.svg", name: "Prism Room", monogram: "PR", accent: "#06b6d4", accent2: "#d946ef", symbol: "facet" },
  { asset: "golden-halo.svg", name: "Golden Halo", monogram: "GH", accent: "#facc15", accent2: "#f97316", symbol: "halo" },
  { asset: "midnight-current.svg", name: "Midnight Current", monogram: "MC", accent: "#38bdf8", accent2: "#6366f1", symbol: "wave" },
  { asset: "nova-lounge.svg", name: "Nova Lounge", monogram: "NL", accent: "#f472b6", accent2: "#22d3ee", symbol: "nova" },
  { asset: "silver-circuit.svg", name: "Silver Circuit", monogram: "SC", accent: "#cbd5e1", accent2: "#22d3ee", symbol: "circuit" },
  { asset: "blue-ember.svg", name: "Blue Ember", monogram: "BE", accent: "#3b82f6", accent2: "#a855f7", symbol: "ember" },
  { asset: "radiant-room.svg", name: "Radiant Room", monogram: "RR", accent: "#f8fafc", accent2: "#e879f9", symbol: "rays" },
  { asset: "moonline-social.svg", name: "Moonline Social", monogram: "MS", accent: "#a78bfa", accent2: "#67e8f9", symbol: "moonline" },
  { asset: "echo-house.svg", name: "Echo House", monogram: "EH", accent: "#2dd4bf", accent2: "#8b5cf6", symbol: "echo" },
  { asset: "starlight-club.svg", name: "Starlight Club", monogram: "ST", accent: "#f8fafc", accent2: "#8b5cf6", symbol: "stellar" },
  { asset: "aurora-room.svg", name: "Aurora Room", monogram: "AR", accent: "#34d399", accent2: "#c084fc", symbol: "aurora" },
];

const symbolMarkup = {
  spark: '<path d="M160 54 181 147 268 116 201 180 277 227 181 208 160 307 139 208 43 227 119 180 52 116 139 147Z" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linejoin="round"/>',
  orbit: '<ellipse cx="160" cy="180" rx="113" ry="52" fill="none" stroke="url(#accent)" stroke-width="9" transform="rotate(-18 160 180)"/><ellipse cx="160" cy="180" rx="52" ry="113" fill="none" stroke="url(#accent)" stroke-width="9" transform="rotate(32 160 180)"/><circle cx="252" cy="126" r="13" fill="url(#accent)"/>',
  prism: '<path d="M160 55 276 276H44Z" fill="none" stroke="url(#accent)" stroke-width="11" stroke-linejoin="round"/><path d="m160 55 20 221m-20-91L44 276m136 0 96-1" fill="none" stroke="url(#accent)" stroke-width="7"/>',
  horizon: '<circle cx="160" cy="161" r="88" fill="none" stroke="url(#accent)" stroke-width="10"/><path d="M43 188h234M70 222h180M105 252h110" fill="none" stroke="url(#accent)" stroke-width="9" stroke-linecap="round"/>',
  hour: '<path d="M82 69h156M82 291h156M103 75c0 58 57 67 57 105s-57 47-57 105m114-210c0 58-57 67-57 105s57 47 57 105" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linecap="round"/><path d="m122 225 38-32 38 32Z" fill="url(#accent)"/>',
  lunar: '<path d="M217 69a108 108 0 1 0 31 188 121 121 0 0 1-31-188Z" fill="none" stroke="url(#accent)" stroke-width="12"/><circle cx="226" cy="133" r="9" fill="url(#accent)"/>',
  facet: '<path d="m160 47 114 77-43 139-142 0-43-139Z" fill="none" stroke="url(#accent)" stroke-width="10"/><path d="m160 47-18 129 89 87m-185-139 96 52-53 87m53-87 132-52" fill="none" stroke="url(#accent)" stroke-width="7"/>',
  halo: '<ellipse cx="160" cy="105" rx="106" ry="33" fill="none" stroke="url(#accent)" stroke-width="12"/><path d="M100 143v118m120-118v118M72 261h176" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linecap="round"/>',
  wave: '<path d="M42 108c49-48 84 48 126 0s79 48 112 0M42 180c49-48 84 48 126 0s79 48 112 0M42 252c49-48 84 48 126 0s79 48 112 0" fill="none" stroke="url(#accent)" stroke-width="11" stroke-linecap="round"/>',
  nova: '<circle cx="160" cy="180" r="47" fill="none" stroke="url(#accent)" stroke-width="10"/><path d="M160 41v72m0 134v72M21 180h72m134 0h72M62 82l51 51m94 94 51 51m0-196-51 51m-94 94-51 51" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linecap="round"/>',
  circuit: '<path d="M72 76h96v54h80v80h-64v74H72V178h58v-48H72Z" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linejoin="round"/><circle cx="72" cy="76" r="13" fill="url(#accent)"/><circle cx="248" cy="210" r="13" fill="url(#accent)"/><circle cx="184" cy="284" r="13" fill="url(#accent)"/>',
  ember: '<path d="M171 45c31 57-13 73 23 111 24 25 38 52 28 86-9 32-35 65-72 67-49 2-80-35-75-77 4-36 31-51 47-77 19-31 13-63 49-110Z" fill="none" stroke="url(#accent)" stroke-width="11"/><path d="M158 169c25 31 37 53 15 82-12 16-40 10-42-12-2-21 17-35 27-70Z" fill="url(#accent)"/>',
  rays: '<circle cx="160" cy="180" r="58" fill="none" stroke="url(#accent)" stroke-width="10"/><path d="M160 38v72m0 140v72M18 180h72m140 0h72M60 80l50 50m100 100 50 50m0-200-50 50M110 230l-50 50" fill="none" stroke="url(#accent)" stroke-width="13" stroke-linecap="round"/>',
  moonline: '<path d="M213 62a104 104 0 1 0 34 190 118 118 0 0 1-34-190Z" fill="none" stroke="url(#accent)" stroke-width="11"/><path d="M45 257h232" fill="none" stroke="url(#accent)" stroke-width="9" stroke-linecap="round"/>',
  echo: '<path d="M92 110a100 100 0 0 1 0 140m48-178a148 148 0 0 1 0 216m50-240a178 178 0 0 1 0 264" fill="none" stroke="url(#accent)" stroke-width="11" stroke-linecap="round"/><circle cx="58" cy="180" r="18" fill="url(#accent)"/>',
  stellar: '<path d="m160 42 31 91 96 2-77 57 28 92-78-54-78 54 28-92-77-57 96-2Z" fill="none" stroke="url(#accent)" stroke-width="10" stroke-linejoin="round"/><circle cx="160" cy="180" r="22" fill="url(#accent)"/>',
  aurora: '<path d="M38 257c54-8 62-154 109-154 41 0 50 111 89 111 23 0 30-38 46-54M38 286c55-9 74-111 119-111 41 0 54 71 125 47" fill="none" stroke="url(#accent)" stroke-width="12" stroke-linecap="round"/>',
};

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}

function logoSvg(venue) {
  const safeName = escapeXml(venue.name.toUpperCase());
  const safeMonogram = escapeXml(venue.monogram);
  const wordmarkSize = venue.name.length > 15 ? 46 : venue.name.length > 12 ? 54 : 68;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="420" viewBox="0 0 960 420" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(venue.name)} fictional venue logo</title>
  <desc id="description">Original MyDancr demonstration venue identity.</desc>
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${venue.accent}"/>
      <stop offset="1" stop-color="${venue.accent2}"/>
    </linearGradient>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="7" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g transform="translate(20 28)" filter="url(#softGlow)">${symbolMarkup[venue.symbol]}</g>
  <text x="348" y="184" fill="#f8fafc" font-family="Arial Black, Helvetica Neue, Arial, sans-serif" font-size="${wordmarkSize}" font-weight="900" letter-spacing="-2">${safeName}</text>
  <rect x="350" y="217" width="470" height="3" rx="2" fill="url(#accent)"/>
  <text x="350" y="267" fill="#cbd5e1" font-family="Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="8">MYDANCR DEMO VENUE</text>
  <text x="350" y="311" fill="url(#accent)" font-family="Arial Black, Helvetica Neue, Arial, sans-serif" font-size="24" font-weight="900" letter-spacing="9">${safeMonogram} · LAS VEGAS</text>
</svg>
`;
}

await mkdir(fileURLToPath(OUTPUT_DIRECTORY), { recursive: true });
for (const venue of venues) {
  await writeFile(fileURLToPath(new URL(venue.asset, OUTPUT_DIRECTORY)), logoSvg(venue), "utf8");
  console.log(`Generated ${venue.asset}`);
}

if (process.argv.includes("--preview")) {
  const tileWidth = 480;
  const tileHeight = 210;
  const columns = 4;
  const rows = Math.ceil(venues.length / columns);
  const tiles = await Promise.all(
    venues.map((venue) =>
      sharp(fileURLToPath(new URL(venue.asset, OUTPUT_DIRECTORY)))
        .resize(tileWidth, tileHeight, { fit: "contain", background: "#07070a" })
        .png()
        .toBuffer(),
    ),
  );
  for (const [index, tile] of tiles.entries()) {
    const { data, info } = await sharp(tile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let visibleMarkPixels = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < 160; x += 1) {
        const offset = (y * info.width + x) * info.channels;
        const colorDistance =
          Math.abs(data[offset] - 7) +
          Math.abs(data[offset + 1] - 7) +
          Math.abs(data[offset + 2] - 10);
        if (data[offset + 3] > 24 && colorDistance > 30) visibleMarkPixels += 1;
      }
    }
    if (visibleMarkPixels < 500) {
      throw new Error(`${venues[index].asset} did not render a visible logo mark.`);
    }
  }
  const previewPath = new URL("../.codex-fictional-logo-sheet.png", import.meta.url);
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight,
      channels: 4,
      background: "#07070a",
    },
  })
    .composite(
      tiles.map((input, index) => ({
        input,
        left: (index % columns) * tileWidth,
        top: Math.floor(index / columns) * tileHeight,
      })),
    )
    .png()
    .toFile(fileURLToPath(previewPath));
  console.log(`Rendered ${fileURLToPath(previewPath)}`);
}
