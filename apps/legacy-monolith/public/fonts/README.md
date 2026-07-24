# Fonts

WorkHub uses **system UI stack + Inter** with `font-display: swap` (see `public/css/style.css`).

To self-host WOFF2 subset (tiếng Việt):

1. Generate subset via [google-webfonts-helper](https://gwfh.mranftl.com/fonts/inter) or `glyphhanger`.
2. Place files here, e.g. `inter-vietnamese.woff2`.
3. Add:

```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/inter-vietnamese.woff2') format('woff2');
  font-weight: 400 700;
  font-display: swap;
  unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+1EA0-1EF9, U+20AB;
}
```

Production may drop Google Fonts CDN and rely on self-host + system fallback.
